import express from "express";
import mongoose from "mongoose";

import { authMiddleware } from "../middleware/auth.js";
import { BankAccount } from "../models/BankAccount.js";
import { BankTransaction } from "../models/BankTransaction.js";
import { ExpenseRecord } from "../models/ExpenseRecord.js";
import { InvoiceRecord } from "../models/InvoiceRecord.js";
import {
  matchTransactions,
  reconcileMatched,
  serializeBankMatchResult,
  syncBankAccount
} from "../services/bankSyncService.js";
import {
  createLinkToken,
  exchangePublicToken,
  fetchAccountBalance,
  fetchTransactions as fetchPlaidTransactions,
  isPlaidConfigured,
  verifyPlaidWebhookSignature
} from "../services/plaidService.js";
import { writeAuditLog } from "../utils/audit.js";
import { ensureCurrencySupported, normalizeCurrencyCode } from "../utils/currency.js";
import { buildWorkspaceFilter, workspaceContextMiddleware, workspaceMembershipMiddleware } from "../utils/workspaceContext.js";

const router = express.Router();

router.use(authMiddleware);
router.use(workspaceContextMiddleware({ allowDefault: false, membershipModule: "finance", allowSingleMembershipFallback: true }));
router.use(workspaceMembershipMiddleware({ allowLegacyFallback: true }));

function buildScopedWorkspaceFilter(req, baseFilter = {}) {
  return buildWorkspaceFilter(req.workspace, baseFilter, {
    includeLegacy: Boolean(req.workspaceMembership?.isLegacyFallback)
  });
}

function hasAnyFinanceRole(membership, roles) {
  const assignedRoles = Array.isArray(membership?.financeRoles) ? membership.financeRoles : [];
  return roles.some((role) => assignedRoles.includes(role));
}

function requireFinanceViewer(req, res, next) {
  if (req.user?.isAdmin || req.user?.isSystemAdmin) {
    return next();
  }

  if (
    req.workspaceMembership &&
    Array.isArray(req.workspaceMembership.modules) &&
    req.workspaceMembership.modules.includes("finance") &&
    req.workspaceMembership.status !== "suspended" &&
    hasAnyFinanceRole(req.workspaceMembership, ["viewer", "approver", "finance_staff", "accountant"])
  ) {
    return next();
  }

  return res.status(403).json({ message: "Finance workspace access is required." });
}

function requireFinanceStaff(req, res, next) {
  if (req.user?.isAdmin || req.user?.isSystemAdmin) {
    return next();
  }

  const workspaceRole = req.workspaceMembership?.workspaceRole;
  if (workspaceRole === "owner" || workspaceRole === "manager") {
    return next();
  }

  if (hasAnyFinanceRole(req.workspaceMembership, ["finance_staff"])) {
    return next();
  }

  return res.status(403).json({ message: "Finance staff access is required for this finance action." });
}

function serializeBankAccount(account) {
  return {
    id: account._id.toString(),
    workspaceId: account.workspaceId?.toString?.() || null,
    accountName: account.accountName,
    accountType: account.accountType || "checking",
    currency: normalizeCurrencyCode(account.currency || "USD"),
    currentBalance: Number(account.currentBalance || 0),
    lastSyncedAt: account.lastSyncedAt || null,
    provider: account.provider || "",
    providerAccountId: account.providerAccountId || "",
    plaidItemId: account.plaidItemId || "",
    plaidAccountId: account.plaidAccountId || "",
    plaidInstitutionName: account.plaidInstitutionName || "",
    plaidMask: account.plaidMask || "",
    isManual: account.isManual !== false,
    status: account.status || "active",
    createdAt: account.createdAt,
    updatedAt: account.updatedAt
  };
}

