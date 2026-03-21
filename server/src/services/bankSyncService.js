import crypto from "node:crypto";

import mongoose from "mongoose";

import { BankAccount } from "../models/BankAccount.js";
import { BankTransaction } from "../models/BankTransaction.js";
import { ExpenseRecord } from "../models/ExpenseRecord.js";
import { InvoiceRecord } from "../models/InvoiceRecord.js";
import { normalizeCurrencyCode } from "../utils/currency.js";

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function buildSyntheticProviderTransactionId(transaction = {}) {
  const base = [
    String(transaction.transactionDate || "").trim(),
    String(transaction.description || "").trim().toLowerCase(),
    roundMoney(transaction.amount || 0),
    normalizeCurrencyCode(transaction.currency || "USD")
  ].join("|");

  return `manual-${crypto.createHash("sha1").update(base).digest("hex")}`;
}

function normalizeRawTransaction(rawTransaction = {}, bankAccount) {
  const transactionDate = rawTransaction.transactionDate ? new Date(rawTransaction.transactionDate) : new Date();
  if (Number.isNaN(transactionDate.getTime())) {
    throw new Error("Transaction date must be valid.");
  }

  const amount = Number(rawTransaction.amount);
  if (!Number.isFinite(amount) || amount === 0) {
    throw new Error("Transaction amount must be a non-zero number.");
  }

  const description = String(rawTransaction.description || "").trim();
  if (!description) {
    throw new Error("Transaction description is required.");
  }

  const currency = normalizeCurrencyCode(rawTransaction.currency || bankAccount.currency || "USD");
  const providerTransactionId = String(rawTransaction.providerTransactionId || "").trim() || buildSyntheticProviderTransactionId({
    transactionDate,
    description,
    amount,
    currency
  });

  return {
    transactionDate,
    description,
    amount: roundMoney(amount),
    currency,
    category: String(rawTransaction.category || "").trim() || "other",
    providerTransactionId,
    source: rawTransaction.source === "bank_sync" ? "bank_sync" : "manual"
  };
}

function amountConfidence(transactionAmount, recordAmount) {
  const absoluteTransaction = Math.abs(Number(transactionAmount || 0));
  const absoluteRecord = Math.abs(Number(recordAmount || 0));
  const largerAmount = Math.max(absoluteTransaction, absoluteRecord, 0.01);
  const deltaRatio = Math.abs(absoluteTransaction - absoluteRecord) / largerAmount;
  if (deltaRatio > 0.01) {
    return 0;
  }

  return Math.max(0, 70 - Math.round(deltaRatio * 7000));
}

function dateConfidence(firstDate, secondDate) {
  const left = new Date(firstDate);
  const right = new Date(secondDate);
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) {
    return 0;
  }

  const diffDays = Math.abs(left.getTime() - right.getTime()) / (24 * 60 * 60 * 1000);
  if (diffDays > 7) {
    return 0;
  }

  return Math.max(0, 30 - Math.round(diffDays * 4));
}

function buildExpenseSuggestion(transaction, expense) {
  const amountScore = amountConfidence(transaction.amount, expense.amount);
  const dateScore = dateConfidence(transaction.transactionDate, expense.expenseDate || expense.updatedAt || expense.createdAt);
  const confidence = Math.min(100, amountScore + dateScore);

  if (confidence <= 0) {
    return null;
  }

  return {
    referenceType: "expense",
    referenceId: expense._id.toString(),
    confidence,
    label: expense.vendorName || expense.category || "Expense",
    amount: Number(expense.amount || 0),
    currency: normalizeCurrencyCode(expense.currency || "USD"),
    transactionDate: expense.expenseDate || expense.updatedAt || expense.createdAt || null
  };
}

function buildInvoicePaymentSuggestion(transaction, invoice, payment) {
  const amountScore = amountConfidence(transaction.amount, payment.amount);
  const dateScore = dateConfidence(transaction.transactionDate, payment.recordedAt || invoice.updatedAt || invoice.createdAt);
  const confidence = Math.min(100, amountScore + dateScore);

  if (confidence <= 0) {
    return null;
  }

  return {
    referenceType: "invoice_payment",
    referenceId: payment._id?.toString?.() || "",
    confidence,
    label: invoice.invoiceNumber || invoice.customerName || "Invoice payment",
    amount: Number(payment.amount || 0),
    currency: normalizeCurrencyCode(invoice.currency || "USD"),
    transactionDate: payment.recordedAt || invoice.updatedAt || invoice.createdAt || null
  };
}