function serializeBankTransaction(transaction) {
  return {
    id: transaction._id.toString(),
    workspaceId: transaction.workspaceId?.toString?.() || null,
    bankAccountId: transaction.bankAccountId?._id?.toString?.() || transaction.bankAccountId?.toString?.() || null,
    transactionDate: transaction.transactionDate,
    description: transaction.description || "",
    amount: Number(transaction.amount || 0),
    currency: normalizeCurrencyCode(transaction.currency || "USD"),
    category: transaction.category || "",
    providerTransactionId: transaction.providerTransactionId || "",
    matchedExpenseId: transaction.matchedExpenseId?._id?.toString?.() || transaction.matchedExpenseId?.toString?.() || null,
    matchedInvoicePaymentId: transaction.matchedInvoicePaymentId || "",
    matchConfidence: Number(transaction.matchConfidence || 0),
    matchSuggestions: Array.isArray(transaction.matchSuggestions)
      ? transaction.matchSuggestions.map((suggestion) => ({
          referenceType: suggestion.referenceType,
          referenceId: suggestion.referenceId,
          confidence: Number(suggestion.confidence || 0),
          label: suggestion.label || "",
          amount: Number(suggestion.amount || 0),
          currency: normalizeCurrencyCode(suggestion.currency || "USD"),
          transactionDate: suggestion.transactionDate || null
        }))
      : [],
    reconciled: Boolean(transaction.reconciled),
    reconciledAt: transaction.reconciledAt || null,
    source: transaction.source || "manual",
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt
  };
}

function plaidUnavailable(res) {
  return res.status(503).json({ message: "Plaid integration not configured" });
}

function requirePlaidConfigured(_req, res, next) {
  if (!isPlaidConfigured()) {
    return plaidUnavailable(res);
  }

  return next();
}

async function loadBankAccount(req, accountId) {
  return BankAccount.findOne(buildScopedWorkspaceFilter(req, { _id: accountId }));
}

async function loadBankTransaction(req, transactionId) {
  return BankTransaction.findOne(buildScopedWorkspaceFilter(req, { _id: transactionId }))
    .populate("bankAccountId", "accountName currency")
    .populate("matchedExpenseId", "vendorName amount status currency");
}

router.get("/bank-accounts", requireFinanceViewer, async (req, res) => {
  try {
    const accounts = await BankAccount.find(buildScopedWorkspaceFilter(req))
      .sort({ updatedAt: -1, createdAt: -1 });

    return res.json(accounts.map(serializeBankAccount));
  } catch (error) {
    return res.status(500).json({ message: "Unable to load bank accounts." });
  }
});

router.post("/bank-accounts", requireFinanceStaff, async (req, res) => {
  try {
    if (!String(req.body.accountName || "").trim()) {
      return res.status(400).json({ message: "Bank account name is required." });
    }

    const currency = normalizeCurrencyCode(req.body.currency || req.workspace?.defaultCurrency || "USD");
    const currencyError = ensureCurrencySupported(currency, "Bank account currency");
    if (currencyError) {
      return res.status(400).json({ message: currencyError });
    }

    const accountType = ["checking", "savings", "credit", "other"].includes(String(req.body.accountType || "checking"))
      ? String(req.body.accountType || "checking")
      : null;
    if (!accountType) {
      return res.status(400).json({ message: "Bank account type is invalid." });
    }

    const balance = Number(req.body.currentBalance || 0);
    if (!Number.isFinite(balance)) {
      return res.status(400).json({ message: "Current balance must be a valid number." });
    }

    const account = await BankAccount.create({
      workspaceId: req.workspaceId,
      accountName: String(req.body.accountName).trim(),
      accountType,
      currency,
      currentBalance: Number(balance.toFixed(2)),
      provider: String(req.body.provider || "").trim(),
      providerAccountId: String(req.body.providerAccountId || "").trim(),
      isManual: true,
      status: "active"
    });

    await writeAuditLog({
      actor: req.user._id,
      action: "finance.bank_account.create",
      targetId: account._id.toString(),
      targetType: "BankAccount",
      metadata: {
        workspaceId: req.workspaceId?.toString?.() || null,
        accountName: account.accountName
      }
    });

    return res.status(201).json(serializeBankAccount(account));
  } catch (error) {
    return res.status(500).json({ message: "Unable to create bank account." });
  }
});

router.post("/bank-accounts/plaid/create-link-token", requireFinanceStaff, requirePlaidConfigured, async (req, res) => {
  try {
    const linkToken = await createLinkToken(req.user._id.toString(), req.workspaceId?.toString?.() || "");
    return res.json({ linkToken });
  } catch (_error) {
    return res.status(500).json({ message: "Unable to create Plaid link token." });
  }
});

router.post("/bank-accounts/plaid/exchange-token", requireFinanceStaff, requirePlaidConfigured, async (req, res) => {
  try {
    const publicToken = String(req.body.publicToken || "").trim();
    if (!publicToken) {
      return res.status(400).json({ message: "Plaid public token is required." });
    }

    const accountName = String(req.body.accountName || "").trim();
    if (!accountName) {
      return res.status(400).json({ message: "Bank account name is required." });
    }

    const currency = normalizeCurrencyCode(req.body.currency || req.workspace?.defaultCurrency || "USD");
    const currencyError = ensureCurrencySupported(currency, "Bank account currency");
    if (currencyError) {
      return res.status(400).json({ message: currencyError });
    }

    const { accessToken, itemId } = await exchangePublicToken(publicToken);
    const plaidAccountId = String(req.body.plaidAccountId || req.body.accountId || "").trim();
    const account = await BankAccount.create({
      workspaceId: req.workspaceId,
      accountName,
      accountType: ["checking", "savings", "credit", "other"].includes(String(req.body.accountType || "checking"))
        ? String(req.body.accountType || "checking")
        : "checking",
      currency,
      currentBalance: Number(Number(req.body.currentBalance || 0).toFixed(2)),
      provider: "plaid",
      providerAccountId: plaidAccountId || itemId,
      plaidAccessToken: accessToken,
      plaidItemId: itemId,
      plaidAccountId,
      plaidInstitutionName: String(req.body.institutionName || "").trim(),
      plaidMask: String(req.body.mask || "").trim(),
      isManual: false,
      status: "active"
    });

    return res.status(201).json(serializeBankAccount(account));
  } catch (_error) {
    return res.status(500).json({ message: "Unable to connect Plaid bank account." });
  }
});

router.patch("/bank-accounts/:id", requireFinanceStaff, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid bank account id." });
    }

    const account = await loadBankAccount(req, req.params.id);
    if (!account) {
      return res.status(404).json({ message: "Bank account not found." });
    }

    if (req.body.accountName !== undefined) {
      if (!String(req.body.accountName || "").trim()) {
        return res.status(400).json({ message: "Bank account name is required." });
      }
      account.accountName = String(req.body.accountName).trim();
    }

    if (req.body.accountType !== undefined) {
      const nextType = String(req.body.accountType || "").trim();
      if (!["checking", "savings", "credit", "other"].includes(nextType)) {
        return res.status(400).json({ message: "Bank account type is invalid." });
      }
      account.accountType = nextType;
    }

    if (req.body.currentBalance !== undefined) {
      const balance = Number(req.body.currentBalance);
      if (!Number.isFinite(balance)) {
        return res.status(400).json({ message: "Current balance must be a valid number." });
      }
      account.currentBalance = Number(balance.toFixed(2));
    }

    await account.save();
    return res.json(serializeBankAccount(account));
  } catch (error) {
    return res.status(500).json({ message: "Unable to update bank account." });
  }
});

router.delete("/bank-accounts/:id", requireFinanceStaff, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid bank account id." });
    }

    const account = await BankAccount.findOneAndUpdate(
      buildScopedWorkspaceFilter(req, { _id: req.params.id }),
      {
        $set: {
          status: "disconnected"
        }
      },
      { new: true }
    );

    if (!account) {
      return res.status(404).json({ message: "Bank account not found." });
    }

    return res.json(serializeBankAccount(account));
  } catch (error) {
    return res.status(500).json({ message: "Unable to disconnect bank account." });
  }
});