export async function syncBankAccount(bankAccountId, transactions = []) {
  const account = await BankAccount.findById(bankAccountId);
  if (!account) {
    throw new Error("Bank account not found.");
  }

  const result = {
    imported: 0,
    duplicates: 0,
    errors: []
  };

  for (const rawTransaction of Array.isArray(transactions) ? transactions : []) {
    try {
      const normalized = normalizeRawTransaction(rawTransaction, account);
      const existing = await BankTransaction.findOne({
        workspaceId: account.workspaceId,
        providerTransactionId: normalized.providerTransactionId
      }).select("_id");

      if (existing) {
        result.duplicates += 1;
        continue;
      }

      await BankTransaction.create({
        workspaceId: account.workspaceId,
        bankAccountId: account._id,
        transactionDate: normalized.transactionDate,
        description: normalized.description,
        amount: normalized.amount,
        currency: normalized.currency,
        category: normalized.category,
        providerTransactionId: normalized.providerTransactionId,
        source: normalized.source,
        reconciled: false,
        matchConfidence: 0,
        matchSuggestions: []
      });

      result.imported += 1;
    } catch (error) {
      result.errors.push(error?.message || "Unable to import transaction.");
    }
  }

  account.lastSyncedAt = new Date();
  await account.save();

  return result;
}

export async function matchTransactions(workspaceId, bankAccountId) {
  const [transactions, expenses, invoices] = await Promise.all([
    BankTransaction.find({
      workspaceId,
      bankAccountId,
      reconciled: false,
      $or: [{ matchedExpenseId: null }, { matchedExpenseId: { $exists: false } }],
      matchedInvoicePaymentId: ""
    }).sort({ transactionDate: -1, createdAt: -1 }),
    ExpenseRecord.find({
      workspaceId,
      status: { $in: ["approved", "reimbursed", "reconciled"] }
    }).select("_id amount currency vendorName expenseDate updatedAt createdAt"),
    InvoiceRecord.find({
      workspaceId,
      "payments.0": { $exists: true }
    }).select("_id invoiceNumber customerName currency payments updatedAt createdAt")
  ]);

  const suggestions = [];

  for (const transaction of transactions) {
    const transactionCurrency = normalizeCurrencyCode(transaction.currency || "USD");
    const candidateSuggestions = [];

    for (const expense of expenses) {
      if (normalizeCurrencyCode(expense.currency || "USD") !== transactionCurrency) {
        continue;
      }

      const suggestion = buildExpenseSuggestion(transaction, expense);
      if (suggestion) {
        candidateSuggestions.push(suggestion);
      }
    }

    for (const invoice of invoices) {
      const invoiceCurrency = normalizeCurrencyCode(invoice.currency || "USD");
      if (invoiceCurrency !== transactionCurrency) {
        continue;
      }

      for (const payment of Array.isArray(invoice.payments) ? invoice.payments : []) {
        if (!payment?._id) {
          continue;
        }
        const suggestion = buildInvoicePaymentSuggestion(transaction, invoice, payment);
        if (suggestion) {
          candidateSuggestions.push(suggestion);
        }
      }
    }

    candidateSuggestions.sort((left, right) => right.confidence - left.confidence);
    const topSuggestions = candidateSuggestions.slice(0, 5);
    const topConfidence = Number(topSuggestions[0]?.confidence || 0);

    transaction.matchSuggestions = topSuggestions;
    transaction.matchConfidence = topConfidence;
    await transaction.save();

    suggestions.push({
      transaction,
      suggestions: topSuggestions
    });
  }

  return suggestions;
}

export async function reconcileMatched(workspaceId, bankAccountId) {
  const reconciledAt = new Date();
  const result = await BankTransaction.updateMany(
    {
      workspaceId,
      bankAccountId,
      reconciled: false,
      $or: [
        { matchedExpenseId: { $ne: null } },
        { matchedInvoicePaymentId: { $ne: "" } }
      ]
    },
    {
      $set: {
        reconciled: true,
        reconciledAt
      }
    }
  );

  return {
    reconciled: Number(result.modifiedCount || 0),
    reconciledAt
  };
}

export function serializeBankMatchResult(entry = {}) {
  const transaction = entry.transaction;
  return {
    transaction: transaction
      ? {
          id: transaction._id.toString(),
          bankAccountId: transaction.bankAccountId?.toString?.() || null,
          transactionDate: transaction.transactionDate,
          description: transaction.description || "",
          amount: Number(transaction.amount || 0),
          currency: normalizeCurrencyCode(transaction.currency || "USD"),
          category: transaction.category || "",
          providerTransactionId: transaction.providerTransactionId || "",
          matchConfidence: Number(transaction.matchConfidence || 0)
        }
      : null,
    suggestions: Array.isArray(entry.suggestions) ? entry.suggestions : []
  };
}

export async function loadBankSyncContext(bankAccountId, workspaceId = null) {
  const filter = { _id: bankAccountId };
  if (workspaceId) {
    filter.workspaceId = workspaceId;
  }
  return BankAccount.findOne(filter);
}

export function isValidBankSyncPayload(payload) {
  return Array.isArray(payload?.transactions);
}

export function bankSyncUsesDuplicateKey(error) {
  return error?.code === 11000 || error instanceof mongoose.Error.ValidationError;
}