router.get("/bank-accounts/:id/transactions", requireFinanceViewer, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid bank account id." });
    }

    const account = await loadBankAccount(req, req.params.id);
    if (!account) {
      return res.status(404).json({ message: "Bank account not found." });
    }

    const filter = buildScopedWorkspaceFilter(req, { bankAccountId: account._id });
    if (req.query.startDate || req.query.endDate) {
      filter.transactionDate = {};
      if (req.query.startDate) {
        const startDate = new Date(req.query.startDate);
        if (!Number.isNaN(startDate.getTime())) {
          filter.transactionDate.$gte = startDate;
        }
      }
      if (req.query.endDate) {
        const endDate = new Date(req.query.endDate);
        if (!Number.isNaN(endDate.getTime())) {
          endDate.setUTCHours(23, 59, 59, 999);
          filter.transactionDate.$lte = endDate;
        }
      }
    }

    const transactions = await BankTransaction.find(filter)
      .sort({ transactionDate: -1, createdAt: -1 })
      .limit(200)
      .populate("bankAccountId", "accountName currency")
      .populate("matchedExpenseId", "vendorName amount status currency");

    return res.json(transactions.map(serializeBankTransaction));
  } catch (error) {
    return res.status(500).json({ message: "Unable to load bank transactions." });
  }
});

router.post("/bank-accounts/:id/transactions", requireFinanceStaff, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid bank account id." });
    }

    const account = await loadBankAccount(req, req.params.id);
    if (!account) {
      return res.status(404).json({ message: "Bank account not found." });
    }

    if (!String(req.body.description || "").trim()) {
      return res.status(400).json({ message: "Transaction description is required." });
    }

    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount === 0) {
      return res.status(400).json({ message: "Transaction amount must be a non-zero number." });
    }

    const transactionDate = req.body.transactionDate ? new Date(req.body.transactionDate) : new Date();
    if (Number.isNaN(transactionDate.getTime())) {
      return res.status(400).json({ message: "Transaction date must be valid." });
    }

    const currency = normalizeCurrencyCode(req.body.currency || account.currency || req.workspace?.defaultCurrency || "USD");
    const currencyError = ensureCurrencySupported(currency, "Transaction currency");
    if (currencyError) {
      return res.status(400).json({ message: currencyError });
    }

    const transaction = await BankTransaction.create({
      workspaceId: req.workspaceId,
      bankAccountId: account._id,
      transactionDate,
      description: String(req.body.description).trim(),
      amount: Number(amount.toFixed(2)),
      currency,
      category: String(req.body.category || "").trim(),
      providerTransactionId: String(req.body.providerTransactionId || "").trim(),
      source: "manual"
    });

    account.currentBalance = Number((Number(account.currentBalance || 0) + Number(transaction.amount || 0)).toFixed(2));
    account.lastSyncedAt = new Date();
    await account.save();

    const populated = await loadBankTransaction(req, transaction._id);
    return res.status(201).json(serializeBankTransaction(populated));
  } catch (error) {
    return res.status(500).json({ message: "Unable to create bank transaction." });
  }
});

router.patch("/bank-transactions/:id/match-expense", requireFinanceStaff, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid bank transaction id." });
    }
    if (!mongoose.isValidObjectId(req.body.expenseId)) {
      return res.status(400).json({ message: "Expense is invalid." });
    }

    const [transaction, expense] = await Promise.all([
      loadBankTransaction(req, req.params.id),
      ExpenseRecord.findOne(buildScopedWorkspaceFilter(req, { _id: req.body.expenseId })).select("_id amount currency status vendorName")
    ]);

    if (!transaction) {
      return res.status(404).json({ message: "Bank transaction not found." });
    }
    if (!expense) {
      return res.status(404).json({ message: "Expense not found." });
    }

    transaction.matchedExpenseId = expense._id;
    transaction.matchConfidence = 100;
    transaction.matchSuggestions = [];
    await transaction.save();

    const populated = await loadBankTransaction(req, transaction._id);
    return res.json(serializeBankTransaction(populated));
  } catch (error) {
    return res.status(500).json({ message: "Unable to match bank transaction to expense." });
  }
});

router.patch("/bank-transactions/:id/match-payment", requireFinanceStaff, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid bank transaction id." });
    }

    const paymentId = String(req.body.paymentId || "").trim();
    if (!paymentId) {
      return res.status(400).json({ message: "Invoice payment id is required." });
    }

    const transaction = await loadBankTransaction(req, req.params.id);
    if (!transaction) {
      return res.status(404).json({ message: "Bank transaction not found." });
    }

    const invoice = await InvoiceRecord.findOne(buildScopedWorkspaceFilter(req, { "payments._id": paymentId })).select("_id invoiceNumber");
    if (!invoice) {
      return res.status(404).json({ message: "Invoice payment not found." });
    }

    transaction.matchedInvoicePaymentId = paymentId;
    transaction.matchConfidence = 100;
    transaction.matchSuggestions = [];
    await transaction.save();

    const populated = await loadBankTransaction(req, transaction._id);
    return res.json(serializeBankTransaction(populated));
  } catch (error) {
    return res.status(500).json({ message: "Unable to match bank transaction to invoice payment." });
  }
});

router.patch("/bank-transactions/:id/reconcile", requireFinanceStaff, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid bank transaction id." });
    }

    const transaction = await BankTransaction.findOneAndUpdate(
      buildScopedWorkspaceFilter(req, { _id: req.params.id }),
      {
        $set: {
          reconciled: true,
          reconciledAt: new Date()
        }
      },
      { new: true }
    )
      .populate("bankAccountId", "accountName currency")
      .populate("matchedExpenseId", "vendorName amount status currency");

    if (!transaction) {
      return res.status(404).json({ message: "Bank transaction not found." });
    }

    return res.json(serializeBankTransaction(transaction));
  } catch (error) {
    return res.status(500).json({ message: "Unable to reconcile bank transaction." });
  }
});

router.post("/bank-accounts/:id/sync", requireFinanceStaff, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid bank account id." });
    }

    const account = await loadBankAccount(req, req.params.id);
    if (!account) {
      return res.status(404).json({ message: "Bank account not found." });
    }

    if (!Array.isArray(req.body.transactions)) {
      return res.status(400).json({ message: "Transactions payload must be an array." });
    }

    const result = await syncBankAccount(account._id, req.body.transactions);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: "Unable to sync bank transactions." });
  }
});

router.post("/bank-accounts/:id/auto-match", requireFinanceStaff, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid bank account id." });
    }

    const account = await loadBankAccount(req, req.params.id);
    if (!account) {
      return res.status(404).json({ message: "Bank account not found." });
    }

    const results = await matchTransactions(req.workspaceId, account._id);
    return res.json(results.map(serializeBankMatchResult));
  } catch (error) {
    return res.status(500).json({ message: "Unable to auto-match bank transactions." });
  }
});

router.post("/bank-accounts/:id/reconcile-matched", requireFinanceStaff, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid bank account id." });
    }

    const account = await loadBankAccount(req, req.params.id);
    if (!account) {
      return res.status(404).json({ message: "Bank account not found." });
    }

    const result = await reconcileMatched(req.workspaceId, account._id);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: "Unable to reconcile matched bank transactions." });
  }
});

router.post("/bank-accounts/:id/plaid/sync", requireFinanceStaff, requirePlaidConfigured, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid bank account id." });
    }

    const account = await loadBankAccount(req, req.params.id);
    if (!account) {
      return res.status(404).json({ message: "Bank account not found." });
    }
    if (!account.plaidAccessToken || !account.plaidAccountId) {
      return res.status(400).json({ message: "Plaid account is not fully configured." });
    }

    const endDate = new Date();
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const transactions = await fetchPlaidTransactions(
      account.plaidAccessToken,
      startDate.toISOString().slice(0, 10),
      endDate.toISOString().slice(0, 10)
    );
    const filteredTransactions = transactions.filter(
      (entry) => !entry.plaidAccountId || entry.plaidAccountId === account.plaidAccountId
    );
    const syncResult = await syncBankAccount(account._id, filteredTransactions);
    const balance = await fetchAccountBalance(account.plaidAccessToken, account.plaidAccountId);

    account.currentBalance = Number(Number(balance.balance || 0).toFixed(2));
    account.lastSyncedAt = new Date();
    if (balance.currency) {
      account.currency = normalizeCurrencyCode(balance.currency);
    }
    if (balance.mask) {
      account.plaidMask = balance.mask;
    }
    if (balance.institutionName) {
      account.plaidInstitutionName = balance.institutionName;
    }
    await account.save();

    return res.json({
      ...syncResult,
      account: serializeBankAccount(account)
    });
  } catch (_error) {
    return res.status(500).json({ message: "Unable to sync Plaid bank account." });
  }
});

router.post("/bank-accounts/:id/plaid/refresh-balance", requireFinanceStaff, requirePlaidConfigured, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid bank account id." });
    }

    const account = await loadBankAccount(req, req.params.id);
    if (!account) {
      return res.status(404).json({ message: "Bank account not found." });
    }
    if (!account.plaidAccessToken || !account.plaidAccountId) {
      return res.status(400).json({ message: "Plaid account is not fully configured." });
    }

    const balance = await fetchAccountBalance(account.plaidAccessToken, account.plaidAccountId);
    account.currentBalance = Number(Number(balance.balance || 0).toFixed(2));
    account.lastSyncedAt = new Date();
    if (balance.currency) {
      account.currency = normalizeCurrencyCode(balance.currency);
    }
    if (balance.mask) {
      account.plaidMask = balance.mask;
    }
    if (balance.institutionName) {
      account.plaidInstitutionName = balance.institutionName;
    }
    await account.save();

    return res.json(serializeBankAccount(account));
  } catch (_error) {
    return res.status(500).json({ message: "Unable to refresh Plaid balance." });
  }
});

router.post("/webhooks/plaid", async (req, res) => {
  try {
    if (!isPlaidConfigured()) {
      return plaidUnavailable(res);
    }

    const signatureHeader = req.get("x-plaid-signature") || req.get("plaid-verification");
    const rawBody = JSON.stringify(req.body || {});
    if (!verifyPlaidWebhookSignature(rawBody, signatureHeader)) {
      return res.status(401).json({ message: "Invalid Plaid webhook signature." });
    }

    if (req.body?.webhook_type !== "TRANSACTIONS" || req.body?.webhook_code !== "SYNC_UPDATES_AVAILABLE") {
      return res.json({ received: true, ignored: true });
    }

    const itemId = String(req.body?.item_id || "").trim();
    if (!itemId) {
      return res.status(400).json({ message: "Plaid webhook item id is required." });
    }

    const account = await BankAccount.findOne({
      plaidItemId: itemId,
      status: { $ne: "disconnected" }
    });

    if (!account?.plaidAccessToken || !account?.plaidAccountId) {
      return res.json({ received: true, ignored: true });
    }

    const endDate = new Date();
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const transactions = await fetchPlaidTransactions(
      account.plaidAccessToken,
      startDate.toISOString().slice(0, 10),
      endDate.toISOString().slice(0, 10)
    );
    const filteredTransactions = transactions.filter(
      (entry) => !entry.plaidAccountId || entry.plaidAccountId === account.plaidAccountId
    );
    const syncResult = await syncBankAccount(account._id, filteredTransactions);

    account.lastSyncedAt = new Date();
    await account.save();

    return res.json({ received: true, ...syncResult });
  } catch (_error) {
    return res.status(500).json({ message: "Unable to process Plaid webhook." });
  }
});

export default router;
