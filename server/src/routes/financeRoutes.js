import express from "express";
import mongoose from "mongoose";
import PDFDocument from "pdfkit";

import { authMiddleware } from "../middleware/auth.js";
import { BankAccount } from "../models/BankAccount.js";
import { BankTransaction } from "../models/BankTransaction.js";
import { ChartOfAccount } from "../models/ChartOfAccount.js";
import { ExpenseRecord } from "../models/ExpenseRecord.js";
import { FinanceActionLog } from "../models/FinanceActionLog.js";
import { FinanceCustomer } from "../models/FinanceCustomer.js";
import { FinancePeriodLock } from "../models/FinancePeriodLock.js";
import { FinanceVendor } from "../models/FinanceVendor.js";
import { InvoiceRecord } from "../models/InvoiceRecord.js";
import { JournalEntry } from "../models/JournalEntry.js";
import { PayrollRecord } from "../models/PayrollRecord.js";
import { User } from "../models/User.js";
import { WarehouseProduct } from "../models/WarehouseProduct.js";
import { WorkspaceMembership } from "../models/WorkspaceMembership.js";
import { getCachedRates } from "../services/fxRateService.js";
import { writeAuditLog } from "../utils/audit.js";
import {
  ensureWorkspaceChartOfAccounts,
  serializeChartOfAccount,
  serializeJournalEntry,
  syncExpenseAccounting,
  syncInvoiceAccounting
} from "../utils/accounting.js";
import {
  convertAmount,
  ensureCurrencySupported as ensureSupportedCurrency,
  getLiveRateTimestamp,
  isUsingLiveRates,
  STATIC_EXCHANGE_RATES,
  SUPPORTED_CURRENCY_CODES
} from "../utils/currency.js";
import {
  buildWorkspaceFilter,
  isAccountingEnabledForWorkspace,
  listWorkspaceMembershipsForUser,
  serializeWorkspace,
  serializeWorkspaceMembership,
  workspaceContextMiddleware,
  workspaceMembershipMiddleware
} from "../utils/workspaceContext.js";

const router = express.Router();

router.use(authMiddleware);

const SUPPORTED_CURRENCIES = new Set(SUPPORTED_CURRENCY_CODES);

const STATUS_GROUPS = {
  outstanding: ["pending_review", "approved", "partial", "overdue"],
  pending: ["pending_review", "new"],
  reconcilable: ["approved", "partial", "paid"],
  overdue: ["overdue"],
  paid: ["paid"],
  settled: ["paid", "reconciled"],
  dueAttention: ["pending_review", "approved", "partial"]
};

const INVOICE_TRANSITIONS = {
  new: ["pending_review", "rejected"],
  pending_review: ["approved", "rejected"],
  approved: ["partial", "paid", "overdue", "reconciled"],
  partial: ["paid", "overdue", "reconciled"],
  paid: ["reconciled", "rejected"],
  overdue: ["paid", "partial", "rejected"],
  reconciled: [],
  rejected: [],
  flagged: ["pending_review", "rejected"]
};

const EXPENSE_TRANSITIONS = {
  draft: ["pending_review", "rejected"],
  pending_review: ["approved", "rejected"],
  approved: ["reimbursed", "reconciled", "rejected"],
  reimbursed: ["reconciled"],
  reconciled: [],
  rejected: []
};

function toCents(value) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.round(numericValue * 100);
}

function fromCents(value) {
  return Number((Number(value || 0) / 100).toFixed(2));
}

function normalizeCurrencyCode(value, fallback = "USD") {
  const code = String(value || "").trim().toUpperCase();
  return code || fallback;
}

function addMoneyToCurrencyBucket(bucket = {}, currency = "USD", amount = 0) {
  const normalizedCurrency = normalizeCurrencyCode(currency);
  const currentCents = toCents(bucket[normalizedCurrency] || 0);
  const nextCents = currentCents + toCents(amount);
  bucket[normalizedCurrency] = fromCents(nextCents);
  return bucket;
}

function sumCurrencyBucketCents(bucket = {}) {
  return Object.values(bucket).reduce((sum, amount) => sum + toCents(amount || 0), 0);
}

function parseQueryInt(value, defaultValue, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }

  return Math.min(Math.max(parsed, minimum), maximum);
}

function ensureCurrencySupported(value, label = "Currency") {
  return ensureSupportedCurrency(value, label);
}

function buildFinanceTotalsByCurrency({
  totalInvoiced = {},
  outstandingAmount = {},
  paidAmount = {},
  overdueAmount = {}
} = {}) {
  const currencies = [...new Set([
    ...Object.keys(totalInvoiced || {}),
    ...Object.keys(outstandingAmount || {}),
    ...Object.keys(paidAmount || {}),
    ...Object.keys(overdueAmount || {})
  ])];

  return Object.fromEntries(
    currencies.map((currency) => [
      currency,
      {
        totalInvoiced: Number(totalInvoiced?.[currency] || 0),
        outstandingAmount: Number(outstandingAmount?.[currency] || 0),
        paidAmount: Number(paidAmount?.[currency] || 0),
        overdueAmount: Number(overdueAmount?.[currency] || 0)
      }
    ])
  );
}

function buildJournalTotalsByCurrency(serializedJournals = []) {
  return serializedJournals.reduce((accumulator, entry) => {
    const currency = normalizeCurrencyCode(entry?.metadata?.currency || "USD");
    const bucket = accumulator[currency] || {
      totalEntries: 0,
      postedEntries: 0,
      voidedEntries: 0,
      totalDebits: 0,
      totalCredits: 0,
      entryTypeBreakdown: {}
    };

    bucket.totalEntries += 1;
    bucket.totalDebits = Number((bucket.totalDebits + Number(entry.totalDebit || 0)).toFixed(2));
    bucket.totalCredits = Number((bucket.totalCredits + Number(entry.totalCredit || 0)).toFixed(2));

    if (entry.status === "posted") {
      bucket.postedEntries += 1;
    }

    if (entry.status === "voided") {
      bucket.voidedEntries += 1;
    }

    bucket.entryTypeBreakdown[entry.entryType] = (bucket.entryTypeBreakdown[entry.entryType] || 0) + 1;
    accumulator[currency] = bucket;
    return accumulator;
  }, {});
}

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function computeTaxValues(subtotalInput, taxRateInput = 0) {
  const subtotal = roundMoney(subtotalInput);
  const taxRate = roundMoney(taxRateInput);
  const taxAmount = roundMoney((subtotal * taxRate) / 100);
  const totalWithTax = roundMoney(subtotal + taxAmount);
  return {
    subtotal,
    taxRate,
    taxAmount,
    totalWithTax
  };
}

function buildNormalizationMetadata(baseCurrency = "USD", rates = STATIC_EXCHANGE_RATES) {
  return {
    baseCurrency: normalizeCurrencyCode(baseCurrency),
    approximate: !isUsingLiveRates(),
    rateSource: isUsingLiveRates() ? "live" : "static",
    liveRate: isUsingLiveRates(),
    rateTimestamp: getLiveRateTimestamp(),
    exchangeRates: rates
  };
}

function sumCurrencyBucketInBaseCurrency(bucket = {}, baseCurrency = "USD", rates = STATIC_EXCHANGE_RATES) {
  const normalizedBase = normalizeCurrencyCode(baseCurrency);
  return roundMoney(
    Object.entries(bucket).reduce(
      (sum, [currency, amount]) => sum + convertAmount(amount, currency, normalizedBase, rates),
      0
    )
  );
}

function buildApproximateNormalizedFinanceTotals({
  totalInvoiced = {},
  outstandingAmount = {},
  paidAmount = {},
  overdueAmount = {},
  totalTaxCollected = {},
  totalTaxPaid = {}
} = {}, baseCurrency = "USD", rates = STATIC_EXCHANGE_RATES) {
  const metadata = buildNormalizationMetadata(baseCurrency, rates);
  const normalizedBase = metadata.baseCurrency;
  return {
    ...metadata,
    totalInvoiced: sumCurrencyBucketInBaseCurrency(totalInvoiced, normalizedBase, rates),
    outstandingAmount: sumCurrencyBucketInBaseCurrency(outstandingAmount, normalizedBase, rates),
    paidAmount: sumCurrencyBucketInBaseCurrency(paidAmount, normalizedBase, rates),
    overdueAmount: sumCurrencyBucketInBaseCurrency(overdueAmount, normalizedBase, rates),
    totalTaxCollected: sumCurrencyBucketInBaseCurrency(totalTaxCollected, normalizedBase, rates),
    totalTaxPaid: sumCurrencyBucketInBaseCurrency(totalTaxPaid, normalizedBase, rates)
  };
}

function normalizeDateRangeFilter(query = {}, fieldName) {
  const dateFilter = {};
  if (query.startDate) {
    const startDate = new Date(query.startDate);
    if (!Number.isNaN(startDate.getTime())) {
      dateFilter.$gte = startDate;
    }
  }
  if (query.endDate) {
    const endDate = new Date(query.endDate);
    if (!Number.isNaN(endDate.getTime())) {
      endDate.setUTCHours(23, 59, 59, 999);
      dateFilter.$lte = endDate;
    }
  }

  return Object.keys(dateFilter).length ? { [fieldName]: dateFilter } : {};
}

function serializeCurrencyBucketRows(bucket = {}) {
  return Object.entries(bucket)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amount]) => ({
      currency,
      amount: roundMoney(amount)
    }));
}

function toPeriodKey(dateValue, period = "month") {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;

  if (period === "year") {
    return String(year);
  }

  if (period === "quarter") {
    return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
  }

  return `${year}-${String(month).padStart(2, "0")}`;
}

function addPeriodCurrencyAmount(target, periodKey, currency, amount) {
  if (!target[periodKey]) {
    target[periodKey] = {};
  }
  addMoneyToCurrencyBucket(target[periodKey], currency, amount);
}

function buildPeriodRows(periodBuckets = {}, baseCurrency = "", rates = STATIC_EXCHANGE_RATES) {
  const requestedBaseCurrency = baseCurrency ? normalizeCurrencyCode(baseCurrency) : "";
  return Object.entries(periodBuckets)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([periodKey, totals]) => ({
      periodKey,
      totals,
      normalizedApproximateTotal: requestedBaseCurrency
        ? {
            ...buildNormalizationMetadata(requestedBaseCurrency, rates),
            amount: sumCurrencyBucketInBaseCurrency(totals, requestedBaseCurrency, rates)
          }
        : null
    }));
}

function receivableAgeBucket(daysOverdue) {
  if (daysOverdue <= 30) return "0_30";
  if (daysOverdue <= 60) return "31_60";
  if (daysOverdue <= 90) return "61_90";
  return "90_plus";
}

function cloneCurrencyBucket(bucket = {}) {
  return Object.fromEntries(
    Object.entries(bucket).map(([currency, amount]) => [currency, roundMoney(amount)])
  );
}

function subtractCurrencyBuckets(left = {}, right = {}) {
  const currencies = new Set([...Object.keys(left || {}), ...Object.keys(right || {})]);
  const result = {};

  for (const currency of currencies) {
    result[currency] = roundMoney(Number(left?.[currency] || 0) - Number(right?.[currency] || 0));
  }

  return result;
}

function buildApproximateAmount(amount, baseCurrency = "", rates = STATIC_EXCHANGE_RATES) {
  const normalizedBase = baseCurrency ? normalizeCurrencyCode(baseCurrency) : "";
  if (!normalizedBase) {
    return null;
  }

  return {
    ...buildNormalizationMetadata(normalizedBase, rates),
    amount: roundMoney(amount)
  };
}

function normalizeReportPeriod(value = "month") {
  return ["month", "quarter", "year"].includes(String(value || "").trim()) ? String(value).trim() : "month";
}

function assertValidTransition(map, fromStatus, toStatus, itemLabel) {
  const from = String(fromStatus || "");
  const to = String(toStatus || "");
  const normalizedFrom = map === EXPENSE_TRANSITIONS && from === "submitted" ? "pending_review" : from;
  const normalizedTo = map === EXPENSE_TRANSITIONS && to === "submitted" ? "pending_review" : to;
  if (map === INVOICE_TRANSITIONS && normalizedFrom === "partial" && normalizedTo === "partial") {
    return;
  }
  const allowedTargets = map[normalizedFrom] || [];
  if (!allowedTargets.includes(normalizedTo)) {
    const error = new Error(`Invalid ${itemLabel} status transition from ${from || "unknown"} to ${to || "unknown"}.`);
    error.statusCode = 409;
    error.isPublic = true;
    throw error;
  }
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.isPublic = true;
  return error;
}

function createRetryableInvoicePaymentConflict() {
  const error = new Error("Invoice payment conflicted with another update. Please refresh and try again.");
  error.statusCode = 409;
  error.isPublic = true;
  error.retryableInvoicePaymentConflict = true;
  return error;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function serializeActor(user) {
  if (!user?._id) {
    return null;
  }

  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email
  };
}

function serializeInvoicePayment(payment) {
  return {
    id: payment?._id?.toString?.() || null,
    amount: Number(payment?.amount || 0),
    recordedAt: payment?.recordedAt || null,
    remainingBalance: Number(payment?.remainingBalance || 0),
    method: payment?.method || "",
    reference: payment?.reference || "",
    note: payment?.note || "",
    recordedBy: serializeActor(payment?.recordedBy)
  };
}

function serializeInvoice(invoice) {
  const recurring = invoice.recurring || {
    enabled: false,
    frequency: "monthly",
    interval: 1,
    nextIssueDate: null,
    lastIssuedAt: null
  };
  const outstandingAmount = Math.max(0, Number(invoice.amount || 0) - Number(invoice.paidAmount || 0));
  const recurringDue =
    Boolean(recurring?.enabled) &&
    Boolean(recurring?.nextIssueDate) &&
    !Number.isNaN(new Date(recurring.nextIssueDate).getTime()) &&
    new Date(recurring.nextIssueDate).getTime() <= Date.now();

  return {
    id: invoice._id.toString(),
    workspaceId: invoice.workspaceId?.toString?.() || null,
    invoiceNumber: invoice.invoiceNumber,
    vendorName: invoice.vendorName,
    customer: invoice.customerId
      ? {
          id: invoice.customerId?._id?.toString?.() || invoice.customerId?.toString?.() || null,
          name: invoice.customerName || invoice.customerId?.name || invoice.vendorName,
          email: invoice.customerEmail || invoice.customerId?.email || ""
        }
      : invoice.customerName || invoice.customerEmail
        ? {
            id: null,
            name: invoice.customerName || invoice.vendorName,
            email: invoice.customerEmail || ""
          }
        : null,
    amount: invoice.amount,
    subtotal: Number(invoice.subtotal || invoice.amount || 0),
    taxRate: Number(invoice.taxRate || 0),
    taxAmount: Number(invoice.taxAmount || 0),
    taxLabel: invoice.taxLabel || "Tax",
    totalWithTax: Number(invoice.totalWithTax || invoice.amount || 0),
    currency: invoice.currency,
    dueDate: invoice.dueDate,
    status: invoice.status,
    paidAmount: invoice.paidAmount || 0,
    paidAt: invoice.paidAt || null,
    payments: Array.isArray(invoice.payments) ? invoice.payments.map(serializeInvoicePayment) : [],
    outstandingAmount,
    recurring,
    recurringDue,
    recurringSourceInvoiceId: invoice.recurringSourceInvoiceId?.toString?.() || null,
    recurringSequence: Number(invoice.recurringSequence || 0),
    note: invoice.note || "",
    rejectionReason: invoice.rejectionReason || "",
    threadKey: invoice.threadKey || "financebot",
    attachments: (invoice.attachments || []).map((attachment) => ({
      fileName: attachment.fileName,
      fileUrl: attachment.fileUrl,
      fileType: attachment.fileType,
      uploadedAt: attachment.uploadedAt
    })),
    createdBy: serializeActor(invoice.createdBy),
    approvedBy: serializeActor(invoice.approvedBy),
    rejectedBy: serializeActor(invoice.rejectedBy),
    paidBy: serializeActor(invoice.paidBy),
    reconciledBy: serializeActor(invoice.reconciledBy),
    sourceMessageId: invoice.sourceMessageId?.toString?.() || null,
    accounting: {
      revenueEntryId: invoice.accounting?.revenueEntryId?.toString?.() || null,
      revenueEntryStatus: invoice.accounting?.revenueEntryStatus || "unposted",
      paymentEntryIds: Array.isArray(invoice.accounting?.paymentEntryIds)
        ? invoice.accounting.paymentEntryIds.map((entryId) => entryId?.toString?.() || null).filter(Boolean)
        : [],
      paymentPostedCount: Number(invoice.accounting?.paymentPostedCount || 0),
      controlStatus: invoice.accounting?.controlStatus || "clear",
      blockedReason: invoice.accounting?.blockedReason || "",
      blockedAt: invoice.accounting?.blockedAt || null,
      blockedPeriodKey: invoice.accounting?.blockedPeriodKey || "",
      lastSyncedAt: invoice.accounting?.lastSyncedAt || null
    },
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt
  };
}

function serializeExpense(expense) {
  return {
    id: expense._id.toString(),
    workspaceId: expense.workspaceId?.toString?.() || null,
    amount: expense.amount,
    taxRate: Number(expense.taxRate || 0),
    taxAmount: Number(expense.taxAmount || 0),
    taxLabel: expense.taxLabel || "Tax",
    totalWithTax: Number(expense.totalWithTax || expense.amount || 0),
    currency: expense.currency,
    category: expense.category,
    vendorName: expense.vendorName || "",
    vendor: expense.vendorId
      ? {
          id: expense.vendorId?._id?.toString?.() || expense.vendorId?.toString?.() || null,
          name: expense.vendorName || expense.vendorId?.name || "",
          email: expense.vendorEmail || expense.vendorId?.email || ""
        }
      : expense.vendorName || expense.vendorEmail
        ? {
            id: null,
            name: expense.vendorName || "",
            email: expense.vendorEmail || ""
          }
        : null,
    expenseDate: expense.expenseDate,
    note: expense.note || "",
    status: expense.status,
    threadKey: expense.threadKey || "financebot",
    receipt: expense.receipt
      ? {
          fileName: expense.receipt.fileName,
          fileUrl: expense.receipt.fileUrl,
          fileType: expense.receipt.fileType,
          uploadedAt: expense.receipt.uploadedAt
        }
      : null,
    createdBy: serializeActor(expense.createdBy),
    approvedBy: serializeActor(expense.approvedBy),
    approvedAt: expense.approvedAt || null,
    rejectedBy: serializeActor(expense.rejectedBy),
    rejectedAt: expense.rejectedAt || null,
    rejectionReason: expense.rejectionReason || "",
    reimbursedBy: serializeActor(expense.reimbursedBy),
    reimbursedAt: expense.reimbursedAt || null,
    reimbursement: {
      method: expense.reimbursement?.method || "",
      reference: expense.reimbursement?.reference || "",
      note: expense.reimbursement?.note || ""
    },
    reconciledBy: serializeActor(expense.reconciledBy),
    sourceMessageId: expense.sourceMessageId?.toString?.() || null,
    accounting: {
      expenseEntryId: expense.accounting?.expenseEntryId?.toString?.() || null,
      expenseEntryStatus: expense.accounting?.expenseEntryStatus || "unposted",
      settlementEntryId: expense.accounting?.settlementEntryId?.toString?.() || null,
      settlementEntryStatus: expense.accounting?.settlementEntryStatus || "unposted",
      controlStatus: expense.accounting?.controlStatus || "clear",
      blockedReason: expense.accounting?.blockedReason || "",
      blockedAt: expense.accounting?.blockedAt || null,
      blockedPeriodKey: expense.accounting?.blockedPeriodKey || "",
      lastSyncedAt: expense.accounting?.lastSyncedAt || null
    },
    createdAt: expense.createdAt,
    updatedAt: expense.updatedAt
  };
}

function serializeFinanceCustomer(customer) {
  return {
    id: customer._id.toString(),
    workspaceId: customer.workspaceId?.toString?.() || null,
    name: customer.name,
    email: customer.email || "",
    phone: customer.phone || "",
    contactName: customer.contactName || "",
    notes: customer.notes || "",
    status: customer.status || "active",
    lastUsedAt: customer.lastUsedAt || customer.updatedAt || customer.createdAt || null,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt
  };
}

function serializeFinanceVendor(vendor) {
  return {
    id: vendor._id.toString(),
    workspaceId: vendor.workspaceId?.toString?.() || null,
    name: vendor.name,
    email: vendor.email || "",
    phone: vendor.phone || "",
    contactName: vendor.contactName || "",
    notes: vendor.notes || "",
    status: vendor.status || "active",
    lastUsedAt: vendor.lastUsedAt || vendor.updatedAt || vendor.createdAt || null,
    createdAt: vendor.createdAt,
    updatedAt: vendor.updatedAt
  };
}

function formatMoney(amount, currency = "USD") {
  const normalizedCurrency = normalizeCurrencyCode(currency);
  const safeCurrency = SUPPORTED_CURRENCIES.has(normalizedCurrency) ? normalizedCurrency : "USD";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: safeCurrency
  }).format(Number(amount || 0));
}

function formatPdfDate(value) {
  if (!value) {
    return "Not available";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Not available";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

function formatStatusLabel(status = "") {
  return String(status || "")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function sanitizeDownloadName(value = "invoice") {
  return String(value || "invoice")
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "invoice";
}

function serializeAction(action) {
  return {
    id: action._id.toString(),
    workspaceId: action.workspaceId?.toString?.() || null,
    itemType: action.itemType,
    itemId: action.itemId.toString(),
    action: action.action,
    threadKey: action.threadKey || "financebot",
    metadata: action.metadata || {},
    performedBy: serializeActor(action.performedBy),
    sourceMessageId: action.sourceMessageId?.toString?.() || null,
    createdAt: action.createdAt,
    updatedAt: action.updatedAt
  };
}

async function loadRecentFinanceActions(req, itemType, itemId, limit = 10) {
  return FinanceActionLog.find(
    buildScopedWorkspaceFilter(req, {
      itemType,
      itemId
    })
  )
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("performedBy", "name email");
}

function serializeFinanceMember(membership, user) {
  return {
    id: user?._id?.toString?.() || membership?.userId?.toString?.() || "",
    membershipId: membership?._id?.toString?.() || null,
    name: user?.name || membership?.email || "Workspace member",
    email: user?.email || membership?.email || "",
    isAdmin: Boolean(user?.isAdmin),
    workspaceEnabled: membership?.status !== "suspended",
    workspaceRole: membership?.workspaceRole || "member",
    workspaceRoles: Array.isArray(membership?.financeRoles) ? membership.financeRoles : [],
    workspaceModules: Array.isArray(membership?.modules) ? membership.modules : [],
    presenceStatus: user?.presenceStatus || "offline",
    lastActiveAt: user?.lastActiveAt || null,
    membershipStatus: membership?.status || "active"
  };
}

function getWorkspaceFinanceRoles(membership) {
  return Array.isArray(membership?.financeRoles) ? membership.financeRoles : [];
}

function hasAnyFinanceRole(membership, roles) {
  const assignedRoles = getWorkspaceFinanceRoles(membership);
  return roles.some((role) => assignedRoles.includes(role));
}

function requireFinanceViewer(req, res, next) {
  if (req.user?.isAdmin || req.user?.isSystemAdmin) {
    return next();
  }

  const membership = req.workspaceMembership;
  if (
    membership &&
    Array.isArray(membership.modules) &&
    membership.modules.includes("finance") &&
    membership.status !== "suspended" &&
    hasAnyFinanceRole(membership, ["viewer", "approver", "finance_staff", "accountant"])
  ) {
    return next();
  }

  return res.status(403).json({ message: "Finance workspace access is required." });
}

function requireFinanceApprover(req, res, next) {
  if (hasAnyFinanceRole(req.workspaceMembership, ["approver"])) {
    return next();
  }

  return res.status(403).json({ message: "Approver access is required for this finance action." });
}

function requireFinanceStaff(req, res, next) {
  if (hasAnyFinanceRole(req.workspaceMembership, ["finance_staff"])) {
    return next();
  }

  return res.status(403).json({ message: "Finance staff access is required for this finance action." });
}

function requireFinanceManager(req, res, next) {
  const workspaceRole = req.workspaceMembership?.workspaceRole;

  if (req.user?.isAdmin || workspaceRole === "owner" || workspaceRole === "manager") {
    return next();
  }

  return res.status(403).json({ message: "Manager access is required to manage finance members." });
}

function requireAccountantOrFinanceManager(req, res, next) {
  if (req.user?.isAdmin || req.user?.isSystemAdmin) {
    return next();
  }

  const workspaceRole = req.workspaceMembership?.workspaceRole;
  if (workspaceRole === "owner" || workspaceRole === "manager") {
    return next();
  }

  if (hasAnyFinanceRole(req.workspaceMembership, ["accountant"])) {
    return next();
  }

  return res.status(403).json({ message: "Accountant or finance manager access is required." });
}

function requireSystemAdmin(req, res, next) {
  if (req.user?.isAdmin) {
    return next();
  }

  return res.status(403).json({ message: "System admin access is required for this workspace action." });
}

function validateReceipt(receipt) {
  if (!receipt) {
    return null;
  }

  if (!receipt.fileName || !receipt.fileUrl || !receipt.fileType) {
    return "Receipt details are incomplete.";
  }

  if (String(receipt.fileName).length > 120) {
    return "Receipt file names must be 120 characters or fewer.";
  }

  return null;
}

function validateAttachments(attachments) {
  if (!attachments) {
    return null;
  }

  if (!Array.isArray(attachments)) {
    return "Attachments must be an array.";
  }

  for (const attachment of attachments) {
    if (!attachment?.fileName || !attachment?.fileUrl || !attachment?.fileType) {
      return "Attachment details are incomplete.";
    }
    if (String(attachment.fileName).length > 120) {
      return "Attachment file names must be 120 characters or fewer.";
    }
  }

  return null;
}

function validateRecurringConfig(recurring) {
  if (!recurring) {
    return null;
  }

  if (typeof recurring !== "object") {
    return "Recurring invoice settings are invalid.";
  }

  const enabled = Boolean(recurring.enabled);
  if (!enabled) {
    return null;
  }

  const frequency = String(recurring.frequency || "").trim();
  if (!["weekly", "monthly", "quarterly"].includes(frequency)) {
    return "Recurring invoice frequency is invalid.";
  }

  const interval = Number(recurring.interval || 1);
  if (!Number.isFinite(interval) || interval < 1 || interval > 12) {
    return "Recurring invoice interval must be between 1 and 12.";
  }

  if (recurring.nextIssueDate !== undefined && recurring.nextIssueDate !== null) {
    const nextIssueDate = new Date(recurring.nextIssueDate);
    if (Number.isNaN(nextIssueDate.getTime())) {
      return "Recurring invoice next issue date must be a valid date.";
    }
  }

  return null;
}

function normalizeRecurringConfig(recurring) {
  const enabled = Boolean(recurring?.enabled);

  if (!enabled) {
    return {
      enabled: false,
      frequency: "monthly",
      interval: 1,
      nextIssueDate: null,
      lastIssuedAt: null
    };
  }

  return {
    enabled: true,
    frequency: ["weekly", "monthly", "quarterly"].includes(recurring?.frequency) ? recurring.frequency : "monthly",
    interval: Number.isFinite(Number(recurring?.interval)) ? Math.max(1, Math.min(12, Number(recurring.interval))) : 1,
    nextIssueDate: recurring?.nextIssueDate ? new Date(recurring.nextIssueDate) : null,
    lastIssuedAt: recurring?.lastIssuedAt ? new Date(recurring.lastIssuedAt) : null
  };
}

function addRecurringInterval(baseDate, frequency = "monthly", interval = 1) {
  const nextDate = new Date(baseDate);
  const normalizedInterval = Math.max(1, Math.min(12, Number(interval) || 1));

  if (frequency === "weekly") {
    nextDate.setDate(nextDate.getDate() + normalizedInterval * 7);
    return nextDate;
  }

  function addMonthsSafe(date, months) {
    const result = new Date(date);
    const targetMonth = result.getMonth() + months;
    result.setDate(1);
    result.setMonth(targetMonth);
    const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
    result.setDate(Math.min(date.getDate(), lastDay));
    return result;
  }

  if (frequency === "quarterly") {
    return addMonthsSafe(nextDate, normalizedInterval * 3);
  }

  return addMonthsSafe(nextDate, normalizedInterval);
}

function isRecurringInvoiceDue(recurring) {
  if (!recurring?.enabled || !recurring?.nextIssueDate) {
    return false;
  }

  const nextIssueDate = new Date(recurring.nextIssueDate);
  if (Number.isNaN(nextIssueDate.getTime())) {
    return false;
  }

  return nextIssueDate.getTime() <= Date.now();
}

function buildRecurringInvoiceNumber(invoiceNumber, sequence) {
  const normalizedSequence = Math.max(1, Number(sequence) || 1);
  const baseNumber = String(invoiceNumber || "INV")
    .trim()
    .toUpperCase()
    .replace(/-R\d+$/, "")
    .slice(0, 34);

  return `${baseNumber}-R${normalizedSequence}`;
}

function deriveRecurringDueDate(sourceInvoice, issueDate) {
  const sourceDueDate = sourceInvoice?.dueDate ? new Date(sourceInvoice.dueDate) : null;
  const sourceCreatedAt = sourceInvoice?.createdAt ? new Date(sourceInvoice.createdAt) : null;
  const issueAt = new Date(issueDate);

  if (
    sourceDueDate &&
    sourceCreatedAt &&
    !Number.isNaN(sourceDueDate.getTime()) &&
    !Number.isNaN(sourceCreatedAt.getTime())
  ) {
    const deltaMs = Math.max(0, sourceDueDate.getTime() - sourceCreatedAt.getTime());
    return new Date(issueAt.getTime() + deltaMs);
  }

  return new Date(issueAt);
}

function populateInvoiceRelations(query) {
  return query
    .populate("createdBy approvedBy rejectedBy paidBy reconciledBy", "name email")
    .populate("customerId", "name email")
    .populate("payments.recordedBy", "name email");
}

function normalizeCounterpartyName(...values) {
  return values
    .map((value) => String(value || "").trim())
    .find(Boolean) || "";
}

async function upsertFinanceCustomer(workspaceId, payload = {}) {
  const name = normalizeCounterpartyName(payload.customerName, payload.vendorName);
  const email = String(payload.customerEmail || "").trim().toLowerCase();

  if (!name) {
    return null;
  }

  const normalizedName = name.toLowerCase();
  return FinanceCustomer.findOneAndUpdate(
    {
      workspaceId,
      normalizedName
    },
    {
      $set: {
        name,
        normalizedName,
        email,
        lastUsedAt: new Date(),
        status: "active"
      }
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }
  );
}

async function upsertFinanceVendor(workspaceId, payload = {}) {
  const name = normalizeCounterpartyName(payload.vendorName);
  const email = String(payload.vendorEmail || "").trim().toLowerCase();

  if (!name) {
    return null;
  }

  const normalizedName = name.toLowerCase();
  return FinanceVendor.findOneAndUpdate(
    {
      workspaceId,
      normalizedName
    },
    {
      $set: {
        name,
        normalizedName,
        email,
        lastUsedAt: new Date(),
        status: "active"
      }
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }
  );
}

function validateInvoicePayload(payload = {}, { partial = false } = {}) {
  const errors = [];

  if (!partial || payload.invoiceNumber !== undefined) {
    if (!String(payload.invoiceNumber || "").trim()) {
      errors.push("Invoice number is required.");
    }
  }

  if (!partial || payload.vendorName !== undefined) {
    const counterpartyName = normalizeCounterpartyName(payload.customerName, payload.vendorName);
    if (!counterpartyName) {
      errors.push("Customer name is required.");
    }
  }

  if (!partial || payload.amount !== undefined) {
    const amount = Number(payload.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      errors.push("Amount must be a valid positive number.");
    }
  }

  if (!partial || payload.dueDate !== undefined) {
    const dueDate = new Date(payload.dueDate);
    if (Number.isNaN(dueDate.getTime())) {
      errors.push("Due date must be a valid date.");
    }
  }

  if (!partial || payload.currency !== undefined) {
    if (!String(payload.currency || "").trim()) {
      errors.push("Invoice currency is required.");
    } else {
      const currencyError = ensureCurrencySupported(payload.currency, "Invoice currency");
      if (currencyError) {
        errors.push(currencyError);
      }
    }
  }

  if (payload.taxRate !== undefined) {
    const taxRate = Number(payload.taxRate);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
      errors.push("Tax rate must be between 0 and 100.");
    }
  }

  if (payload.taxLabel !== undefined && String(payload.taxLabel || "").trim().length > 40) {
    errors.push("Tax label must be 40 characters or fewer.");
  }

  if (payload.status !== undefined) {
    const allowedStatuses = ["new", "pending_review", "approved", "partial", "rejected", "paid", "overdue", "reconciled", "flagged"];
    if (!allowedStatuses.includes(payload.status)) {
      errors.push("Invoice status is invalid.");
    }
  }

  if (payload.paidAmount !== undefined) {
    const paidAmount = Number(payload.paidAmount);
    if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
      errors.push("Paid amount must be a valid positive number.");
    }
  }

  const attachmentError = validateAttachments(payload.attachments);
  if (attachmentError) {
    errors.push(attachmentError);
  }

  const recurringError = validateRecurringConfig(payload.recurring);
  if (recurringError) {
    errors.push(recurringError);
  }

  return errors;
}

function validateExpensePayload(payload = {}, { partial = false } = {}) {
  const errors = [];

  if (!partial || payload.amount !== undefined) {
    const amount = Number(payload.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      errors.push("Expense amount must be a valid positive number.");
    }
  }

  if (!partial || payload.currency !== undefined) {
    if (!String(payload.currency || "").trim()) {
      errors.push("Expense currency is required.");
    } else {
      const currencyError = ensureCurrencySupported(payload.currency, "Expense currency");
      if (currencyError) {
        errors.push(currencyError);
      }
    }
  }

  if (payload.taxRate !== undefined) {
    const taxRate = Number(payload.taxRate);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
      errors.push("Tax rate must be between 0 and 100.");
    }
  }

  if (payload.taxLabel !== undefined && String(payload.taxLabel || "").trim().length > 40) {
    errors.push("Tax label must be 40 characters or fewer.");
  }

  if (payload.category !== undefined) {
    const allowedCategories = ["travel", "supplies", "utilities", "salary", "marketing", "other"];
    if (!allowedCategories.includes(payload.category)) {
      errors.push("Expense category is invalid.");
    }
  }

  if (payload.status !== undefined) {
    const allowedStatuses = ["draft", "submitted", "pending_review", "approved", "rejected", "reimbursed", "reconciled"];
    if (!allowedStatuses.includes(payload.status)) {
      errors.push("Expense status is invalid.");
    }
  }

  if (payload.expenseDate !== undefined) {
    const expenseDate = new Date(payload.expenseDate);
    if (Number.isNaN(expenseDate.getTime())) {
      errors.push("Expense date must be a valid date.");
    }
  }

  const receiptError = validateReceipt(payload.receipt);
  if (receiptError) {
    errors.push(receiptError);
  }

  if (payload.vendorEmail !== undefined && payload.vendorEmail !== "" && !String(payload.vendorEmail).includes("@")) {
    errors.push("Vendor email must be valid.");
  }

  return errors;
}

function validateFinanceContactPayload(payload = {}) {
  const errors = [];

  if (!String(payload.name || "").trim()) {
    errors.push("Name is required.");
  }

  if (payload.email !== undefined && payload.email !== "" && !String(payload.email).includes("@")) {
    errors.push("Email must be valid.");
  }

  if (payload.status !== undefined) {
    const allowedStatuses = ["active", "inactive"];
    if (!allowedStatuses.includes(String(payload.status))) {
      errors.push("Contact status is invalid.");
    }
  }

  return errors;
}

function buildFinanceContactUpdates(payload = {}) {
  const name = String(payload.name || "").trim();
  const updates = {
    name,
    normalizedName: name.toLowerCase(),
    email: String(payload.email || "").trim().toLowerCase(),
    phone: String(payload.phone || "").trim(),
    contactName: String(payload.contactName || "").trim(),
    notes: String(payload.notes || "").trim(),
    status: payload.status === "inactive" ? "inactive" : "active",
    lastUsedAt: new Date()
  };

  return updates;
}

async function createFinanceAction({ workspaceId, itemType, itemId, action, performedBy, metadata = {}, sourceMessageId = null }) {
  return FinanceActionLog.create({
    workspaceId,
    itemType,
    itemId,
    action,
    performedBy,
    threadKey: "financebot",
    metadata,
    sourceMessageId
  });
}

function serializeFinancePeriodLock(lock) {
  return {
    id: lock._id.toString(),
    workspaceId: lock.workspaceId?.toString?.() || null,
    periodKey: lock.periodKey,
    periodLabel: formatPeriodKeyLabel(lock.periodKey),
    periodStart: lock.periodStart,
    periodEnd: lock.periodEnd,
    note: lock.note || "",
    lockedBy: serializeActor(lock.lockedBy),
    createdAt: lock.createdAt,
    updatedAt: lock.updatedAt
  };
}

router.get("/workspaces", async (req, res) => {
  try {
    const memberships = await listWorkspaceMembershipsForUser(req.user._id, {
      module: "finance"
    });

    return res.json({
      workspaces: memberships.map((membership) => ({
        workspace: serializeWorkspace(membership.workspaceId),
        membership: serializeWorkspaceMembership(membership)
      }))
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load finance workspaces." });
  }
});

router.use(workspaceContextMiddleware({ allowDefault: false, membershipModule: "finance" }));
router.use(workspaceMembershipMiddleware({ allowLegacyFallback: true }));
router.use(requireFinanceViewer);

function buildScopedWorkspaceFilter(req, baseFilter = {}) {
  return buildWorkspaceFilter(req.workspace, baseFilter, {
    includeLegacy: Boolean(req.workspaceMembership?.isLegacyFallback)
  });
}

async function loadFinanceRateContext(req, options = {}) {
  const requestedBaseCurrency = normalizeCurrencyCode(
    options.baseCurrency || req.query.baseCurrency || req.workspace?.defaultCurrency || "USD"
  );
  const rateContext = await getCachedRates("USD", {
    forceRefresh: options.forceRefresh === true
  });

  return {
    requestedBaseCurrency,
    rates: rateContext?.rates || STATIC_EXCHANGE_RATES,
    rateSource: rateContext?.source || (isUsingLiveRates() ? "live" : "static"),
    rateTimestamp: rateContext?.timestamp || getLiveRateTimestamp() || null
  };
}

router.get("/fx-rates", async (req, res) => {
  try {
    const rateContext = await loadFinanceRateContext(req, {
      forceRefresh: req.query.refresh === "true"
    });

    return res.json({
      baseCurrency: "USD",
      requestedBaseCurrency: rateContext.requestedBaseCurrency,
      source: rateContext.rateSource,
      live: rateContext.rateSource === "live",
      timestamp: rateContext.rateTimestamp,
      rates: rateContext.rates
    });
  } catch (_error) {
    return res.status(500).json({ message: "Unable to load FX rates." });
  }
});

async function createBlockedFinanceControlAction(req, details = {}) {
  await createFinanceAction({
    workspaceId: req.workspaceId,
    itemType: "control",
    itemId: req.workspaceId,
    action: "blocked",
    performedBy: req.user._id,
    metadata: details
  });

  await writeAuditLog({
    actor: req.user._id,
    action: "finance.control.blocked",
    targetId: req.workspaceId?.toString?.() || null,
    targetType: "Workspace",
    metadata: {
      workspaceId: req.workspaceId?.toString?.() || null,
      ...details
    }
  });
}

function normalizeAccountingPeriod(value = "all") {
  return ["all", "30d", "90d"].includes(String(value || "").trim()) ? String(value).trim() : "all";
}

function startOfMonth(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfMonth(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

function periodKeyFromDate(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function normalizePeriodKey(value = "") {
  const normalized = String(value || "").trim();
  return /^\d{4}-\d{2}$/.test(normalized) ? normalized : "";
}

function periodRangeFromKey(periodKey) {
  const normalized = normalizePeriodKey(periodKey);
  if (!normalized) {
    return null;
  }

  const [yearString, monthString] = normalized.split("-");
  const year = Number(yearString);
  const monthIndex = Number(monthString) - 1;
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return null;
  }
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999));

  return {
    periodKey: normalized,
    start,
    end
  };
}

function formatPeriodKeyLabel(periodKey = "") {
  const range = periodRangeFromKey(periodKey);
  if (!range) {
    return periodKey || "Unknown period";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(range.start);
}

function buildRecentPeriodKeys(count = 6) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() - index);
    return periodKeyFromDate(date);
  });
}

function isDateWithinPeriod(dateValue, periodKey = "") {
  const range = periodRangeFromKey(periodKey);
  if (!range || !dateValue) {
    return false;
  }

  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  return date.getTime() >= range.start.getTime() && date.getTime() <= range.end.getTime();
}

function invoiceCloseReviewDate(invoice) {
  return invoice?.dueDate || invoice?.paidAt || invoice?.updatedAt || invoice?.createdAt || null;
}

function expenseCloseReviewDate(expense) {
  return expense?.expenseDate || expense?.updatedAt || expense?.createdAt || null;
}

function invoiceNeedsRevenuePosting(invoice) {
  return ["approved", "partial", "paid", "reconciled", "overdue"].includes(invoice?.status) &&
    invoice?.accounting?.revenueEntryStatus !== "posted";
}

function invoiceNeedsPaymentPosting(invoice) {
  const paymentCount = Array.isArray(invoice?.payments) ? invoice.payments.length : 0;
  const paymentPostedCount = Number(invoice?.accounting?.paymentPostedCount || 0);
  return paymentCount > paymentPostedCount;
}

function expenseNeedsAccrualPosting(expense) {
  return ["approved", "reimbursed", "reconciled"].includes(expense?.status) &&
    expense?.accounting?.expenseEntryStatus !== "posted";
}

function expenseNeedsSettlementPosting(expense) {
  return ["reimbursed", "reconciled"].includes(expense?.status) &&
    expense?.accounting?.settlementEntryStatus !== "posted";
}

function buildFinancePeriodCloseReadiness({
  periodKey,
  invoices = [],
  expenses = [],
  periodLocks = []
}) {
  const periodLabel = formatPeriodKeyLabel(periodKey);
  const isLocked = periodLocks.some((lock) => lock.periodKey === periodKey);
  const periodInvoices = invoices.filter((invoice) => isDateWithinPeriod(invoiceCloseReviewDate(invoice), periodKey));
  const periodExpenses = expenses.filter((expense) => isDateWithinPeriod(expenseCloseReviewDate(expense), periodKey));
  const unpaidInvoices = periodInvoices.filter((invoice) => ["pending_review", "new", "approved", "partial", "overdue"].includes(invoice.status));
  const unreconciledInvoices = periodInvoices.filter((invoice) => ["approved", "partial", "paid", "overdue"].includes(invoice.status));
  const unreconciledExpenses = periodExpenses.filter((expense) => ["submitted", "pending_review", "approved", "reimbursed"].includes(expense.status));
  const pendingAccountingInvoices = periodInvoices.filter((invoice) => invoiceNeedsRevenuePosting(invoice) || invoiceNeedsPaymentPosting(invoice));
  const pendingAccountingExpenses = periodExpenses.filter((expense) => expenseNeedsAccrualPosting(expense) || expenseNeedsSettlementPosting(expense));
  const blockedInvoices = periodInvoices.filter((invoice) => invoice?.accounting?.controlStatus === "blocked");
  const blockedExpenses = periodExpenses.filter((expense) => expense?.accounting?.controlStatus === "blocked");
  const pendingReviewInvoices = periodInvoices.filter((invoice) => ["pending_review", "new"].includes(invoice.status));
  const pendingReviewExpenses = periodExpenses.filter((expense) => ["draft", "submitted", "pending_review"].includes(expense.status));
  const openItemsCount = new Set([
    ...unpaidInvoices.map((invoice) => `invoice:${invoice._id.toString()}`),
    ...unreconciledInvoices.map((invoice) => `invoice:${invoice._id.toString()}`),
    ...unreconciledExpenses.map((expense) => `expense:${expense._id.toString()}`),
    ...pendingAccountingInvoices.map((invoice) => `invoice:${invoice._id.toString()}`),
    ...pendingAccountingExpenses.map((expense) => `expense:${expense._id.toString()}`),
    ...blockedInvoices.map((invoice) => `invoice:${invoice._id.toString()}`),
    ...blockedExpenses.map((expense) => `expense:${expense._id.toString()}`),
    ...pendingReviewInvoices.map((invoice) => `invoice:${invoice._id.toString()}`),
    ...pendingReviewExpenses.map((expense) => `expense:${expense._id.toString()}`)
  ]).size;
  const readinessStatus =
    blockedInvoices.length || blockedExpenses.length
      ? "blocked"
      : openItemsCount > 0
        ? "attention"
        : "ready";

  const blockers = [
    ...blockedInvoices.slice(0, 2).map((invoice) => ({
      id: `invoice-blocked-${invoice._id.toString()}`,
      type: "invoice",
      tone: "danger",
      label: invoice.invoiceNumber,
      detail: `${formatMoney(Math.max(0, Number(invoice.amount || 0) - Number(invoice.paidAmount || 0)), invoice.currency)} still affected by a locked period`
    })),
    ...blockedExpenses.slice(0, 2).map((expense) => ({
      id: `expense-blocked-${expense._id.toString()}`,
      type: "expense",
      tone: "danger",
      label: expense.vendorName || expense.category || "Expense record",
      detail: `${formatMoney(expense.amount || 0, expense.currency)} is blocked by period controls`
    })),
    ...unpaidInvoices.slice(0, 2).map((invoice) => ({
      id: `invoice-open-${invoice._id.toString()}`,
      type: "invoice",
      tone: "warning",
      label: invoice.invoiceNumber,
      detail: `${formatMoney(Math.max(0, Number(invoice.amount || 0) - Number(invoice.paidAmount || 0)), invoice.currency)} still open`
    })),
    ...unreconciledExpenses.slice(0, 2).map((expense) => ({
      id: `expense-open-${expense._id.toString()}`,
      type: "expense",
      tone: "warning",
      label: expense.vendorName || expense.category || "Expense record",
      detail: `${formatMoney(expense.amount || 0, expense.currency)} still needs reconciliation`
    }))
  ].slice(0, 5);

  let guidance = `${periodLabel} still has ${openItemsCount} finance item${openItemsCount === 1 ? "" : "s"} to review before lock.`;
  if (readinessStatus === "ready") {
    guidance = `${periodLabel} looks ready to lock based on current invoices, expenses, and accounting state.`;
  } else if (readinessStatus === "blocked") {
    guidance = `${periodLabel} has blocked finance records that need review before the period close looks clean.`;
  }

  return {
    periodKey,
    periodLabel,
    isLocked,
    readinessStatus,
    openItemsCount,
    metrics: {
      unpaidInvoices: unpaidInvoices.length,
      unreconciledInvoices: unreconciledInvoices.length,
      unreconciledExpenses: unreconciledExpenses.length,
      pendingReviewItems: pendingReviewInvoices.length + pendingReviewExpenses.length,
      pendingAccountingItems: pendingAccountingInvoices.length + pendingAccountingExpenses.length,
      blockedItems: blockedInvoices.length + blockedExpenses.length
    },
    blockers,
    guidance
  };
}

class FinancePeriodLockError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "FinancePeriodLockError";
    this.code = "FINANCE_PERIOD_LOCKED";
    this.details = details;
  }
}

async function findMatchingPeriodLock(workspaceId, dates = []) {
  const validDates = dates
    .map((value) => (value ? new Date(value) : null))
    .filter((date) => date && !Number.isNaN(date.getTime()));

  if (!workspaceId || !validDates.length) {
    return null;
  }

  const periodKeys = [...new Set(validDates.map((date) => periodKeyFromDate(date)))];
  return FinancePeriodLock.findOne({ workspaceId, periodKey: { $in: periodKeys } }).populate("lockedBy", "name email");
}

async function assertPeriodsUnlocked(req, {
  dates = [],
  action,
  itemType,
  itemId = null,
  details = {}
}) {
  const periodLock = await findMatchingPeriodLock(req.workspaceId, dates);
  if (!periodLock) {
    return null;
  }

  const payload = {
    itemType,
    itemId: itemId?.toString?.() || null,
    attemptedAction: action,
    lockedPeriodKey: periodLock.periodKey,
    lockedPeriodLabel: formatPeriodKeyLabel(periodLock.periodKey),
    ...details
  };

  await createBlockedFinanceControlAction(req, payload);

  if (itemId && itemType === "invoice") {
    await markInvoiceControlState(itemId, "blocked", {
      blockedReason: "Locked accounting period",
      blockedAt: new Date(),
      blockedPeriodKey: periodLock.periodKey
    });
  }

  if (itemId && itemType === "expense") {
    await markExpenseControlState(itemId, "blocked", {
      blockedReason: "Locked accounting period",
      blockedAt: new Date(),
      blockedPeriodKey: periodLock.periodKey
    });
  }

  throw new FinancePeriodLockError(
    `The ${formatPeriodKeyLabel(periodLock.periodKey)} period is locked for finance posting changes.`,
    {
      ...payload,
      periodLock: serializeFinancePeriodLock(periodLock)
    }
  );
}

async function markInvoiceControlState(invoiceId, controlStatus = "clear", details = {}) {
  await InvoiceRecord.updateOne(
    { _id: invoiceId },
    {
      $set: {
        "accounting.controlStatus": controlStatus,
        "accounting.blockedReason": details.blockedReason || "",
        "accounting.blockedAt": details.blockedAt || null,
        "accounting.blockedPeriodKey": details.blockedPeriodKey || "",
        "accounting.lastSyncedAt": new Date()
      }
    }
  );
}

async function markExpenseControlState(expenseId, controlStatus = "clear", details = {}) {
  await ExpenseRecord.updateOne(
    { _id: expenseId },
    {
      $set: {
        "accounting.controlStatus": controlStatus,
        "accounting.blockedReason": details.blockedReason || "",
        "accounting.blockedAt": details.blockedAt || null,
        "accounting.blockedPeriodKey": details.blockedPeriodKey || "",
        "accounting.lastSyncedAt": new Date()
      }
    }
  );
}

function isInvoiceMaterialUpdate(updates = {}) {
  const nonMaterialFields = new Set(["note", "attachments", "recurring"]);
  return Object.keys(updates).some((field) => !nonMaterialFields.has(field));
}

function isExpenseMaterialUpdate(updates = {}) {
  const nonMaterialFields = new Set(["note", "receipt"]);
  return Object.keys(updates).some((field) => !nonMaterialFields.has(field));
}

function buildFinanceAuditPayload(req, metadata = {}) {
  return {
    workspaceId: req.workspaceId?.toString?.() || null,
    workspaceRole: req.workspaceMembership?.workspaceRole || null,
    ...metadata
  };
}

async function syncInvoiceAccountingIfEnabled(req, invoice, actorId) {
  if (!isAccountingEnabledForWorkspace(req.workspace)) {
    return false;
  }

  await syncInvoiceAccounting(invoice, actorId);
  await markInvoiceControlState(invoice._id, "clear");
  return true;
}

async function syncExpenseAccountingIfEnabled(req, expense, actorId) {
  if (!isAccountingEnabledForWorkspace(req.workspace)) {
    return false;
  }

  await syncExpenseAccounting(expense, actorId);
  await markExpenseControlState(expense._id, "clear");
  return true;
}

function isAccountingReadEnabled(req) {
  return isAccountingEnabledForWorkspace(req.workspace);
}

function requireAccountingEnabled(req, res, next) {
  if (isAccountingReadEnabled(req)) {
    return next();
  }

  return res.status(403).json({
    status: 403,
    message: "Accounting is not enabled for this workspace."
  });
}

function accountingPeriodStart(period = "all") {
  const now = Date.now();
  if (period === "30d") {
    return new Date(now - 30 * 24 * 60 * 60 * 1000);
  }

  if (period === "90d") {
    return new Date(now - 90 * 24 * 60 * 60 * 1000);
  }

  return null;
}

function accountingPeriodWindow(period = "all") {
  const start = accountingPeriodStart(period);
  if (!start) {
    return null;
  }

  return {
    start,
    end: new Date()
  };
}

function previousAccountingPeriodWindow(period = "all") {
  const currentWindow = accountingPeriodWindow(period);
  if (!currentWindow) {
    return null;
  }

  const spanMs = currentWindow.end.getTime() - currentWindow.start.getTime();
  const previousEnd = new Date(currentWindow.start.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - spanMs);

  return {
    start: previousStart,
    end: previousEnd
  };
}

function buildAccountingJournalFilter(req, baseFilter = {}, period = "all") {
  const filter = buildScopedWorkspaceFilter(req, baseFilter);
  const window = accountingPeriodWindow(period);
  if (window) {
    filter.postingDate = {
      ...(filter.postingDate || {}),
      $gte: window.start,
      $lte: window.end
    };
  }
  return filter;
}

function buildPreviousAccountingJournalFilter(req, baseFilter = {}, period = "all") {
  const filter = buildScopedWorkspaceFilter(req, baseFilter);
  const window = previousAccountingPeriodWindow(period);
  if (window) {
    filter.postingDate = {
      ...(filter.postingDate || {}),
      $gte: window.start,
      $lte: window.end
    };
  }
  return filter;
}

function emptyAccountingCurrencyBucket() {
  return {
    revenuePostedCents: 0,
    expensesPostedCents: 0,
    accountsReceivableBalanceCents: 0,
    accountsPayableBalanceCents: 0,
    cashPositionCents: 0
  };
}

function toAccountingCurrencyBucket(bucket = {}) {
  return {
    revenuePosted: fromCents(bucket.revenuePostedCents),
    expensesPosted: fromCents(bucket.expensesPostedCents),
    accountsReceivableBalance: fromCents(bucket.accountsReceivableBalanceCents),
    accountsPayableBalance: fromCents(bucket.accountsPayableBalanceCents),
    cashPosition: fromCents(bucket.cashPositionCents)
  };
}

function buildAccountingRollup(entries = []) {
  return entries.reduce((accumulator, entry) => {
    for (const line of entry.lines || []) {
      const currency = normalizeCurrencyCode(line?.currency || entry?.currency || entry?.metadata?.currency || "USD");
      const bucket = accumulator[currency] || emptyAccountingCurrencyBucket();
      const debitCents = toCents(line.debit || 0);
      const creditCents = toCents(line.credit || 0);

      if (line.accountType === "income") {
        bucket.revenuePostedCents += creditCents - debitCents;
      }

      if (line.accountType === "expense") {
        bucket.expensesPostedCents += debitCents - creditCents;
      }

      if (line.accountCode === "1100") {
        bucket.accountsReceivableBalanceCents += debitCents - creditCents;
      }

      if (line.accountCode === "2000") {
        bucket.accountsPayableBalanceCents += creditCents - debitCents;
      }

      if (line.accountCode === "1000") {
        bucket.cashPositionCents += debitCents - creditCents;
      }

      accumulator[currency] = bucket;
    }

    return accumulator;
  }, {});
}

function roundAccountingRollup(accountingRollup = {}) {
  return Object.fromEntries(
    Object.entries(accountingRollup).map(([currency, bucket]) => [
      currency,
      toAccountingCurrencyBucket(bucket)
    ])
  );
}

function buildAccountBalances(entries = []) {
  const accountBalanceMap = entries.reduce((accumulator, entry) => {
    for (const line of entry.lines || []) {
      const existing = accumulator.get(line.accountCode) || {
        code: line.accountCode,
        name: line.accountName,
        type: line.accountType,
        balance: 0
      };

      const debit = Number(line.debit || 0);
      const credit = Number(line.credit || 0);
      const signedBalance = ["asset", "expense"].includes(line.accountType)
        ? debit - credit
        : credit - debit;

      existing.balance += signedBalance;
      accumulator.set(line.accountCode, existing);
    }

    return accumulator;
  }, new Map());

  return [...accountBalanceMap.values()]
    .map((account) => ({
      ...account,
      balance: Number(account.balance.toFixed(2))
    }))
    .sort((left, right) => left.code.localeCompare(right.code));
}

function buildComparisonMetric(current = 0, previous = 0) {
  const delta = Number((Number(current || 0) - Number(previous || 0)).toFixed(2));
  return {
    current: Number(Number(current || 0).toFixed(2)),
    previous: Number(Number(previous || 0).toFixed(2)),
    delta,
    direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat"
  };
}

function getAccountingPeriodLabel(accountingPeriod = "all") {
  if (accountingPeriod === "30d") {
    return "Last 30 days";
  }

  if (accountingPeriod === "90d") {
    return "Last 90 days";
  }

  return "All time";
}

function normalizeAccountingReportVariant(value) {
  const normalized = String(value || "pack").trim().toLowerCase();
  if (["pack", "profit_and_loss", "balance_snapshot"].includes(normalized)) {
    return normalized;
  }

  return "pack";
}

function getAccountingReportVariantLabel(variant = "pack") {
  if (variant === "profit_and_loss") {
    return "Profit and loss";
  }

  if (variant === "balance_snapshot") {
    return "Balance snapshot";
  }

  return "Statement pack";
}

function buildAccountingSummaryPayload({
  accountingPeriod = "all",
  journalEntries = [],
  previousJournalEntries = [],
  chartCount = 0
}) {
  const postedJournalEntries = journalEntries.filter((entry) => entry.status === "posted");
  const previousPostedJournalEntries = previousJournalEntries.filter((entry) => entry.status === "posted");
  const roundedAccountingRollupByCurrency = roundAccountingRollup(buildAccountingRollup(postedJournalEntries));
  const previousAccountingRollupByCurrency = roundAccountingRollup(buildAccountingRollup(previousPostedJournalEntries));
  const primaryCurrency = Object.keys(roundedAccountingRollupByCurrency)[0] || "USD";
  const roundedAccountingRollup = roundedAccountingRollupByCurrency[primaryCurrency] || {
    revenuePosted: 0,
    expensesPosted: 0,
    accountsReceivableBalance: 0,
    accountsPayableBalance: 0,
    cashPosition: 0
  };
  const previousAccountingRollup = previousAccountingRollupByCurrency[primaryCurrency] || {
    revenuePosted: 0,
    expensesPosted: 0,
    accountsReceivableBalance: 0,
    accountsPayableBalance: 0,
    cashPosition: 0
  };
  const accountBalances = buildAccountBalances(postedJournalEntries);
  const cashDirection =
    roundedAccountingRollup.cashPosition > 0
      ? "inflow"
      : roundedAccountingRollup.cashPosition < 0
        ? "outflow"
        : "flat";
  const netOperatingResult = Number((roundedAccountingRollup.revenuePosted - roundedAccountingRollup.expensesPosted).toFixed(2));
  const totalAssets = Number((roundedAccountingRollup.cashPosition + roundedAccountingRollup.accountsReceivableBalance).toFixed(2));
  const totalLiabilities = Number(roundedAccountingRollup.accountsPayableBalance.toFixed(2));
  const equityPlaceholder = Number((totalAssets - totalLiabilities).toFixed(2));
  const profitDirection =
    netOperatingResult > 0
      ? "profit"
      : netOperatingResult < 0
        ? "loss"
        : "breakeven";
  const comparisonPeriodLabel =
    accountingPeriod === "30d"
      ? "Previous 30 days"
      : accountingPeriod === "90d"
        ? "Previous 90 days"
        : null;

  return {
    accountingSnapshot: {
      period: accountingPeriod,
      periodLabel: getAccountingPeriodLabel(accountingPeriod),
      chartOfAccountsCount: chartCount,
      postedEntries: journalEntries.filter((entry) => entry.status === "posted").length,
      voidedEntries: journalEntries.filter((entry) => entry.status === "voided").length,
      invoiceAccrualEntries: journalEntries.filter((entry) => entry.entryType === "invoice_accrual" && entry.status === "posted").length,
      invoicePaymentEntries: journalEntries.filter((entry) => entry.entryType === "invoice_payment" && entry.status === "posted").length,
      expenseAccrualEntries: journalEntries.filter((entry) => entry.entryType === "expense_accrual" && entry.status === "posted").length,
      expensePaymentEntries: journalEntries.filter((entry) => entry.entryType === "expense_payment" && entry.status === "posted").length,
      primaryCurrency,
      rollupByCurrency: roundedAccountingRollupByCurrency,
      revenuePosted: roundedAccountingRollup.revenuePosted,
      expensesPosted: roundedAccountingRollup.expensesPosted,
      accountsReceivableBalance: roundedAccountingRollup.accountsReceivableBalance,
      accountsPayableBalance: roundedAccountingRollup.accountsPayableBalance,
      cashPosition: roundedAccountingRollup.cashPosition,
      cashDirection
    },
    accountingStatements: {
      period: accountingPeriod,
      periodLabel: getAccountingPeriodLabel(accountingPeriod),
      primaryCurrency,
      profitAndLoss: {
        revenue: roundedAccountingRollup.revenuePosted,
        expenses: roundedAccountingRollup.expensesPosted,
        netOperatingResult,
        profitDirection,
        byCurrency: Object.fromEntries(
          Object.entries(roundedAccountingRollupByCurrency).map(([currency, bucket]) => [
            currency,
            {
              revenue: bucket.revenuePosted,
              expenses: bucket.expensesPosted,
              netOperatingResult: fromCents(toCents(bucket.revenuePosted) - toCents(bucket.expensesPosted))
            }
          ])
        )
      },
      balanceSnapshot: {
        cash: roundedAccountingRollup.cashPosition,
        accountsReceivable: roundedAccountingRollup.accountsReceivableBalance,
        accountsPayable: roundedAccountingRollup.accountsPayableBalance,
        equityPlaceholder,
        totalAssets,
        totalLiabilities,
        totalEquity: equityPlaceholder,
        byCurrency: Object.fromEntries(
          Object.entries(roundedAccountingRollupByCurrency).map(([currency, bucket]) => {
            const bucketAssetsCents = toCents(bucket.cashPosition) + toCents(bucket.accountsReceivableBalance);
            const bucketLiabilitiesCents = toCents(bucket.accountsPayableBalance);
            const bucketEquityCents = bucketAssetsCents - bucketLiabilitiesCents;
            return [
              currency,
              {
                cash: bucket.cashPosition,
                accountsReceivable: bucket.accountsReceivableBalance,
                accountsPayable: bucket.accountsPayableBalance,
                totalAssets: fromCents(bucketAssetsCents),
                totalLiabilities: fromCents(bucketLiabilitiesCents),
                equity: fromCents(bucketEquityCents)
              }
            ];
          })
        )
      },
      accountBalances,
      comparison:
        accountingPeriod === "all"
          ? null
          : {
              previousPeriodLabel: comparisonPeriodLabel,
              revenue: buildComparisonMetric(roundedAccountingRollup.revenuePosted, previousAccountingRollup.revenuePosted),
              expenses: buildComparisonMetric(roundedAccountingRollup.expensesPosted, previousAccountingRollup.expensesPosted),
              netOperatingResult: buildComparisonMetric(
                netOperatingResult,
                Number((previousAccountingRollup.revenuePosted - previousAccountingRollup.expensesPosted).toFixed(2))
              ),
              cash: buildComparisonMetric(roundedAccountingRollup.cashPosition, previousAccountingRollup.cashPosition),
              accountsReceivable: buildComparisonMetric(
                roundedAccountingRollup.accountsReceivableBalance,
                previousAccountingRollup.accountsReceivableBalance
              ),
              accountsPayable: buildComparisonMetric(
                roundedAccountingRollup.accountsPayableBalance,
                previousAccountingRollup.accountsPayableBalance
              ),
              byCurrency: Object.fromEntries(
                [...new Set([
                  ...Object.keys(roundedAccountingRollupByCurrency),
                  ...Object.keys(previousAccountingRollupByCurrency)
                ])].map((currency) => {
                  const currentBucket = roundedAccountingRollupByCurrency[currency] || {
                    revenuePosted: 0,
                    expensesPosted: 0,
                    accountsReceivableBalance: 0,
                    accountsPayableBalance: 0,
                    cashPosition: 0
                  };
                  const previousBucket = previousAccountingRollupByCurrency[currency] || {
                    revenuePosted: 0,
                    expensesPosted: 0,
                    accountsReceivableBalance: 0,
                    accountsPayableBalance: 0,
                    cashPosition: 0
                  };

                  return [
                    currency,
                    {
                      revenue: buildComparisonMetric(currentBucket.revenuePosted, previousBucket.revenuePosted),
                      expenses: buildComparisonMetric(currentBucket.expensesPosted, previousBucket.expensesPosted),
                      netOperatingResult: buildComparisonMetric(
                        fromCents(toCents(currentBucket.revenuePosted) - toCents(currentBucket.expensesPosted)),
                        fromCents(toCents(previousBucket.revenuePosted) - toCents(previousBucket.expensesPosted))
                      ),
                      cash: buildComparisonMetric(currentBucket.cashPosition, previousBucket.cashPosition),
                      accountsReceivable: buildComparisonMetric(
                        currentBucket.accountsReceivableBalance,
                        previousBucket.accountsReceivableBalance
                      ),
                      accountsPayable: buildComparisonMetric(
                        currentBucket.accountsPayableBalance,
                        previousBucket.accountsPayableBalance
                      )
                    }
                  ];
                })
              )
            }
    }
  };
}

function buildAccountingWorkspaceExport(req) {
  return {
    id: req.workspaceId?.toString?.() || null,
    name: req.workspace?.name || "Workspace"
  };
}

function buildStatementExportRows(accountingSummaryPayload = {}) {
  const snapshot = accountingSummaryPayload.accountingSnapshot || {};
  const statements = accountingSummaryPayload.accountingStatements || {};
  const comparison = statements.comparison || null;
  const rows = [];

  const pushRow = (section, label, value, options = {}) => {
    const metric = comparison?.[options.comparisonKey] || null;
    rows.push({
      section,
      label,
      value: Number(Number(value || 0).toFixed(2)),
      previousValue: metric ? Number(Number(metric.previous || 0).toFixed(2)) : null,
      delta: metric ? Number(Number(metric.delta || 0).toFixed(2)) : null,
      direction: metric?.direction || null,
      accountCode: options.accountCode || "",
      accountType: options.accountType || "",
      period: snapshot.period || statements.period || "all",
      periodLabel: snapshot.periodLabel || statements.periodLabel || getAccountingPeriodLabel(snapshot.period || statements.period || "all")
    });
  };

  pushRow("snapshot", "Revenue posted", snapshot.revenuePosted || 0, { comparisonKey: "revenue" });
  pushRow("snapshot", "Expenses posted", snapshot.expensesPosted || 0, { comparisonKey: "expenses" });
  pushRow("snapshot", "Accounts receivable", snapshot.accountsReceivableBalance || 0, { comparisonKey: "accountsReceivable" });
  pushRow("snapshot", "Accounts payable", snapshot.accountsPayableBalance || 0, { comparisonKey: "accountsPayable" });
  pushRow("snapshot", "Cash position", snapshot.cashPosition || 0, { comparisonKey: "cash" });

  pushRow("profit_and_loss", "Revenue", statements.profitAndLoss?.revenue || 0, { comparisonKey: "revenue" });
  pushRow("profit_and_loss", "Expenses", statements.profitAndLoss?.expenses || 0, { comparisonKey: "expenses" });
  pushRow("profit_and_loss", "Net operating result", statements.profitAndLoss?.netOperatingResult || 0, { comparisonKey: "netOperatingResult" });

  pushRow("balance_snapshot", "Cash", statements.balanceSnapshot?.cash || 0, { comparisonKey: "cash" });
  pushRow("balance_snapshot", "Accounts receivable", statements.balanceSnapshot?.accountsReceivable || 0, {
    comparisonKey: "accountsReceivable"
  });
  pushRow("balance_snapshot", "Accounts payable", statements.balanceSnapshot?.accountsPayable || 0, {
    comparisonKey: "accountsPayable"
  });
  pushRow("balance_snapshot", "Equity", statements.balanceSnapshot?.equityPlaceholder || 0);
  pushRow("balance_snapshot", "Total assets", statements.balanceSnapshot?.totalAssets || 0);
  pushRow("balance_snapshot", "Total liabilities", statements.balanceSnapshot?.totalLiabilities || 0);

  for (const account of Array.isArray(statements.accountBalances) ? statements.accountBalances : []) {
    pushRow("account_balance", `${account.code} ${account.name}`, account.balance || 0, {
      accountCode: account.code || "",
      accountType: account.type || ""
    });
  }

  return rows;
}

function filterStatementRowsByVariant(rows = [], variant = "pack") {
  if (variant === "profit_and_loss") {
    return rows.filter((row) => ["snapshot", "profit_and_loss"].includes(row.section));
  }

  if (variant === "balance_snapshot") {
    return rows.filter((row) => ["snapshot", "balance_snapshot", "account_balance"].includes(row.section));
  }

  return rows;
}

function buildStatementReportSections(rows = [], variant = "pack") {
  const labels = {
    snapshot: "Posted accounting snapshot",
    profit_and_loss: "Profit and loss",
    balance_snapshot: "Balance snapshot",
    account_balance: "Account balances"
  };

  const grouped = rows.reduce((accumulator, row) => {
    if (!accumulator[row.section]) {
      accumulator[row.section] = [];
    }

    accumulator[row.section].push(row);
    return accumulator;
  }, {});

  const sectionOrder =
    variant === "profit_and_loss"
      ? ["snapshot", "profit_and_loss"]
      : variant === "balance_snapshot"
        ? ["snapshot", "balance_snapshot", "account_balance"]
        : ["snapshot", "profit_and_loss", "balance_snapshot", "account_balance"];

  return sectionOrder
    .filter((sectionId) => Array.isArray(grouped[sectionId]) && grouped[sectionId].length)
    .map((sectionId) => ({
      id: sectionId,
      title: labels[sectionId] || sectionId,
      rows: grouped[sectionId]
    }));
}

function buildJournalExportRows(journals = [], period = "all") {
  const periodLabel = getAccountingPeriodLabel(period);
  return journals.flatMap((entry) =>
    (Array.isArray(entry.lines) ? entry.lines : []).map((line) => ({
      period,
      periodLabel,
      entryNumber: entry.entryNumber || "",
      postingDate: entry.postingDate || entry.createdAt || null,
      status: entry.status || "",
      entryType: entry.entryType || "",
      description: entry.description || "",
      accountCode: line.accountCode || "",
      accountName: line.accountName || "",
      accountType: line.accountType || "",
      debit: Number(Number(line.debit || 0).toFixed(2)),
      credit: Number(Number(line.credit || 0).toFixed(2)),
      totalDebit: Number(Number(entry.totalDebit || 0).toFixed(2)),
      totalCredit: Number(Number(entry.totalCredit || 0).toFixed(2)),
      createdBy: entry.createdBy?.name || entry.updatedBy?.name || "",
      sourceType: entry.metadata?.sourceType || "",
      sourceId: entry.metadata?.sourceId || ""
    }))
  );
}

router.get("/context", async (req, res) => {
  return res.json({
    workspace: serializeWorkspace(req.workspace),
    membership: serializeWorkspaceMembership(req.workspaceMembership)
  });
});

router.get("/customers", async (req, res) => {
  try {
    const statusFilter = req.query.status === "all" ? {} : { status: "active" };
    const customers = await FinanceCustomer.find(
      buildScopedWorkspaceFilter(req, statusFilter)
    ).sort({ lastUsedAt: -1, updatedAt: -1, createdAt: -1 });

    return res.json(customers.map(serializeFinanceCustomer));
  } catch (error) {
    return res.status(500).json({ message: "Unable to load finance customers." });
  }
});

router.get("/vendors", async (req, res) => {
  try {
    const statusFilter = req.query.status === "all" ? {} : { status: "active" };
    const vendors = await FinanceVendor.find(
      buildScopedWorkspaceFilter(req, statusFilter)
    ).sort({ lastUsedAt: -1, updatedAt: -1, createdAt: -1 });

    return res.json(vendors.map(serializeFinanceVendor));
  } catch (error) {
    return res.status(500).json({ message: "Unable to load finance vendors." });
  }
});

router.post("/customers", requireFinanceStaff, async (req, res) => {
  try {
    const errors = validateFinanceContactPayload(req.body);
    if (errors.length) {
      return res.status(400).json({ message: errors[0], errors });
    }

    const updates = buildFinanceContactUpdates(req.body);
    const customer = await FinanceCustomer.findOneAndUpdate(
      buildScopedWorkspaceFilter(req, { normalizedName: updates.normalizedName }),
      { $set: updates, $setOnInsert: { workspaceId: req.workspaceId } },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    );

    return res.status(201).json(serializeFinanceCustomer(customer));
  } catch (error) {
    return res.status(500).json({ message: "Unable to save finance customer." });
  }
});

router.patch("/customers/:id", requireFinanceStaff, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid customer id." });
    }

    const errors = validateFinanceContactPayload(req.body);
    if (errors.length) {
      return res.status(400).json({ message: errors[0], errors });
    }

    const updates = buildFinanceContactUpdates(req.body);
    const customer = await FinanceCustomer.findOneAndUpdate(
      buildScopedWorkspaceFilter(req, { _id: req.params.id }),
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!customer) {
      return res.status(404).json({ message: "Customer not found." });
    }

    return res.json(serializeFinanceCustomer(customer));
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: "A customer with that name already exists in this workspace." });
    }

    return res.status(500).json({ message: "Unable to update finance customer." });
  }
});

router.post("/vendors", requireFinanceStaff, async (req, res) => {
  try {
    const errors = validateFinanceContactPayload(req.body);
    if (errors.length) {
      return res.status(400).json({ message: errors[0], errors });
    }

    const updates = buildFinanceContactUpdates(req.body);
    const vendor = await FinanceVendor.findOneAndUpdate(
      buildScopedWorkspaceFilter(req, { normalizedName: updates.normalizedName }),
      { $set: updates, $setOnInsert: { workspaceId: req.workspaceId } },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    );

    return res.status(201).json(serializeFinanceVendor(vendor));
  } catch (error) {
    return res.status(500).json({ message: "Unable to save finance vendor." });
  }
});

router.patch("/vendors/:id", requireFinanceStaff, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid vendor id." });
    }

    const errors = validateFinanceContactPayload(req.body);
    if (errors.length) {
      return res.status(400).json({ message: errors[0], errors });
    }

    const updates = buildFinanceContactUpdates(req.body);
    const vendor = await FinanceVendor.findOneAndUpdate(
      buildScopedWorkspaceFilter(req, { _id: req.params.id }),
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!vendor) {
      return res.status(404).json({ message: "Vendor not found." });
    }

    return res.json(serializeFinanceVendor(vendor));
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: "A vendor with that name already exists in this workspace." });
    }

    return res.status(500).json({ message: "Unable to update finance vendor." });
  }
});

router.get("/summary", async (req, res) => {
  try {
    const accountingEnabled = isAccountingReadEnabled(req);
    const accountingPeriod = normalizeAccountingPeriod(req.query.accountingPeriod);
    const rateContext = await loadFinanceRateContext(req, {
      baseCurrency: req.query.baseCurrency || req.workspace?.defaultCurrency || "USD"
    });
    const requestedBaseCurrency = rateContext.requestedBaseCurrency;
    const workspaceFilter = buildScopedWorkspaceFilter(req);
    const [invoices, expenses, bankAccounts, accountingReads] = await Promise.all([
      InvoiceRecord.find(workspaceFilter)
        .select("amount paidAmount status dueDate recurring customerName vendorName payments recurringSourceInvoiceId invoiceNumber currency accounting paidAt createdAt updatedAt")
        .populate("payments.recordedBy", "name email"),
      ExpenseRecord.find(workspaceFilter).select("amount category status vendorName currency accounting expenseDate createdAt updatedAt"),
      BankAccount.find(buildScopedWorkspaceFilter(req, { status: { $ne: "disconnected" } }))
        .select("accountName currency currentBalance lastSyncedAt status")
        .sort({ updatedAt: -1, createdAt: -1 }),
      (async () => {
        if (!accountingEnabled) {
          return {
            journalEntries: [],
            previousJournalEntries: [],
            recentJournalEntries: [],
            chartCount: 0,
            periodLocks: [],
            recentControlActions: [],
            blockedActionsCount: 0
          };
        }

        await ensureWorkspaceChartOfAccounts(req.workspaceId);
        const [
          journalEntries,
          previousJournalEntries,
          recentJournalEntries,
          chartCount,
          periodLocks,
          recentControlActions,
          blockedActionsCount
        ] = await Promise.all([
          JournalEntry.find(buildAccountingJournalFilter(req, {}, accountingPeriod)).select(
            "status entryType totalDebit totalCredit lines accountCode postingDate description entryNumber createdAt metadata"
          ),
          accountingPeriod === "all"
            ? Promise.resolve([])
            : JournalEntry.find(buildPreviousAccountingJournalFilter(req, {}, accountingPeriod)).select(
                "status entryType totalDebit totalCredit lines accountCode postingDate description entryNumber createdAt metadata"
              ),
          JournalEntry.find(buildAccountingJournalFilter(req, {}, accountingPeriod))
            .sort({ postingDate: -1, createdAt: -1 })
            .limit(8)
            .populate("createdBy updatedBy", "name email"),
          ChartOfAccount.countDocuments(buildScopedWorkspaceFilter(req)),
          FinancePeriodLock.find(buildScopedWorkspaceFilter(req))
            .sort({ periodStart: -1 })
            .limit(6)
            .populate("lockedBy", "name email"),
          FinanceActionLog.find(buildScopedWorkspaceFilter(req, { itemType: "control" }))
            .sort({ createdAt: -1 })
            .limit(8)
            .populate("performedBy", "name email"),
          FinanceActionLog.countDocuments(buildScopedWorkspaceFilter(req, { itemType: "control", action: "blocked" }))
        ]);

        return {
          journalEntries,
          previousJournalEntries,
          recentJournalEntries,
          chartCount,
          periodLocks,
          recentControlActions,
          blockedActionsCount
        };
      })()
    ]);
    const payrollStart = new Date();
    payrollStart.setUTCDate(1);
    payrollStart.setUTCHours(0, 0, 0, 0);
    const payrollSummaryRows = await PayrollRecord.find(
      buildScopedWorkspaceFilter(req, {
        $or: [
          {
            status: "paid",
            paidAt: { $gte: payrollStart }
          },
          {
            status: "approved"
          }
        ]
      })
    ).select("status netAmount currency paidAt");
    const {
      journalEntries,
      previousJournalEntries,
      recentJournalEntries,
      chartCount,
      periodLocks,
      recentControlActions,
      blockedActionsCount
    } = accountingReads;
    const cashPosition = {
      totals: bankAccounts.reduce((accumulator, account) => {
        addMoneyToCurrencyBucket(accumulator, account.currency || req.workspace?.defaultCurrency || "USD", Number(account.currentBalance || 0));
        return accumulator;
      }, {}),
      lastSyncedAt: bankAccounts
        .map((account) => account.lastSyncedAt)
        .filter(Boolean)
        .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] || null,
      accountsCount: bankAccounts.length
    };

    const [
      outstandingAmountByCurrencyRows,
      paidAmountByCurrencyRows,
      overdueAmountByCurrencyRows,
      expensesByCategoryRows,
      taxCollectedRows,
      taxPaidRows
    ] = await Promise.all([
      InvoiceRecord.aggregate([
        { $match: buildScopedWorkspaceFilter(req, { status: { $in: ["pending_review", "approved", "partial", "overdue"] } }) },
        {
          $project: {
            currency: { $toUpper: { $ifNull: ["$currency", "USD"] } },
            outstandingCents: {
              $max: [
                {
                  $subtract: [
                    { $toLong: { $round: [{ $multiply: [{ $ifNull: ["$amount", 0] }, 100] }, 0] } },
                    { $toLong: { $round: [{ $multiply: [{ $ifNull: ["$paidAmount", 0] }, 100] }, 0] } }
                  ]
                },
                0
              ]
            }
          }
        },
        { $group: { _id: "$currency", amountCents: { $sum: "$outstandingCents" } } }
      ]),
      InvoiceRecord.aggregate([
        { $match: buildScopedWorkspaceFilter(req, { status: "paid" }) },
        {
          $project: {
            currency: { $toUpper: { $ifNull: ["$currency", "USD"] } },
            paidBase: {
              $cond: [
                { $gt: [{ $ifNull: ["$paidAmount", 0] }, 0] },
                { $ifNull: ["$paidAmount", 0] },
                { $ifNull: ["$amount", 0] }
              ]
            }
          }
        },
        {
          $project: {
            currency: 1,
            paidCents: { $toLong: { $round: [{ $multiply: ["$paidBase", 100] }, 0] } }
          }
        },
        { $group: { _id: "$currency", amountCents: { $sum: "$paidCents" } } }
      ]),
      InvoiceRecord.aggregate([
        { $match: buildScopedWorkspaceFilter(req, { status: "overdue" }) },
        {
          $project: {
            currency: { $toUpper: { $ifNull: ["$currency", "USD"] } },
            overdueCents: {
              $max: [
                {
                  $subtract: [
                    { $toLong: { $round: [{ $multiply: [{ $ifNull: ["$amount", 0] }, 100] }, 0] } },
                    { $toLong: { $round: [{ $multiply: [{ $ifNull: ["$paidAmount", 0] }, 100] }, 0] } }
                  ]
                },
                0
              ]
            }
          }
        },
        { $group: { _id: "$currency", amountCents: { $sum: "$overdueCents" } } }
      ]),
      ExpenseRecord.aggregate([
        { $match: workspaceFilter },
        {
          $project: {
            category: { $ifNull: ["$category", "other"] },
            currency: { $toUpper: { $ifNull: ["$currency", "USD"] } },
            amountCents: { $toLong: { $round: [{ $multiply: [{ $ifNull: ["$amount", 0] }, 100] }, 0] } }
          }
        },
        {
          $group: {
            _id: { category: "$category", currency: "$currency" },
            amountCents: { $sum: "$amountCents" }
          }
        }
      ]),
      InvoiceRecord.aggregate([
        { $match: buildScopedWorkspaceFilter(req, { status: "paid" }) },
        {
          $project: {
            currency: { $toUpper: { $ifNull: ["$currency", "USD"] } },
            amountCents: { $toLong: { $round: [{ $multiply: [{ $ifNull: ["$taxAmount", 0] }, 100] }, 0] } }
          }
        },
        { $group: { _id: "$currency", amountCents: { $sum: "$amountCents" } } }
      ]),
      ExpenseRecord.aggregate([
        { $match: buildScopedWorkspaceFilter(req, { status: { $in: ["approved", "reimbursed", "reconciled"] } }) },
        {
          $project: {
            currency: { $toUpper: { $ifNull: ["$currency", "USD"] } },
            amountCents: { $toLong: { $round: [{ $multiply: [{ $ifNull: ["$taxAmount", 0] }, 100] }, 0] } }
          }
        },
        { $group: { _id: "$currency", amountCents: { $sum: "$amountCents" } } }
      ])
    ]);

    const outstandingAmountByCurrency = Object.fromEntries(
      outstandingAmountByCurrencyRows.map((row) => [row._id || "USD", fromCents(row.amountCents || 0)])
    );
    const paidAmountByCurrency = Object.fromEntries(
      paidAmountByCurrencyRows.map((row) => [row._id || "USD", fromCents(row.amountCents || 0)])
    );
    const overdueAmountByCurrency = Object.fromEntries(
      overdueAmountByCurrencyRows.map((row) => [row._id || "USD", fromCents(row.amountCents || 0)])
    );
    const expensesByCategory = expensesByCategoryRows.reduce((accumulator, row) => {
      const category = row?._id?.category || "other";
      const currency = row?._id?.currency || "USD";
      if (!accumulator[category]) {
        accumulator[category] = {};
      }
      accumulator[category][currency] = fromCents(row.amountCents || 0);
      return accumulator;
    }, {});
    const totalTaxCollectedByCurrency = Object.fromEntries(
      taxCollectedRows.map((row) => [row._id || "USD", fromCents(row.amountCents || 0)])
    );
    const totalTaxPaidByCurrency = Object.fromEntries(
      taxPaidRows.map((row) => [row._id || "USD", fromCents(row.amountCents || 0)])
    );

    const customerBalances = new Map();
    const vendorTotals = new Map();
    const recentPayments = [];
    const invoiceStatusBreakdown = {
      pending: 0,
      approved: 0,
      partial: 0,
      paid: 0,
      overdue: 0,
      reconciled: 0,
      rejected: 0
    };

    const summary = invoices.reduce(
      (accumulator, invoice) => {
        const amount = Number(invoice.amount || 0);
        const paidAmount = Number(invoice.paidAmount || 0);
        const outstandingAmount = Math.max(0, amount - paidAmount);
        const dueDate = invoice.dueDate ? new Date(invoice.dueDate) : null;
        const customerName = String(invoice.customerName || invoice.vendorName || "Unassigned customer").trim();
        const invoiceCurrency = normalizeCurrencyCode(invoice.currency || "USD");
        const normalizedStatus = STATUS_GROUPS.pending.includes(invoice.status) ? "pending" : invoice.status;

        addMoneyToCurrencyBucket(accumulator.totalInvoicedAmountByCurrency, invoiceCurrency, amount);

        if (Object.prototype.hasOwnProperty.call(invoiceStatusBreakdown, normalizedStatus)) {
          invoiceStatusBreakdown[normalizedStatus] += 1;
        }

        if (STATUS_GROUPS.outstanding.includes(invoice.status)) {
          accumulator.outstandingInvoices += 1;
        }

        if (STATUS_GROUPS.overdue.includes(invoice.status)) {
          accumulator.overdueInvoices += 1;
        }

        if (STATUS_GROUPS.reconcilable.includes(invoice.status)) {
          accumulator.reconcileQueue += 1;
        }

        if (STATUS_GROUPS.paid.includes(invoice.status)) {
          accumulator.paidInvoices += 1;
        }

        if (invoice.status === "partial") {
          accumulator.partialInvoices += 1;
        }

        if (invoice.recurring?.enabled) {
          accumulator.recurringInvoices += 1;
        }

        if (isRecurringInvoiceDue(invoice.recurring)) {
          accumulator.recurringDueInvoices += 1;
        }

        if (invoice.recurringSourceInvoiceId) {
          accumulator.recurringGeneratedInvoices += 1;
        }

        if (
          dueDate &&
          !Number.isNaN(dueDate.getTime()) &&
          dueDate.getTime() < Date.now() &&
          STATUS_GROUPS.dueAttention.includes(invoice.status)
        ) {
          accumulator.dueAttention += 1;
        }

        if (outstandingAmount > 0) {
          const currentCustomer = customerBalances.get(customerName) || {
            name: customerName,
            outstandingAmountByCurrency: {},
            invoiceCount: 0
          };
          addMoneyToCurrencyBucket(currentCustomer.outstandingAmountByCurrency, invoiceCurrency, outstandingAmount);
          currentCustomer.invoiceCount += 1;
          customerBalances.set(customerName, currentCustomer);
        }

        for (const payment of Array.isArray(invoice.payments) ? invoice.payments : []) {
          recentPayments.push({
            id: payment?._id?.toString?.() || `${invoice._id.toString()}-${payment?.recordedAt?.toString?.() || "payment"}`,
            invoiceId: invoice._id.toString(),
            invoiceNumber: invoice.invoiceNumber,
            customerName,
            amount: Number(payment?.amount || 0),
            currency: invoiceCurrency,
            recordedAt: payment?.recordedAt || null,
            remainingBalance: Number(payment?.remainingBalance || 0),
            method: payment?.method || "",
            reference: payment?.reference || "",
            note: payment?.note || "",
            recordedBy: serializeActor(payment?.recordedBy)
          });
        }

        return accumulator;
      },
      {
        outstandingInvoices: 0,
        overdueInvoices: 0,
        paidInvoices: 0,
        partialInvoices: 0,
        reconcileQueue: 0,
        recurringInvoices: 0,
        recurringDueInvoices: 0,
        recurringGeneratedInvoices: 0,
        dueAttention: 0,
        totalInvoicedAmountByCurrency: {}
      }
    );

    for (const expense of expenses) {
      const vendorName = String(expense.vendorName || "Unassigned vendor").trim();
      const expenseCurrency = normalizeCurrencyCode(expense.currency || "USD");
      const currentVendor = vendorTotals.get(vendorName) || {
        name: vendorName,
        totalAmountByCurrency: {},
        expenseCount: 0
      };
      addMoneyToCurrencyBucket(currentVendor.totalAmountByCurrency, expenseCurrency, Number(expense.amount || 0));
      currentVendor.expenseCount += 1;
      vendorTotals.set(vendorName, currentVendor);
    }
    const accountingSummaryPayload = accountingEnabled
      ? buildAccountingSummaryPayload({
          accountingPeriod,
          journalEntries,
          previousJournalEntries,
          chartCount
        })
      : null;
    const closeReviewPeriods = accountingEnabled
      ? buildRecentPeriodKeys(6).map((periodKey) =>
          buildFinancePeriodCloseReadiness({
            periodKey,
            invoices,
            expenses,
            periodLocks
          })
        )
      : [];

    const normalizedTotals = requestedBaseCurrency
      ? buildApproximateNormalizedFinanceTotals({
          totalInvoiced: summary.totalInvoicedAmountByCurrency,
          outstandingAmount: outstandingAmountByCurrency,
          paidAmount: paidAmountByCurrency,
          overdueAmount: overdueAmountByCurrency,
          totalTaxCollected: totalTaxCollectedByCurrency,
          totalTaxPaid: totalTaxPaidByCurrency
        }, requestedBaseCurrency, rateContext.rates)
      : null;
    const totalPayrollPaid = {};
    const totalPayrollPending = {};
    for (const payroll of payrollSummaryRows) {
      const currency = normalizeCurrencyCode(payroll.currency || req.workspace?.defaultCurrency || "USD");
      if (payroll.status === "paid") {
        addMoneyToCurrencyBucket(totalPayrollPaid, currency, Number(payroll.netAmount || 0));
      } else if (payroll.status === "approved") {
        addMoneyToCurrencyBucket(totalPayrollPending, currency, Number(payroll.netAmount || 0));
      }
    }

    return res.json({
      accountingEnabled,
      accountingEnabledAt: req.workspace?.accountingEnabledAt || null,
      workspaceDefaultCurrency: req.workspace?.defaultCurrency || "USD",
      fxRateSource: rateContext.rateSource,
      fxRateTimestamp: rateContext.rateTimestamp,
      totals: buildFinanceTotalsByCurrency({
        totalInvoiced: summary.totalInvoicedAmountByCurrency,
        outstandingAmount: outstandingAmountByCurrency,
        paidAmount: paidAmountByCurrency,
        overdueAmount: overdueAmountByCurrency
      }),
      normalizedTotals,
      cashPosition,
      pendingInvoices: invoices.filter((invoice) => STATUS_GROUPS.pending.includes(invoice.status)).length,
      overdueInvoices: summary.overdueInvoices,
      reconcileQueue: summary.reconcileQueue,
      expensesLogged: expenses.length,
      outstandingInvoices: summary.outstandingInvoices,
      outstandingAmount: outstandingAmountByCurrency,
      overdueAmount: overdueAmountByCurrency,
      totalTaxCollected: totalTaxCollectedByCurrency,
      totalTaxPaid: totalTaxPaidByCurrency,
      totalPayrollPaid,
      totalPayrollPending,
      paidInvoices: summary.paidInvoices,
      paidAmount: paidAmountByCurrency,
      partialInvoices: summary.partialInvoices,
      recurringInvoices: summary.recurringInvoices,
      recurringDueInvoices: summary.recurringDueInvoices,
      recurringGeneratedInvoices: summary.recurringGeneratedInvoices,
      dueAttention: summary.dueAttention,
      invoiceStatusBreakdown,
      expensesByCategory,
      accountingSnapshot: accountingSummaryPayload?.accountingSnapshot || null,
      accountingStatements: accountingSummaryPayload?.accountingStatements || null,
      accountingControls: accountingEnabled
        ? {
            currentPeriodKey: periodKeyFromDate(new Date()),
            currentPeriodLabel: formatPeriodKeyLabel(periodKeyFromDate(new Date())),
            lockedPeriods: periodLocks.map(serializeFinancePeriodLock),
            blockedActionsCount,
            recentActions: recentControlActions.map(serializeAction),
            closeReviewPeriods
          }
        : null,
      recentJournalEntries: accountingEnabled ? recentJournalEntries.map(serializeJournalEntry) : [],
      recentPayments: recentPayments
        .filter((payment) => payment.recordedAt)
        .sort((left, right) => new Date(right.recordedAt).getTime() - new Date(left.recordedAt).getTime())
        .slice(0, 8),
      topCustomersOwed: [...customerBalances.values()]
        .sort((left, right) => sumCurrencyBucketCents(right.outstandingAmountByCurrency) - sumCurrencyBucketCents(left.outstandingAmountByCurrency))
        .slice(0, 5),
      topVendors: [...vendorTotals.values()]
        .sort((left, right) => sumCurrencyBucketCents(right.totalAmountByCurrency) - sumCurrencyBucketCents(left.totalAmountByCurrency))
        .slice(0, 5)
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load finance summary." });
  }
});

router.get("/tax-summary", async (req, res) => {
  try {
    const rateContext = await loadFinanceRateContext(req, {
      baseCurrency: req.query.baseCurrency || req.workspace?.defaultCurrency || "USD"
    });
    const requestedBaseCurrency = rateContext.requestedBaseCurrency;
    const invoiceFilter = buildScopedWorkspaceFilter(req, {
      status: "paid",
      ...normalizeDateRangeFilter(req.query, "paidAt")
    });
    const expenseFilter = buildScopedWorkspaceFilter(req, {
      status: { $in: ["approved", "reimbursed", "reconciled"] },
      ...normalizeDateRangeFilter(req.query, "expenseDate")
    });

    const [collectedRows, paidRows] = await Promise.all([
      InvoiceRecord.aggregate([
        { $match: invoiceFilter },
        {
          $project: {
            currency: { $toUpper: { $ifNull: ["$currency", "USD"] } },
            amountCents: { $toLong: { $round: [{ $multiply: [{ $ifNull: ["$taxAmount", 0] }, 100] }, 0] } }
          }
        },
        { $group: { _id: "$currency", amountCents: { $sum: "$amountCents" } } }
      ]),
      ExpenseRecord.aggregate([
        { $match: expenseFilter },
        {
          $project: {
            currency: { $toUpper: { $ifNull: ["$currency", "USD"] } },
            amountCents: { $toLong: { $round: [{ $multiply: [{ $ifNull: ["$taxAmount", 0] }, 100] }, 0] } }
          }
        },
        { $group: { _id: "$currency", amountCents: { $sum: "$amountCents" } } }
      ])
    ]);

    const collected = Object.fromEntries(collectedRows.map((row) => [row._id || "USD", fromCents(row.amountCents || 0)]));
    const paid = Object.fromEntries(paidRows.map((row) => [row._id || "USD", fromCents(row.amountCents || 0)]));
    const net = subtractCurrencyBuckets(collected, paid);

    return res.json({
      collected,
      paid,
      net,
      normalizedApproximate: {
        ...buildNormalizationMetadata(requestedBaseCurrency, rateContext.rates),
        collected: sumCurrencyBucketInBaseCurrency(collected, requestedBaseCurrency, rateContext.rates),
        paid: sumCurrencyBucketInBaseCurrency(paid, requestedBaseCurrency, rateContext.rates),
        net: sumCurrencyBucketInBaseCurrency(net, requestedBaseCurrency, rateContext.rates)
      }
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load tax summary." });
  }
});

router.get("/accountant-summary", requireAccountantOrFinanceManager, async (req, res) => {
  try {
    const rateContext = await loadFinanceRateContext(req, {
      baseCurrency: req.query.baseCurrency || req.workspace?.defaultCurrency || "USD"
    });
    const requestedBaseCurrency = rateContext.requestedBaseCurrency;
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const [journals, periodLocks, paidInvoices, financeExpenses, receivableInvoices, warehouseProducts, bankAccounts, futureTransactions] = await Promise.all([
      JournalEntry.find(buildScopedWorkspaceFilter(req, { postingDate: { $gte: ninetyDaysAgo } }))
        .sort({ postingDate: -1, createdAt: -1 })
        .limit(120)
        .populate("createdBy updatedBy", "name email"),
      FinancePeriodLock.find(buildScopedWorkspaceFilter(req))
        .sort({ periodStart: -1 })
        .limit(6)
        .populate("lockedBy", "name email"),
      InvoiceRecord.find(buildScopedWorkspaceFilter(req, { status: "paid" }))
        .select("taxAmount amount currency paidAt createdAt"),
      ExpenseRecord.find(buildScopedWorkspaceFilter(req, { status: { $in: ["approved", "reimbursed", "reconciled", "pending_review"] } }))
        .select("taxAmount amount currency expenseDate status category vendorName createdAt updatedAt accounting"),
      InvoiceRecord.find(buildScopedWorkspaceFilter(req, { status: { $in: ["pending_review", "approved", "partial", "overdue"] } }))
        .select("customerName invoiceNumber amount paidAmount currency dueDate status createdAt updatedAt accounting"),
      WarehouseProduct.find(buildScopedWorkspaceFilter(req, { productStatus: { $ne: "discontinued" } }))
        .select("currentStock unitCost currency"),
      BankAccount.find(buildScopedWorkspaceFilter(req, { status: { $ne: "disconnected" } })).select("currentBalance currency"),
      BankTransaction.find(buildScopedWorkspaceFilter(req, { transactionDate: { $gt: new Date() } })).select("bankAccountId amount")
    ]);

    const taxCollected = {};
    const taxPaid = {};
    for (const invoice of paidInvoices) {
      addMoneyToCurrencyBucket(taxCollected, normalizeCurrencyCode(invoice.currency || "USD"), Number(invoice.taxAmount || 0));
    }
    for (const expense of financeExpenses.filter((entry) => ["approved", "reimbursed", "reconciled"].includes(entry.status))) {
      addMoneyToCurrencyBucket(taxPaid, normalizeCurrencyCode(expense.currency || "USD"), Number(expense.taxAmount || 0));
    }

    const agedBuckets = {
      "0_30": {},
      "31_60": {},
      "61_90": {},
      "90_plus": {}
    };
    for (const invoice of receivableInvoices) {
      const outstanding = Math.max(0, Number(invoice.amount || 0) - Number(invoice.paidAmount || 0));
      if (outstanding <= 0) {
        continue;
      }
      const dueDate = new Date(invoice.dueDate || invoice.createdAt || new Date());
      const overdueDays = Number.isNaN(dueDate.getTime())
        ? 0
        : Math.max(0, Math.floor((Date.now() - dueDate.getTime()) / (24 * 60 * 60 * 1000)));
      addMoneyToCurrencyBucket(
        agedBuckets[receivableAgeBucket(overdueDays)],
        normalizeCurrencyCode(invoice.currency || "USD"),
        outstanding
      );
    }

    const futureTransactionAdjustments = futureTransactions.reduce((accumulator, transaction) => {
      const accountId = transaction.bankAccountId?.toString?.();
      if (!accountId) {
        return accumulator;
      }
      accumulator[accountId] = roundMoney(Number(accumulator[accountId] || 0) + Number(transaction.amount || 0));
      return accumulator;
    }, {});
    const cash = {};
    for (const account of bankAccounts) {
      addMoneyToCurrencyBucket(
        cash,
        normalizeCurrencyCode(account.currency || req.workspace?.defaultCurrency || "USD"),
        roundMoney(Number(account.currentBalance || 0) - Number(futureTransactionAdjustments[account._id.toString()] || 0))
      );
    }
    const inventory = {};
    for (const product of warehouseProducts) {
      addMoneyToCurrencyBucket(
        inventory,
        normalizeCurrencyCode(product.currency || req.workspace?.defaultCurrency || "USD"),
        roundMoney(Number(product.currentStock || 0) * Number(product.unitCost || 0))
      );
    }
    const accountsReceivable = {};
    for (const invoice of receivableInvoices) {
      const outstanding = Math.max(0, Number(invoice.amount || 0) - Number(invoice.paidAmount || 0));
      if (outstanding > 0) {
        addMoneyToCurrencyBucket(accountsReceivable, normalizeCurrencyCode(invoice.currency || "USD"), outstanding);
      }
    }
    const accountsPayable = {};
    const retainedRevenue = {};
    const retainedExpenses = {};
    for (const expense of financeExpenses) {
      if (["pending_review", "approved"].includes(expense.status)) {
        addMoneyToCurrencyBucket(accountsPayable, normalizeCurrencyCode(expense.currency || "USD"), Number(expense.amount || 0));
      }
      if (["approved", "reimbursed", "reconciled"].includes(expense.status)) {
        addMoneyToCurrencyBucket(retainedExpenses, normalizeCurrencyCode(expense.currency || "USD"), Number(expense.amount || 0));
      }
    }
    for (const invoice of paidInvoices) {
      addMoneyToCurrencyBucket(retainedRevenue, normalizeCurrencyCode(invoice.currency || "USD"), Number(invoice.amount || 0));
    }
    const assets = {};
    [cash, inventory, accountsReceivable].forEach((bucket) => {
      Object.entries(bucket).forEach(([currency, amount]) => addMoneyToCurrencyBucket(assets, currency, amount));
    });
    const retainedEarnings = subtractCurrencyBuckets(retainedRevenue, retainedExpenses);
    const liabilities = cloneCurrencyBucket(accountsPayable);
    const equity = cloneCurrencyBucket(retainedEarnings);

    return res.json({
      journals: journals.map(serializeJournalEntry),
      closeReviewPeriods: buildRecentPeriodKeys(6).map((periodKey) =>
        buildFinancePeriodCloseReadiness({
          periodKey,
          invoices: receivableInvoices,
          expenses: financeExpenses,
          periodLocks
        })
      ),
      taxSummary: {
        collected: taxCollected,
        paid: taxPaid,
        net: subtractCurrencyBuckets(taxCollected, taxPaid),
        normalized: {
          ...buildNormalizationMetadata(requestedBaseCurrency, rateContext.rates),
          collected: sumCurrencyBucketInBaseCurrency(taxCollected, requestedBaseCurrency, rateContext.rates),
          paid: sumCurrencyBucketInBaseCurrency(taxPaid, requestedBaseCurrency, rateContext.rates),
          net: sumCurrencyBucketInBaseCurrency(subtractCurrencyBuckets(taxCollected, taxPaid), requestedBaseCurrency, rateContext.rates)
        }
      },
      balanceSheet: {
        assets: {
          cash,
          inventory,
          accountsReceivable,
          total: assets
        },
        liabilities: {
          accountsPayable,
          total: liabilities
        },
        equity: {
          retainedEarnings,
          total: equity
        },
        normalizedTotals: {
          ...buildNormalizationMetadata(requestedBaseCurrency, rateContext.rates),
          assets: sumCurrencyBucketInBaseCurrency(assets, requestedBaseCurrency, rateContext.rates),
          liabilities: sumCurrencyBucketInBaseCurrency(liabilities, requestedBaseCurrency, rateContext.rates),
          equity: sumCurrencyBucketInBaseCurrency(equity, requestedBaseCurrency, rateContext.rates)
        }
      },
      agedReceivables: {
        buckets: agedBuckets,
        normalizedTotals: {
          ...buildNormalizationMetadata(requestedBaseCurrency, rateContext.rates),
          byBucket: Object.fromEntries(
            Object.entries(agedBuckets).map(([bucketKey, totals]) => [
              bucketKey,
              sumCurrencyBucketInBaseCurrency(totals, requestedBaseCurrency, rateContext.rates)
            ])
          )
        }
      }
    });
  } catch (_error) {
    return res.status(500).json({ message: "Unable to load accountant summary." });
  }
});

router.get("/reports/profit-loss", async (req, res) => {
  try {
    const period = normalizeReportPeriod(req.query.period);
    const rateContext = await loadFinanceRateContext(req, {
      baseCurrency: req.query.baseCurrency || req.workspace?.defaultCurrency || "USD"
    });
    const requestedBaseCurrency = rateContext.requestedBaseCurrency;
    const [invoices, expenses] = await Promise.all([
      InvoiceRecord.find(buildScopedWorkspaceFilter(req, { status: "paid" }))
        .select("amount currency paidAt updatedAt createdAt"),
      ExpenseRecord.find(buildScopedWorkspaceFilter(req, { status: { $in: ["approved", "reimbursed", "reconciled"] } }))
        .select("amount currency approvedAt expenseDate updatedAt createdAt")
    ]);

    const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate) : null;
    if (endDate && !Number.isNaN(endDate.getTime())) {
      endDate.setUTCHours(23, 59, 59, 999);
    }

    const revenueByPeriod = {};
    const expensesByPeriod = {};
    const totalRevenue = {};
    const totalExpenses = {};

    for (const invoice of invoices) {
      const effectiveDate = invoice.paidAt || invoice.updatedAt || invoice.createdAt;
      const date = new Date(effectiveDate);
      if (Number.isNaN(date.getTime())) {
        continue;
      }
      if (startDate && !Number.isNaN(startDate.getTime()) && date < startDate) {
        continue;
      }
      if (endDate && !Number.isNaN(endDate.getTime()) && date > endDate) {
        continue;
      }

      const periodKey = toPeriodKey(date, period);
      const currency = normalizeCurrencyCode(invoice.currency || "USD");
      addPeriodCurrencyAmount(revenueByPeriod, periodKey, currency, Number(invoice.amount || 0));
      addMoneyToCurrencyBucket(totalRevenue, currency, Number(invoice.amount || 0));
    }

    for (const expense of expenses) {
      const effectiveDate = expense.approvedAt || expense.expenseDate || expense.updatedAt || expense.createdAt;
      const date = new Date(effectiveDate);
      if (Number.isNaN(date.getTime())) {
        continue;
      }
      if (startDate && !Number.isNaN(startDate.getTime()) && date < startDate) {
        continue;
      }
      if (endDate && !Number.isNaN(endDate.getTime()) && date > endDate) {
        continue;
      }

      const periodKey = toPeriodKey(date, period);
      const currency = normalizeCurrencyCode(expense.currency || "USD");
      addPeriodCurrencyAmount(expensesByPeriod, periodKey, currency, Number(expense.amount || 0));
      addMoneyToCurrencyBucket(totalExpenses, currency, Number(expense.amount || 0));
    }

    const allPeriodKeys = [...new Set([...Object.keys(revenueByPeriod), ...Object.keys(expensesByPeriod)])].sort();
    const rows = allPeriodKeys.map((periodKey) => {
      const revenue = cloneCurrencyBucket(revenueByPeriod[periodKey] || {});
      const expensesBucket = cloneCurrencyBucket(expensesByPeriod[periodKey] || {});
      const grossProfit = subtractCurrencyBuckets(revenue, expensesBucket);
      return {
        periodKey,
        revenue,
        expenses: expensesBucket,
        grossProfit,
        normalizedApproximateGrossProfit: buildApproximateAmount(
          sumCurrencyBucketInBaseCurrency(grossProfit, requestedBaseCurrency, rateContext.rates),
          requestedBaseCurrency,
          rateContext.rates
        )
      };
    });

    const grossProfitTotals = subtractCurrencyBuckets(totalRevenue, totalExpenses);

    return res.json({
      period,
      totals: {
        revenue: totalRevenue,
        expenses: totalExpenses,
        grossProfit: grossProfitTotals
      },
      normalizedTotals: {
        ...buildNormalizationMetadata(requestedBaseCurrency, rateContext.rates),
        revenue: sumCurrencyBucketInBaseCurrency(totalRevenue, requestedBaseCurrency, rateContext.rates),
        expenses: sumCurrencyBucketInBaseCurrency(totalExpenses, requestedBaseCurrency, rateContext.rates),
        grossProfit: sumCurrencyBucketInBaseCurrency(grossProfitTotals, requestedBaseCurrency, rateContext.rates)
      },
      rows
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load profit and loss report." });
  }
});

router.get("/reports/cash-flow", async (req, res) => {
  try {
    const period = normalizeReportPeriod(req.query.period);
    const rateContext = await loadFinanceRateContext(req, {
      baseCurrency: req.query.baseCurrency || req.workspace?.defaultCurrency || "USD"
    });
    const requestedBaseCurrency = rateContext.requestedBaseCurrency;
    const [invoices, expenses] = await Promise.all([
      InvoiceRecord.find(buildScopedWorkspaceFilter(req, {}))
        .select("currency payments"),
      ExpenseRecord.find(buildScopedWorkspaceFilter(req, { status: { $in: ["reimbursed", "reconciled"] } }))
        .select("amount currency reimbursedAt expenseDate updatedAt createdAt")
    ]);

    const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate) : null;
    if (endDate && !Number.isNaN(endDate.getTime())) {
      endDate.setUTCHours(23, 59, 59, 999);
    }

    const cashInByPeriod = {};
    const cashOutByPeriod = {};
    const totalCashIn = {};
    const totalCashOut = {};

    for (const invoice of invoices) {
      const currency = normalizeCurrencyCode(invoice.currency || "USD");
      for (const payment of Array.isArray(invoice.payments) ? invoice.payments : []) {
        const date = new Date(payment?.recordedAt || invoice.updatedAt || invoice.createdAt);
        if (Number.isNaN(date.getTime())) {
          continue;
        }
        if (startDate && !Number.isNaN(startDate.getTime()) && date < startDate) {
          continue;
        }
        if (endDate && !Number.isNaN(endDate.getTime()) && date > endDate) {
          continue;
        }

        const amount = Number(payment?.amount || 0);
        const periodKey = toPeriodKey(date, period);
        addPeriodCurrencyAmount(cashInByPeriod, periodKey, currency, amount);
        addMoneyToCurrencyBucket(totalCashIn, currency, amount);
      }
    }

    for (const expense of expenses) {
      const date = new Date(expense.reimbursedAt || expense.expenseDate || expense.updatedAt || expense.createdAt);
      if (Number.isNaN(date.getTime())) {
        continue;
      }
      if (startDate && !Number.isNaN(startDate.getTime()) && date < startDate) {
        continue;
      }
      if (endDate && !Number.isNaN(endDate.getTime()) && date > endDate) {
        continue;
      }

      const currency = normalizeCurrencyCode(expense.currency || "USD");
      const amount = Number(expense.amount || 0);
      const periodKey = toPeriodKey(date, period);
      addPeriodCurrencyAmount(cashOutByPeriod, periodKey, currency, amount);
      addMoneyToCurrencyBucket(totalCashOut, currency, amount);
    }

    const allPeriodKeys = [...new Set([...Object.keys(cashInByPeriod), ...Object.keys(cashOutByPeriod)])].sort();
    const rows = allPeriodKeys.map((periodKey) => {
      const cashIn = cloneCurrencyBucket(cashInByPeriod[periodKey] || {});
      const cashOut = cloneCurrencyBucket(cashOutByPeriod[periodKey] || {});
      const netCashFlow = subtractCurrencyBuckets(cashIn, cashOut);
      return {
        periodKey,
        cashIn,
        cashOut,
        netCashFlow,
        normalizedApproximateNetCashFlow: buildApproximateAmount(
          sumCurrencyBucketInBaseCurrency(netCashFlow, requestedBaseCurrency, rateContext.rates),
          requestedBaseCurrency,
          rateContext.rates
        )
      };
    });

    const netCashFlowTotals = subtractCurrencyBuckets(totalCashIn, totalCashOut);

    return res.json({
      period,
      totals: {
        cashIn: totalCashIn,
        cashOut: totalCashOut,
        netCashFlow: netCashFlowTotals
      },
      normalizedTotals: {
        ...buildNormalizationMetadata(requestedBaseCurrency, rateContext.rates),
        cashIn: sumCurrencyBucketInBaseCurrency(totalCashIn, requestedBaseCurrency, rateContext.rates),
        cashOut: sumCurrencyBucketInBaseCurrency(totalCashOut, requestedBaseCurrency, rateContext.rates),
        netCashFlow: sumCurrencyBucketInBaseCurrency(netCashFlowTotals, requestedBaseCurrency, rateContext.rates)
      },
      rows
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load cash flow report." });
  }
});

router.get("/reports/aged-receivables", async (req, res) => {
  try {
    const rateContext = await loadFinanceRateContext(req, {
      baseCurrency: req.query.baseCurrency || req.workspace?.defaultCurrency || "USD"
    });
    const requestedBaseCurrency = rateContext.requestedBaseCurrency;
    const invoices = await InvoiceRecord.find(
      buildScopedWorkspaceFilter(req, {
        status: { $in: ["pending_review", "approved", "partial", "overdue"] },
        ...normalizeDateRangeFilter(req.query, "dueDate")
      })
    ).select("invoiceNumber customerName vendorName amount paidAmount currency dueDate");

    const now = Date.now();
    const buckets = {
      "0_30": {},
      "31_60": {},
      "61_90": {},
      "90_plus": {}
    };
    const customerMap = new Map();

    for (const invoice of invoices) {
      const outstandingAmount = Math.max(0, Number(invoice.amount || 0) - Number(invoice.paidAmount || 0));
      if (outstandingAmount <= 0) {
        continue;
      }

      const dueDate = new Date(invoice.dueDate || invoice.createdAt || new Date());
      const diffDays = Number.isNaN(dueDate.getTime())
        ? 0
        : Math.max(0, Math.floor((now - dueDate.getTime()) / (24 * 60 * 60 * 1000)));
      const bucketKey = receivableAgeBucket(diffDays);
      const currency = normalizeCurrencyCode(invoice.currency || "USD");
      const customerName = String(invoice.customerName || invoice.vendorName || "Unassigned customer").trim();

      addMoneyToCurrencyBucket(buckets[bucketKey], currency, outstandingAmount);

      const customer = customerMap.get(customerName) || {
        name: customerName,
        buckets: {
          "0_30": {},
          "31_60": {},
          "61_90": {},
          "90_plus": {}
        },
        totalOutstanding: {}
      };
      addMoneyToCurrencyBucket(customer.buckets[bucketKey], currency, outstandingAmount);
      addMoneyToCurrencyBucket(customer.totalOutstanding, currency, outstandingAmount);
      customerMap.set(customerName, customer);
    }

    const customers = [...customerMap.values()].sort(
      (left, right) => sumCurrencyBucketCents(right.totalOutstanding) - sumCurrencyBucketCents(left.totalOutstanding)
    );
    const totalOutstanding = Object.values(buckets).reduce((accumulator, bucket) => {
      Object.entries(bucket).forEach(([currency, amount]) => addMoneyToCurrencyBucket(accumulator, currency, amount));
      return accumulator;
    }, {});

    return res.json({
      buckets,
      customers,
      totals: totalOutstanding,
      normalizedTotals: {
        ...buildNormalizationMetadata(requestedBaseCurrency, rateContext.rates),
        totalOutstanding: sumCurrencyBucketInBaseCurrency(totalOutstanding, requestedBaseCurrency, rateContext.rates),
        byBucket: Object.fromEntries(
          Object.entries(buckets).map(([bucketKey, totals]) => [bucketKey, sumCurrencyBucketInBaseCurrency(totals, requestedBaseCurrency, rateContext.rates)])
        )
      }
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load aged receivables report." });
  }
});

router.get("/reports/balance-sheet", async (req, res) => {
  try {
    const rateContext = await loadFinanceRateContext(req, {
      baseCurrency: req.query.baseCurrency || req.workspace?.defaultCurrency || "USD"
    });
    const requestedBaseCurrency = rateContext.requestedBaseCurrency;
    const asOfDate = req.query.asOfDate ? new Date(req.query.asOfDate) : new Date();
    if (Number.isNaN(asOfDate.getTime())) {
      return res.status(400).json({ message: "As of date must be valid." });
    }
    asOfDate.setUTCHours(23, 59, 59, 999);

    const [bankAccounts, futureTransactions, receivableInvoices, warehouseProducts, payableExpenses, retainedRevenueInvoices, retainedExpenseRows] = await Promise.all([
      BankAccount.find(buildScopedWorkspaceFilter(req, {
        status: { $ne: "disconnected" }
      })).select("currentBalance currency"),
      BankTransaction.find(buildScopedWorkspaceFilter(req, {
        transactionDate: { $gt: asOfDate }
      })).select("bankAccountId amount"),
      InvoiceRecord.find(buildScopedWorkspaceFilter(req, {
        status: { $in: ["approved", "partial", "overdue"] },
        createdAt: { $lte: asOfDate }
      })).select("amount paidAmount currency"),
      WarehouseProduct.find(buildScopedWorkspaceFilter(req, {
        productStatus: { $ne: "discontinued" }
      })).select("currentStock unitCost currency"),
      ExpenseRecord.find(buildScopedWorkspaceFilter(req, {
        status: { $in: ["pending_review", "approved"] },
        expenseDate: { $lte: asOfDate }
      })).select("amount currency"),
      InvoiceRecord.find(buildScopedWorkspaceFilter(req, {
        status: "paid",
        paidAt: { $lte: asOfDate }
      })).select("amount currency"),
      ExpenseRecord.find(buildScopedWorkspaceFilter(req, {
        status: { $in: ["approved", "reimbursed", "reconciled"] },
        expenseDate: { $lte: asOfDate }
      })).select("amount currency")
    ]);

    const futureTransactionAdjustments = futureTransactions.reduce((accumulator, transaction) => {
      const accountId = transaction.bankAccountId?.toString?.();
      if (!accountId) {
        return accumulator;
      }

      accumulator[accountId] = roundMoney(Number(accumulator[accountId] || 0) + Number(transaction.amount || 0));
      return accumulator;
    }, {});

    const cash = {};
    for (const account of bankAccounts) {
      const accountId = account._id.toString();
      const currency = normalizeCurrencyCode(account.currency || req.workspace?.defaultCurrency || "USD");
      const adjustedBalance = roundMoney(Number(account.currentBalance || 0) - Number(futureTransactionAdjustments[accountId] || 0));
      addMoneyToCurrencyBucket(cash, currency, adjustedBalance);
    }

    const accountsReceivable = {};
    for (const invoice of receivableInvoices) {
      const currency = normalizeCurrencyCode(invoice.currency || "USD");
      const outstandingAmount = Math.max(0, Number(invoice.amount || 0) - Number(invoice.paidAmount || 0));
      if (outstandingAmount > 0) {
        addMoneyToCurrencyBucket(accountsReceivable, currency, outstandingAmount);
      }
    }

    const inventory = {};
    for (const product of warehouseProducts) {
      const currency = normalizeCurrencyCode(product.currency || req.workspace?.defaultCurrency || "USD");
      addMoneyToCurrencyBucket(inventory, currency, roundMoney(Number(product.currentStock || 0) * Number(product.unitCost || 0)));
    }

    const accountsPayable = {};
    for (const expense of payableExpenses) {
      const currency = normalizeCurrencyCode(expense.currency || "USD");
      addMoneyToCurrencyBucket(accountsPayable, currency, Number(expense.amount || 0));
    }

    const retainedRevenue = {};
    for (const invoice of retainedRevenueInvoices) {
      addMoneyToCurrencyBucket(retainedRevenue, normalizeCurrencyCode(invoice.currency || "USD"), Number(invoice.amount || 0));
    }

    const retainedExpenses = {};
    for (const expense of retainedExpenseRows) {
      addMoneyToCurrencyBucket(retainedExpenses, normalizeCurrencyCode(expense.currency || "USD"), Number(expense.amount || 0));
    }

    const totalAssets = {};
    [cash, accountsReceivable, inventory].forEach((bucket) => {
      Object.entries(bucket).forEach(([currency, amount]) => addMoneyToCurrencyBucket(totalAssets, currency, amount));
    });

    const totalLiabilities = {};
    Object.entries(accountsPayable).forEach(([currency, amount]) => addMoneyToCurrencyBucket(totalLiabilities, currency, amount));

    const retainedEarnings = subtractCurrencyBuckets(retainedRevenue, retainedExpenses);
    const totalEquity = {};
    Object.entries(retainedEarnings).forEach(([currency, amount]) => addMoneyToCurrencyBucket(totalEquity, currency, amount));

    const normalizedAssets = sumCurrencyBucketInBaseCurrency(totalAssets, requestedBaseCurrency, rateContext.rates);
    const normalizedLiabilities = sumCurrencyBucketInBaseCurrency(totalLiabilities, requestedBaseCurrency, rateContext.rates);
    const normalizedEquity = sumCurrencyBucketInBaseCurrency(totalEquity, requestedBaseCurrency, rateContext.rates);
    const liabilitiesPlusEquity = roundMoney(normalizedLiabilities + normalizedEquity);
    const difference = roundMoney(normalizedAssets - liabilitiesPlusEquity);

    return res.json({
      asOfDate,
      assets: {
        cash,
        accountsReceivable,
        inventory,
        total: totalAssets
      },
      liabilities: {
        accountsPayable,
        total: totalLiabilities
      },
      equity: {
        retainedEarnings,
        total: totalEquity
      },
      normalizedTotals: {
        ...buildNormalizationMetadata(requestedBaseCurrency, rateContext.rates),
        assets: normalizedAssets,
        liabilities: normalizedLiabilities,
        equity: normalizedEquity
      },
      balanceCheck: {
        ...buildNormalizationMetadata(requestedBaseCurrency, rateContext.rates),
        assets: normalizedAssets,
        liabilitiesPlusEquity,
        difference,
        isBalanced: Math.abs(difference) <= 0.01
      }
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load balance sheet report." });
  }
});

router.use("/accounting", requireAccountingEnabled);

router.get("/accounting/exports/statement", async (req, res) => {
  try {
    await ensureWorkspaceChartOfAccounts(req.workspaceId);
    const accountingPeriod = normalizeAccountingPeriod(req.query.accountingPeriod);
    const reportVariant = normalizeAccountingReportVariant(req.query.variant);
    const [journalEntries, previousJournalEntries, recentJournalEntries, chartCount] = await Promise.all([
      JournalEntry.find(buildAccountingJournalFilter(req, {}, accountingPeriod)).select(
        "status entryType totalDebit totalCredit lines accountCode postingDate description entryNumber createdAt metadata"
      ),
      accountingPeriod === "all"
        ? Promise.resolve([])
        : JournalEntry.find(buildPreviousAccountingJournalFilter(req, {}, accountingPeriod)).select(
            "status entryType totalDebit totalCredit lines accountCode postingDate description entryNumber createdAt metadata"
          ),
      JournalEntry.find(buildAccountingJournalFilter(req, {}, accountingPeriod))
        .sort({ postingDate: -1, createdAt: -1 })
        .limit(12)
        .populate("createdBy updatedBy", "name email"),
      ChartOfAccount.countDocuments(buildScopedWorkspaceFilter(req))
    ]);

    const accountingSummaryPayload = buildAccountingSummaryPayload({
      accountingPeriod,
      journalEntries,
      previousJournalEntries,
      chartCount
    });
    const statementRows = filterStatementRowsByVariant(
      buildStatementExportRows(accountingSummaryPayload),
      reportVariant
    );
    const reportSections = buildStatementReportSections(statementRows, reportVariant);

    return res.json({
      exportType: "accounting_statement_snapshot",
      generatedAt: new Date().toISOString(),
      workspace: buildAccountingWorkspaceExport(req),
      period: {
        key: accountingPeriod,
        label: getAccountingPeriodLabel(accountingPeriod)
      },
      reportVariant: {
        key: reportVariant,
        label: getAccountingReportVariantLabel(reportVariant)
      },
      reportHeader: {
        title: `${getAccountingReportVariantLabel(reportVariant)} report`,
        subtitle: `${req.workspace?.name || "Workspace"} · ${getAccountingPeriodLabel(accountingPeriod)}`,
        generatedAt: new Date().toISOString()
      },
      accountingSnapshot: accountingSummaryPayload.accountingSnapshot,
      accountingStatements: accountingSummaryPayload.accountingStatements,
      statementRows,
      reportSections,
      recentJournalEntries: recentJournalEntries.map(serializeJournalEntry)
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to prepare accounting statement export." });
  }
});

router.post("/accounting/period-locks", requireFinanceManager, async (req, res) => {
  try {
    const periodKey = normalizePeriodKey(req.body.periodKey);
    if (!periodKey) {
      return res.status(400).json({ message: "A valid period key is required." });
    }

    const range = periodRangeFromKey(periodKey);
    if (!range) {
      return res.status(400).json({ message: "That accounting period is invalid." });
    }
    const lockResult = await FinancePeriodLock.findOneAndUpdate(
      buildScopedWorkspaceFilter(req, { periodKey }),
      {
        $setOnInsert: {
          workspaceId: req.workspaceId,
          periodKey,
          periodStart: range.start,
          periodEnd: range.end,
          note: String(req.body.note || "").trim().slice(0, 240),
          lockedBy: req.user._id
        }
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
        rawResult: true
      }
    );
    const lock = lockResult?.value || null;
    if (!lock) {
      return res.status(500).json({ message: "Unable to lock that accounting period." });
    }

    await lock.populate("lockedBy", "name email");
    // Only a newly inserted lock should emit side effects; an existing lock is returned as-is.
    const wasCreated = Boolean(lockResult?.lastErrorObject?.upserted);

    if (wasCreated) {
      await createFinanceAction({
        workspaceId: req.workspaceId,
        itemType: "control",
        itemId: req.workspaceId,
        action: "locked",
        performedBy: req.user._id,
        metadata: {
          periodKey,
          periodLabel: formatPeriodKeyLabel(periodKey),
          note: lock.note || ""
        }
      });

      await writeAuditLog({
        actor: req.user._id,
        action: "finance.period.lock",
        targetId: req.workspaceId?.toString?.() || null,
        targetType: "Workspace",
        metadata: buildFinanceAuditPayload(req, {
          periodKey,
          periodLabel: formatPeriodKeyLabel(periodKey),
          note: lock.note || ""
        })
      });
    }

    return res.status(wasCreated ? 201 : 200).json(serializeFinancePeriodLock(lock));
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: "That period is already locked." });
    }

    return res.status(500).json({ message: "Unable to lock that accounting period." });
  }
});

router.delete("/accounting/period-locks/:periodKey", requireFinanceManager, async (req, res) => {
  try {
    const periodKey = normalizePeriodKey(req.params.periodKey);
    if (!periodKey) {
      return res.status(400).json({ message: "A valid period key is required." });
    }

    const existingLock = await FinancePeriodLock.findOneAndDelete(buildScopedWorkspaceFilter(req, { periodKey })).populate(
      "lockedBy",
      "name email"
    );

    if (!existingLock) {
      return res.status(404).json({ message: "That accounting period is not locked." });
    }

    const unlockedRange = existingLock.periodStart && existingLock.periodEnd
      ? { start: existingLock.periodStart, end: existingLock.periodEnd }
      : periodRangeFromKey(periodKey);
    if (unlockedRange) {
      await Promise.all([
        InvoiceRecord.updateMany(
          {
            $and: [
              buildScopedWorkspaceFilter(req, {
                "accounting.controlStatus": "blocked",
                "accounting.blockedPeriodKey": periodKey
              }),
              {
                $or: [
                  { createdAt: { $gte: unlockedRange.start, $lte: unlockedRange.end } },
                  { dueDate: { $gte: unlockedRange.start, $lte: unlockedRange.end } },
                  { paidAt: { $gte: unlockedRange.start, $lte: unlockedRange.end } }
                ]
              }
            ]
          },
          {
            $set: {
              "accounting.controlStatus": "clear",
              "accounting.blockedReason": "",
              "accounting.blockedAt": null,
              "accounting.blockedPeriodKey": "",
              "accounting.lastSyncedAt": new Date()
            }
          }
        ),
        ExpenseRecord.updateMany(
          {
            $and: [
              buildScopedWorkspaceFilter(req, {
                "accounting.controlStatus": "blocked",
                "accounting.blockedPeriodKey": periodKey
              }),
              {
                $or: [
                  { expenseDate: { $gte: unlockedRange.start, $lte: unlockedRange.end } },
                  { createdAt: { $gte: unlockedRange.start, $lte: unlockedRange.end } },
                  { updatedAt: { $gte: unlockedRange.start, $lte: unlockedRange.end } }
                ]
              }
            ]
          },
          {
            $set: {
              "accounting.controlStatus": "clear",
              "accounting.blockedReason": "",
              "accounting.blockedAt": null,
              "accounting.blockedPeriodKey": "",
              "accounting.lastSyncedAt": new Date()
            }
          }
        ),
        InvoiceRecord.updateMany(
          buildScopedWorkspaceFilter(req, {
            "accounting.controlStatus": "blocked",
            createdAt: { $gte: unlockedRange.start, $lte: unlockedRange.end }
          }),
          { $unset: { "accounting.controlStatus": "" } }
        ),
        ExpenseRecord.updateMany(
          buildScopedWorkspaceFilter(req, {
            "accounting.controlStatus": "blocked",
            createdAt: { $gte: unlockedRange.start, $lte: unlockedRange.end }
          }),
          { $unset: { "accounting.controlStatus": "" } }
        )
      ]);
    }

    await createFinanceAction({
      workspaceId: req.workspaceId,
      itemType: "control",
      itemId: req.workspaceId,
      action: "unlocked",
      performedBy: req.user._id,
      metadata: {
        periodKey,
        periodLabel: formatPeriodKeyLabel(periodKey)
      }
    });

    await writeAuditLog({
      actor: req.user._id,
      action: "finance.period.unlock",
      targetId: req.workspaceId?.toString?.() || null,
      targetType: "Workspace",
      metadata: buildFinanceAuditPayload(req, {
        periodKey,
        periodLabel: formatPeriodKeyLabel(periodKey)
      })
    });

    return res.json({
      success: true,
      periodKey,
      periodLabel: formatPeriodKeyLabel(periodKey)
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to unlock that accounting period." });
  }
});

router.get("/accounting/accounts", async (req, res) => {
  try {
    await ensureWorkspaceChartOfAccounts(req.workspaceId);
    const accounts = await ChartOfAccount.find(buildScopedWorkspaceFilter(req)).sort({ code: 1 });
    return res.json(accounts.map(serializeChartOfAccount));
  } catch (error) {
    return res.status(500).json({ message: "Unable to load chart of accounts." });
  }
});

router.get("/accounting/journals", async (req, res) => {
  try {
    const limit = parseQueryInt(req.query.limit, 50, 1, 200);
    const accountingPeriod = normalizeAccountingPeriod(req.query.accountingPeriod);
    const journals = await JournalEntry.find(buildAccountingJournalFilter(req, {}, accountingPeriod))
      .sort({ postingDate: -1, createdAt: -1 })
      .limit(limit)
      .populate("createdBy updatedBy", "name email");

    return res.json(journals.map(serializeJournalEntry));
  } catch (error) {
    return res.status(500).json({ message: "Unable to load journal entries." });
  }
});

router.get("/accounting/exports/journals", async (req, res) => {
  try {
    const accountingPeriod = normalizeAccountingPeriod(req.query.accountingPeriod);
    const limit = parseQueryInt(req.query.limit, 150, 1, 300);
    const journals = await JournalEntry.find(buildAccountingJournalFilter(req, {}, accountingPeriod))
      .sort({ postingDate: -1, createdAt: -1 })
      .limit(limit)
      .populate("createdBy updatedBy", "name email");

    const serializedJournals = journals.map(serializeJournalEntry);
    const totals = buildJournalTotalsByCurrency(serializedJournals);

    return res.json({
      exportType: "accounting_journal_list",
      generatedAt: new Date().toISOString(),
      workspace: buildAccountingWorkspaceExport(req),
      period: {
        key: accountingPeriod,
        label: getAccountingPeriodLabel(accountingPeriod)
      },
      reportVariant: {
        key: "journals",
        label: "Journal report"
      },
      reportHeader: {
        title: "Journal report",
        subtitle: `${req.workspace?.name || "Workspace"} · ${getAccountingPeriodLabel(accountingPeriod)}`,
        generatedAt: new Date().toISOString()
      },
      totals,
      journalRows: buildJournalExportRows(serializedJournals, accountingPeriod),
      journals: serializedJournals
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to prepare journal export." });
  }
});

router.get("/accounting/accounts/:code", async (req, res) => {
  try {
    const accountCode = String(req.params.code || "").trim().toUpperCase();
    if (!accountCode) {
      return res.status(400).json({ message: "Account code is required." });
    }

    const accountingPeriod = normalizeAccountingPeriod(req.query.accountingPeriod);
    const limit = parseQueryInt(req.query.limit, 20, 1, 100);
    const account = await ChartOfAccount.findOne(buildScopedWorkspaceFilter(req, { code: accountCode }));

    if (!account) {
      return res.status(404).json({ message: "Account not found." });
    }

    const journals = await JournalEntry.find(
      buildAccountingJournalFilter(req, { "lines.accountCode": accountCode }, accountingPeriod)
    )
      .sort({ postingDate: -1, createdAt: -1 })
      .limit(limit)
      .populate("createdBy updatedBy", "name email");

    // The account balance must come from the full posted journal history, not the paginated page.
    const balanceRows = await JournalEntry.aggregate([
      {
        $match: buildAccountingJournalFilter(
          req,
          {
            status: "posted",
            "lines.accountCode": accountCode
          },
          accountingPeriod
        )
      },
      { $unwind: "$lines" },
      { $match: { "lines.accountCode": accountCode } },
      {
        $group: {
          _id: null,
          debitCents: {
            $sum: { $toLong: { $round: [{ $multiply: [{ $ifNull: ["$lines.debit", 0] }, 100] }, 0] } }
          },
          creditCents: {
            $sum: { $toLong: { $round: [{ $multiply: [{ $ifNull: ["$lines.credit", 0] }, 100] }, 0] } }
          }
        }
      }
    ]);
    const debitCents = balanceRows[0]?.debitCents || 0;
    const creditCents = balanceRows[0]?.creditCents || 0;

    const entries = journals.map((entry) => {
      const matchingLine = (entry.lines || []).find((line) => line.accountCode === accountCode) || null;
      const counterpartLines = (entry.lines || [])
        .filter((line) => line.accountCode !== accountCode)
        .slice(0, 3)
        .map((line) => ({
          accountCode: line.accountCode,
          accountName: line.accountName,
          debit: Number(line.debit || 0),
          credit: Number(line.credit || 0)
        }));

      return {
        id: entry._id.toString(),
        entryNumber: entry.entryNumber,
        entryType: entry.entryType,
        postingDate: entry.postingDate,
        description: entry.description,
        status: entry.status,
        debit: Number(matchingLine?.debit || 0),
        credit: Number(matchingLine?.credit || 0),
        netMovement:
          account.type === "asset" || account.type === "expense"
            ? Number(Number(matchingLine?.debit || 0) - Number(matchingLine?.credit || 0))
            : Number(Number(matchingLine?.credit || 0) - Number(matchingLine?.debit || 0)),
        counterparts: counterpartLines
      };
    });

    const balance =
      account.type === "asset" || account.type === "expense"
        ? fromCents(debitCents - creditCents)
        : fromCents(creditCents - debitCents);
    const totalDebits = fromCents(debitCents);
    const totalCredits = fromCents(creditCents);

    return res.json({
      period: accountingPeriod,
      account: serializeChartOfAccount(account),
      balance,
      totalDebits,
      totalCredits,
      entries
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load account activity." });
  }
});

router.get("/invoices", async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) {
      filter.status = String(req.query.status);
    }
    if (req.query.customerId && mongoose.isValidObjectId(req.query.customerId)) {
      filter.customerId = req.query.customerId;
    }
    if (req.query.recurring === "enabled") {
      filter["recurring.enabled"] = true;
    }

    const invoices = await populateInvoiceRelations(
      InvoiceRecord.find(buildScopedWorkspaceFilter(req, filter)).sort({ dueDate: 1, createdAt: -1 })
    );

    return res.json(invoices.map(serializeInvoice));
  } catch (error) {
    return res.status(500).json({ message: "Unable to load invoices." });
  }
});

router.get("/invoices/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid invoice id." });
    }

    const invoice = await populateInvoiceRelations(
      InvoiceRecord.findOne(buildScopedWorkspaceFilter(req, { _id: req.params.id }))
    );

    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found." });
    }

    const accountingEnabled = isAccountingEnabledForWorkspace(req.workspace);
    const actions = await loadRecentFinanceActions(req, "invoice", invoice._id, 10);

    return res.json({
      ...serializeInvoice(invoice),
      accountingEnabled,
      accountingJournalRefs: accountingEnabled
        ? {
            revenueEntryId: invoice.accounting?.revenueEntryId?.toString?.() || null,
            revenueEntryStatus: invoice.accounting?.revenueEntryStatus || "unposted",
            paymentEntryIds: Array.isArray(invoice.accounting?.paymentEntryIds)
              ? invoice.accounting.paymentEntryIds.map((entryId) => entryId?.toString?.() || null).filter(Boolean)
              : [],
            paymentPostedCount: Number(invoice.accounting?.paymentPostedCount || 0)
          }
        : null,
      actionLog: actions.map(serializeAction)
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load invoice detail." });
  }
});

router.get("/invoices/:id/pdf", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid invoice id." });
    }

    const invoice = await populateInvoiceRelations(
      InvoiceRecord.findOne(buildScopedWorkspaceFilter(req, { _id: req.params.id }))
    );

    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found." });
    }

    const document = new PDFDocument({
      margin: 48,
      size: "A4"
    });
    const fileName = `invoice-${sanitizeDownloadName(invoice.invoiceNumber)}.pdf`;
    const remainingBalance = Math.max(0, Number(invoice.amount || 0) - Number(invoice.paidAmount || 0));
    const lineItems =
      Array.isArray(invoice.lineItems) && invoice.lineItems.length
        ? invoice.lineItems
        : [
            {
              description: invoice.note ? "Invoice total" : "Invoice amount",
              amount: Number(invoice.amount || 0)
            }
          ];

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=\"${fileName}\"`);

    document.pipe(res);

    const sectionHeading = (label) => {
      document.moveDown();
      document.font("Helvetica-Bold").fontSize(11).fillColor("#475569").text(label.toUpperCase(), { characterSpacing: 1 });
      document.moveDown(0.4);
      document.fillColor("#111827").font("Helvetica");
    };

    const field = (label, value) => {
      document.font("Helvetica-Bold").fontSize(10).fillColor("#475569").text(`${label}: `, { continued: true });
      document.font("Helvetica").fillColor("#111827").text(value);
    };

    document.font("Helvetica-Bold").fontSize(22).fillColor("#111827").text(req.workspace?.name || "Workspace");
    document.fontSize(18).text(`Invoice ${invoice.invoiceNumber}`);
    document.moveDown(0.5);
    document.font("Helvetica").fontSize(11).fillColor("#475569").text(`Status: ${formatStatusLabel(invoice.status)}`);
    document.font("Helvetica-Bold").fontSize(26).fillColor("#111827").text(formatMoney(invoice.amount, invoice.currency));

    sectionHeading("Customer");
    field("Name", invoice.customerName || invoice.vendorName || "Customer");
    field("Email", invoice.customerEmail || "Not provided");

    sectionHeading("Invoice details");
    field("Invoice date", formatPdfDate(invoice.createdAt));
    field("Due date", formatPdfDate(invoice.dueDate));
    field("Currency", invoice.currency || "USD");
    field("Total amount", formatMoney(invoice.amount, invoice.currency));
    field("Paid amount", formatMoney(invoice.paidAmount || 0, invoice.currency));
    field("Remaining balance", formatMoney(remainingBalance, invoice.currency));

    sectionHeading("Line items");
    lineItems.forEach((item, index) => {
      const description = String(item?.description || item?.name || `Line item ${index + 1}`).trim();
      const quantity = Number(item?.quantity || 0);
      const unitAmount = Number(item?.unitAmount || item?.rate || 0);
        const amount = Number(item?.amount ?? item?.total ?? invoice.amount ?? 0);
      const suffix =
        quantity > 0 && unitAmount > 0
          ? ` (${quantity} × ${formatMoney(unitAmount, invoice.currency)})`
          : "";
      document.font("Helvetica-Bold").fontSize(11).fillColor("#111827").text(description);
      document.font("Helvetica").fontSize(10).fillColor("#475569").text(`${formatMoney(amount, invoice.currency)}${suffix}`);
      document.moveDown(0.3);
    });

    if (invoice.payments?.length) {
      sectionHeading("Payment history");
      invoice.payments.forEach((payment, index) => {
        const paymentDate = payment.recordedAt ? formatPdfDate(payment.recordedAt) : "Recorded date unavailable";
        const paymentMethod = payment.method ? formatStatusLabel(payment.method) : "Manual entry";
        document.font("Helvetica-Bold").fontSize(11).fillColor("#111827").text(
          `Payment ${index + 1} · ${formatMoney(payment.amount || 0, invoice.currency)}`
        );
        document.font("Helvetica").fontSize(10).fillColor("#475569").text(
          `${paymentDate} · ${paymentMethod}${payment.reference ? ` · Ref ${payment.reference}` : ""}`
        );
        if (payment.note) {
          document.text(payment.note);
        }
        document.moveDown(0.3);
      });
    }

    if (invoice.note) {
      sectionHeading("Note");
      document.font("Helvetica").fontSize(10).fillColor("#111827").text(invoice.note);
    }

    document.end();
    return undefined;
  } catch (error) {
    if (!res.headersSent) {
      return res.status(500).json({ message: "Unable to generate invoice PDF." });
    }

    return undefined;
  }
});

router.post("/invoices", requireFinanceStaff, async (req, res) => {
  try {
    const errors = validateInvoicePayload(req.body);
    if (errors.length) {
      return res.status(400).json({ message: errors[0], errors });
    }

    await assertPeriodsUnlocked(req, {
      dates: [new Date()],
      action: "invoice.create",
      itemType: "invoice",
      details: {
        invoiceNumber: String(req.body.invoiceNumber || "").trim().toUpperCase()
      }
    });

    const customer = await upsertFinanceCustomer(req.workspaceId, req.body);
    const counterpartyName = normalizeCounterpartyName(req.body.customerName, req.body.vendorName);
    const recurring = normalizeRecurringConfig(req.body.recurring);
    const taxValues = computeTaxValues(req.body.amount, req.body.taxRate || 0);
    const invoiceAmount = Number(taxValues.totalWithTax);
    const initialPaidAmount = Math.min(invoiceAmount, Math.max(0, Number(req.body.paidAmount || 0)));
    const initialPayments = initialPaidAmount > 0
      ? [
          {
            amount: Math.min(invoiceAmount, initialPaidAmount),
            recordedAt: new Date(),
            remainingBalance: Math.max(0, invoiceAmount - initialPaidAmount),
            recordedBy: req.user._id
          }
        ]
      : [];
    const invoice = await InvoiceRecord.create({
      workspaceId: req.workspaceId,
      invoiceNumber: String(req.body.invoiceNumber).trim().toUpperCase(),
      vendorName: counterpartyName,
      customerId: customer?._id || null,
      customerName: customer?.name || counterpartyName,
      customerEmail: customer?.email || String(req.body.customerEmail || "").trim().toLowerCase(),
      amount: invoiceAmount,
      subtotal: taxValues.subtotal,
      taxRate: taxValues.taxRate,
      taxAmount: taxValues.taxAmount,
      taxLabel: String(req.body.taxLabel || "Tax").trim().slice(0, 40) || "Tax",
      totalWithTax: taxValues.totalWithTax,
      currency: normalizeCurrencyCode(req.body.currency || req.workspace?.defaultCurrency || "USD"),
      dueDate: new Date(req.body.dueDate),
      status: req.body.status || "pending_review",
      paidAmount: initialPaidAmount,
      paidAt: initialPaidAmount > 0 ? new Date() : null,
      paidBy: initialPaidAmount > 0 ? req.user._id : null,
      payments: initialPayments,
      note: typeof req.body.note === "string" ? req.body.note.trim() : "",
      threadKey: "financebot",
      createdBy: req.user._id,
      attachments: Array.isArray(req.body.attachments) ? req.body.attachments : [],
      recurring
    });

    await syncInvoiceAccountingIfEnabled(req, invoice, req.user._id);

    await createFinanceAction({
      workspaceId: req.workspaceId,
      itemType: "invoice",
      itemId: invoice._id,
      action: "created",
      performedBy: req.user._id,
      metadata: {
        invoiceNumber: invoice.invoiceNumber,
        customerName: invoice.customerName || invoice.vendorName,
        amount: invoice.amount
      }
    });

    await writeAuditLog({
      actor: req.user._id,
      action: "finance.invoice.create",
      targetId: invoice._id.toString(),
      targetType: "InvoiceRecord",
      metadata: {
        invoiceNumber: invoice.invoiceNumber,
        customerName: invoice.customerName || invoice.vendorName,
        amount: invoice.amount
      }
    });

    const populated = await populateInvoiceRelations(
      InvoiceRecord.findOne({ _id: invoice._id, workspaceId: req.workspaceId })
    );
    return res.status(201).json(serializeInvoice(populated));
  } catch (error) {
    if (error instanceof FinancePeriodLockError) {
      return res.status(409).json({ message: error.message, details: error.details });
    }

    if (error?.code === 11000) {
      return res.status(409).json({ message: "An invoice with that number already exists." });
    }

    return res.status(500).json({ message: "Unable to create invoice." });
  }
});

router.patch("/invoices/:id", requireFinanceStaff, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid invoice id." });
    }

    const errors = validateInvoicePayload(req.body, { partial: true });
    if (errors.length) {
      return res.status(400).json({ message: errors[0], errors });
    }

    const updates = {};
    if (req.body.invoiceNumber !== undefined) updates.invoiceNumber = String(req.body.invoiceNumber).trim().toUpperCase();
    if (req.body.vendorName !== undefined || req.body.customerName !== undefined) {
      const customer = await upsertFinanceCustomer(req.workspaceId, req.body);
      const counterpartyName = normalizeCounterpartyName(req.body.customerName, req.body.vendorName);
      updates.vendorName = customer?.name || counterpartyName;
      updates.customerId = customer?._id || null;
      updates.customerName = customer?.name || counterpartyName;
    }
    if (req.body.customerEmail !== undefined) updates.customerEmail = String(req.body.customerEmail || "").trim().toLowerCase();
    if (req.body.amount !== undefined) updates.amount = Number(req.body.amount);
    if (req.body.currency !== undefined) updates.currency = normalizeCurrencyCode(req.body.currency);
    if (req.body.dueDate !== undefined) updates.dueDate = new Date(req.body.dueDate);
    if (req.body.note !== undefined) updates.note = String(req.body.note || "").trim();
    if (req.body.taxRate !== undefined) updates.taxRate = Number(req.body.taxRate || 0);
    if (req.body.taxLabel !== undefined) updates.taxLabel = String(req.body.taxLabel || "Tax").trim().slice(0, 40) || "Tax";
    // Status and payment changes must go through dedicated workflow or payment routes only.
    if (req.body.attachments !== undefined) updates.attachments = Array.isArray(req.body.attachments) ? req.body.attachments : [];
    if (req.body.recurring !== undefined) updates.recurring = normalizeRecurringConfig(req.body.recurring);

    const existingInvoice = await InvoiceRecord.findOne(buildScopedWorkspaceFilter(req, { _id: req.params.id }));
    if (!existingInvoice) {
      return res.status(404).json({ message: "Invoice not found." });
    }

    const materialUpdate = isInvoiceMaterialUpdate(updates);
    if (materialUpdate) {
      await assertPeriodsUnlocked(req, {
        dates: [existingInvoice.createdAt],
        action: "invoice.update",
        itemType: "invoice",
        itemId: existingInvoice._id,
        details: {
          invoiceNumber: existingInvoice.invoiceNumber,
          updatedFields: Object.keys(updates)
        }
      });
    }

    const nextSubtotal = updates.amount !== undefined
      ? Number(updates.amount)
      : Number(existingInvoice.subtotal || existingInvoice.amount || 0);
    const nextTaxRate = updates.taxRate !== undefined
      ? Number(updates.taxRate)
      : Number(existingInvoice.taxRate || 0);
    const nextTaxValues = computeTaxValues(nextSubtotal, nextTaxRate);
    updates.subtotal = nextTaxValues.subtotal;
    updates.taxRate = nextTaxValues.taxRate;
    updates.taxAmount = nextTaxValues.taxAmount;
    updates.totalWithTax = nextTaxValues.totalWithTax;
    updates.amount = nextTaxValues.totalWithTax;
    if (updates.taxLabel === undefined) {
      updates.taxLabel = existingInvoice.taxLabel || "Tax";
    }

    const invoice = await populateInvoiceRelations(
      InvoiceRecord.findOneAndUpdate(
      buildScopedWorkspaceFilter(req, { _id: req.params.id }),
      { $set: { ...updates, workspaceId: req.workspaceId } },
      { new: true, runValidators: true }
    )
    );

    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found." });
    }

    if (materialUpdate) {
      await syncInvoiceAccountingIfEnabled(req, invoice, req.user._id);
    }

    await createFinanceAction({
      workspaceId: req.workspaceId,
      itemType: "invoice",
      itemId: invoice._id,
      action: updates.note !== undefined ? "note_added" : "updated",
      performedBy: req.user._id,
      metadata: { updatedFields: Object.keys(updates) }
    });

    await writeAuditLog({
      actor: req.user._id,
      action: "finance.invoice.update",
      targetId: invoice._id.toString(),
      targetType: "InvoiceRecord",
      metadata: buildFinanceAuditPayload(req, {
        invoiceNumber: invoice.invoiceNumber,
        updatedFields: Object.keys(updates)
      })
    });

    return res.json(serializeInvoice(invoice));
  } catch (error) {
    if (error instanceof FinancePeriodLockError) {
      return res.status(409).json({ message: error.message, details: error.details });
    }

    if (error?.code === 11000) {
      return res.status(409).json({ message: "An invoice with that number already exists in this workspace." });
    }

    return res.status(500).json({ message: "Unable to update invoice." });
  }
});

router.patch("/invoices/:id/approve", requireFinanceApprover, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid invoice id." });
    }

    const existingInvoice = await InvoiceRecord.findOne(buildScopedWorkspaceFilter(req, { _id: req.params.id })).select(
      "_id invoiceNumber status createdAt"
    );
    if (!existingInvoice) {
      return res.status(404).json({ message: "Invoice not found." });
    }

    try {
      assertValidTransition(INVOICE_TRANSITIONS, existingInvoice.status, "approved", "invoice");
    } catch (transitionError) {
      return res.status(transitionError.statusCode || 400).json({ message: transitionError.message });
    }

    await assertPeriodsUnlocked(req, {
      dates: [existingInvoice.createdAt],
      action: "invoice.approve",
      itemType: "invoice",
      itemId: existingInvoice._id,
      details: {
        invoiceNumber: existingInvoice.invoiceNumber
      }
    });

    const invoice = await populateInvoiceRelations(
      InvoiceRecord.findOneAndUpdate(
      buildScopedWorkspaceFilter(req, { _id: req.params.id }),
      {
        $set: {
          workspaceId: req.workspaceId,
          status: "approved",
          approvedBy: req.user._id,
          rejectionReason: ""
        }
      },
      { new: true }
    )
    );

    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found." });
    }

    await syncInvoiceAccountingIfEnabled(req, invoice, req.user._id);

    await createFinanceAction({
      workspaceId: req.workspaceId,
      itemType: "invoice",
      itemId: invoice._id,
      action: "approved",
      performedBy: req.user._id,
      metadata: { invoiceNumber: invoice.invoiceNumber }
    });

    await writeAuditLog({
      actor: req.user._id,
      action: "finance.invoice.approve",
      targetId: invoice._id.toString(),
      targetType: "InvoiceRecord",
      metadata: buildFinanceAuditPayload(req, {
        invoiceNumber: invoice.invoiceNumber
      })
    });

    return res.json(serializeInvoice(invoice));
  } catch (error) {
    if (error instanceof FinancePeriodLockError) {
      return res.status(409).json({ message: error.message, details: error.details });
    }

    return res.status(500).json({ message: "Unable to approve invoice." });
  }
});

router.patch("/invoices/:id/reject", requireFinanceApprover, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid invoice id." });
    }

    const rejectionReason = String(req.body.rejectionReason || "").trim();
    if (!rejectionReason) {
      return res.status(400).json({ message: "Rejection reason is required." });
    }

    const existingInvoice = await InvoiceRecord.findOne(buildScopedWorkspaceFilter(req, { _id: req.params.id })).select(
      "_id invoiceNumber status createdAt"
    );
    if (!existingInvoice) {
      return res.status(404).json({ message: "Invoice not found." });
    }

    try {
      assertValidTransition(INVOICE_TRANSITIONS, existingInvoice.status, "rejected", "invoice");
    } catch (transitionError) {
      return res.status(transitionError.statusCode || 400).json({ message: transitionError.message });
    }

    await assertPeriodsUnlocked(req, {
      dates: [existingInvoice.createdAt],
      action: "invoice.reject",
      itemType: "invoice",
      itemId: existingInvoice._id,
      details: {
        invoiceNumber: existingInvoice.invoiceNumber
      }
    });

    const invoice = await populateInvoiceRelations(
      InvoiceRecord.findOneAndUpdate(
      buildScopedWorkspaceFilter(req, { _id: req.params.id }),
      {
        $set: {
          workspaceId: req.workspaceId,
          status: "rejected",
          rejectedBy: req.user._id,
          rejectionReason
        }
      },
      { new: true }
    )
    );

    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found." });
    }

    await syncInvoiceAccountingIfEnabled(req, invoice, req.user._id);

    await createFinanceAction({
      workspaceId: req.workspaceId,
      itemType: "invoice",
      itemId: invoice._id,
      action: "rejected",
      performedBy: req.user._id,
      metadata: { rejectionReason }
    });

    await writeAuditLog({
      actor: req.user._id,
      action: "finance.invoice.reject",
      targetId: invoice._id.toString(),
      targetType: "InvoiceRecord",
      metadata: buildFinanceAuditPayload(req, {
        invoiceNumber: invoice.invoiceNumber,
        rejectionReason
      })
    });

    return res.json(serializeInvoice(invoice));
  } catch (error) {
    if (error instanceof FinancePeriodLockError) {
      return res.status(409).json({ message: error.message, details: error.details });
    }

    return res.status(500).json({ message: "Unable to reject invoice." });
  }
});

router.patch("/invoices/:id/paid", requireFinanceStaff, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: "Invalid invoice id." });
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    let session = null;
    try {
      session = await mongoose.startSession();
      let updatedInvoiceId = null;
      let paymentEntry = null;
      let appliedPaidAmount = 0;

      await session.withTransaction(async () => {
        const existingInvoice = await InvoiceRecord.findOne(buildScopedWorkspaceFilter(req, { _id: req.params.id })).session(session);
        if (!existingInvoice) {
          throw createHttpError(404, "Invoice not found.");
        }

        const invoiceAmountCents = toCents(existingInvoice.amount || 0);
        const existingPaidAmount = Number(existingInvoice.paidAmount || 0);
        const existingPaidAmountCents = toCents(existingPaidAmount);
        const remainingAmountCents = Math.max(0, invoiceAmountCents - existingPaidAmountCents);

        if (remainingAmountCents <= 0 || STATUS_GROUPS.settled.includes(existingInvoice.status)) {
          throw createHttpError(409, "Invoice already settled");
        }

        const requestedPaidAmount = req.body.paidAmount === undefined
          ? fromCents(remainingAmountCents)
          : Number(req.body.paidAmount);

        if (!Number.isFinite(requestedPaidAmount) || requestedPaidAmount <= 0) {
          throw createHttpError(400, "Amount must be greater than zero");
        }

        const requestedPaidAmountCents = toCents(requestedPaidAmount);
        if (requestedPaidAmountCents > remainingAmountCents) {
          throw createHttpError(400, "Payment exceeds outstanding balance");
        }
        const appliedPaidAmountCents = requestedPaidAmountCents;

        const nextPaidAmountCents = existingPaidAmountCents + appliedPaidAmountCents;
        const nextPaidAmount = fromCents(nextPaidAmountCents);
        const nextStatus = nextPaidAmountCents >= invoiceAmountCents ? "paid" : "partial";
        const paymentRecordedAt = new Date();
        const remainingBalance = fromCents(Math.max(0, invoiceAmountCents - nextPaidAmountCents));

        assertValidTransition(INVOICE_TRANSITIONS, existingInvoice.status, nextStatus, "invoice");

        paymentEntry = {
          amount: fromCents(appliedPaidAmountCents),
          recordedAt: paymentRecordedAt,
          remainingBalance,
          method: String(req.body.method || "").trim().slice(0, 40),
          reference: String(req.body.reference || "").trim().slice(0, 120),
          note: String(req.body.note || "").trim().slice(0, 500),
          recordedBy: req.user._id
        };

        await assertPeriodsUnlocked(req, {
          dates: [paymentRecordedAt],
          action: "invoice.payment",
          itemType: "invoice",
          itemId: existingInvoice._id,
          details: {
            invoiceNumber: existingInvoice.invoiceNumber,
            paymentAmount: paymentEntry.amount
          }
        });

        const invoice = await InvoiceRecord.findOneAndUpdate(
          buildScopedWorkspaceFilter(req, {
            _id: req.params.id,
            paidAmount: existingPaidAmount
          }),
          {
            $set: {
              workspaceId: req.workspaceId,
              status: nextStatus,
              paidAmount: nextPaidAmount,
              paidAt: paymentRecordedAt,
              paidBy: req.user._id
            },
            $push: {
              payments: paymentEntry
            }
          },
          { new: true, session }
        );

        if (!invoice) {
          throw createRetryableInvoicePaymentConflict();
        }

        updatedInvoiceId = invoice._id;
        appliedPaidAmount = paymentEntry.amount;
      });

      if (!updatedInvoiceId) {
        throw createRetryableInvoicePaymentConflict();
      }

      const invoice = await populateInvoiceRelations(
        InvoiceRecord.findOne(buildScopedWorkspaceFilter(req, { _id: updatedInvoiceId }))
      );
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found." });
      }

      await syncInvoiceAccountingIfEnabled(req, invoice, req.user._id);

      await createFinanceAction({
        workspaceId: req.workspaceId,
        itemType: "invoice",
        itemId: invoice._id,
        action: "paid",
        performedBy: req.user._id,
        metadata: {
          invoiceNumber: invoice.invoiceNumber,
          paidAmount: appliedPaidAmount,
          totalPaidAmount: invoice.paidAmount,
          paymentStatus: invoice.status,
          paymentMethod: paymentEntry.method,
          paymentReference: paymentEntry.reference
        }
      });

      await writeAuditLog({
        actor: req.user._id,
        action: "finance.invoice.payment.record",
        targetId: invoice._id.toString(),
        targetType: "InvoiceRecord",
        metadata: buildFinanceAuditPayload(req, {
          invoiceNumber: invoice.invoiceNumber,
          paidAmount: appliedPaidAmount,
          paymentMethod: paymentEntry.method,
          paymentReference: paymentEntry.reference
        })
      });

      return res.json(serializeInvoice(invoice));
    } catch (error) {
      if (
        error?.retryableInvoicePaymentConflict ||
        error?.errorLabels?.includes?.("TransientTransactionError") ||
        error?.errorLabels?.includes?.("UnknownTransactionCommitResult")
      ) {
        if (attempt < 9) {
          await delay(10 * (attempt + 1));
          continue;
        }
      }

      if (error?.isPublic) {
        return res.status(error.statusCode || 400).json({ message: error.message });
      }

      if (error instanceof FinancePeriodLockError) {
        return res.status(423).json({ message: error.message, details: error.details });
      }

      return res.status(500).json({ message: "Unable to mark invoice as paid." });
    } finally {
      if (session) {
        await session.endSession();
      }
    }
  }

  return res.status(409).json({ message: "Invoice payment conflicted with another update. Please refresh and try again." });
});

router.post("/invoices/:id/issue-next", requireFinanceStaff, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid invoice id." });
    }

    const sourceInvoice = await InvoiceRecord.findOne(
      buildScopedWorkspaceFilter(req, { _id: req.params.id })
    );

    if (!sourceInvoice) {
      return res.status(404).json({ message: "Recurring invoice not found." });
    }

    if (!sourceInvoice.recurring?.enabled) {
      return res.status(400).json({ message: "This invoice is not configured as recurring." });
    }

    if (!isRecurringInvoiceDue(sourceInvoice.recurring)) {
      return res.status(400).json({ message: "This recurring invoice is not due yet." });
    }

    const issuedAt = new Date(sourceInvoice.recurring.nextIssueDate || Date.now());
    await assertPeriodsUnlocked(req, {
      dates: [issuedAt],
      action: "invoice.recurring_issue",
      itemType: "invoice",
      itemId: sourceInvoice._id,
      details: {
        invoiceNumber: sourceInvoice.invoiceNumber
      }
    });

    const dueDate = deriveRecurringDueDate(sourceInvoice, issuedAt);
    let nextSequence = await InvoiceRecord.countDocuments(
      buildScopedWorkspaceFilter(req, { recurringSourceInvoiceId: sourceInvoice._id })
    ) + 1;

    let nextInvoiceNumber = buildRecurringInvoiceNumber(sourceInvoice.invoiceNumber, nextSequence);
    while (await InvoiceRecord.exists(buildScopedWorkspaceFilter(req, { invoiceNumber: nextInvoiceNumber }))) {
      nextSequence += 1;
      nextInvoiceNumber = buildRecurringInvoiceNumber(sourceInvoice.invoiceNumber, nextSequence);
    }

    const createdInvoice = await InvoiceRecord.create({
      workspaceId: req.workspaceId,
      invoiceNumber: nextInvoiceNumber,
      vendorName: sourceInvoice.vendorName,
      customerId: sourceInvoice.customerId || null,
      customerName: sourceInvoice.customerName || sourceInvoice.vendorName,
      customerEmail: sourceInvoice.customerEmail || "",
      amount: Number(sourceInvoice.amount || 0),
      subtotal: Number(sourceInvoice.subtotal || sourceInvoice.amount || 0),
      taxRate: Number(sourceInvoice.taxRate || 0),
      taxAmount: Number(sourceInvoice.taxAmount || 0),
      taxLabel: sourceInvoice.taxLabel || "Tax",
      totalWithTax: Number(sourceInvoice.totalWithTax || sourceInvoice.amount || 0),
      currency: sourceInvoice.currency || "USD",
      dueDate,
      status: "pending_review",
      paidAmount: 0,
      note: sourceInvoice.note || "",
      threadKey: sourceInvoice.threadKey || "financebot",
      createdBy: req.user._id,
      attachments: sourceInvoice.attachments || [],
      recurring: {
        enabled: false,
        frequency: sourceInvoice.recurring.frequency || "monthly",
        interval: sourceInvoice.recurring.interval || 1,
        nextIssueDate: null,
        lastIssuedAt: null
      },
      recurringSourceInvoiceId: sourceInvoice._id,
      recurringSequence: nextSequence
    });

    sourceInvoice.recurring.lastIssuedAt = issuedAt;
    sourceInvoice.recurring.nextIssueDate = addRecurringInterval(
      issuedAt,
      sourceInvoice.recurring.frequency,
      sourceInvoice.recurring.interval
    );
    await sourceInvoice.save();

    await createFinanceAction({
      workspaceId: req.workspaceId,
      itemType: "invoice",
      itemId: createdInvoice._id,
      action: "created",
      performedBy: req.user._id,
      metadata: {
        invoiceNumber: createdInvoice.invoiceNumber,
        customerName: createdInvoice.customerName || createdInvoice.vendorName,
        amount: createdInvoice.amount,
        sourceInvoiceNumber: sourceInvoice.invoiceNumber,
        recurringGenerated: true
      }
    });

    await createFinanceAction({
      workspaceId: req.workspaceId,
      itemType: "invoice",
      itemId: sourceInvoice._id,
      action: "recurring_issued",
      performedBy: req.user._id,
      metadata: {
        invoiceNumber: sourceInvoice.invoiceNumber,
        generatedInvoiceNumber: createdInvoice.invoiceNumber,
        nextIssueDate: sourceInvoice.recurring.nextIssueDate
      }
    });

    const [populatedSourceInvoice, populatedCreatedInvoice] = await Promise.all([
      populateInvoiceRelations(InvoiceRecord.findOne({ _id: sourceInvoice._id, workspaceId: req.workspaceId })),
      populateInvoiceRelations(InvoiceRecord.findOne({ _id: createdInvoice._id, workspaceId: req.workspaceId }))
    ]);

    await writeAuditLog({
      actor: req.user._id,
      action: "finance.invoice.recurring.issue",
      targetId: createdInvoice._id.toString(),
      targetType: "InvoiceRecord",
      metadata: buildFinanceAuditPayload(req, {
        invoiceNumber: createdInvoice.invoiceNumber,
        sourceInvoiceNumber: sourceInvoice.invoiceNumber
      })
    });

    return res.status(201).json({
      sourceInvoice: serializeInvoice(populatedSourceInvoice),
      createdInvoice: serializeInvoice(populatedCreatedInvoice)
    });
  } catch (error) {
    if (error instanceof FinancePeriodLockError) {
      return res.status(409).json({ message: error.message, details: error.details });
    }

    if (error?.code === 11000) {
      return res.status(409).json({ message: "A recurring invoice with that number already exists." });
    }

    return res.status(500).json({ message: "Unable to issue the next recurring invoice." });
  }
});

router.patch("/invoices/:id/reconcile", requireFinanceStaff, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid invoice id." });
    }

    const existingInvoice = await InvoiceRecord.findOne(buildScopedWorkspaceFilter(req, { _id: req.params.id })).select(
      "_id invoiceNumber status createdAt"
    );
    if (!existingInvoice) {
      return res.status(404).json({ message: "Invoice not found." });
    }

    try {
      assertValidTransition(INVOICE_TRANSITIONS, existingInvoice.status, "reconciled", "invoice");
    } catch (transitionError) {
      return res.status(transitionError.statusCode || 400).json({ message: transitionError.message });
    }

    await assertPeriodsUnlocked(req, {
      dates: [existingInvoice.createdAt],
      action: "invoice.reconcile",
      itemType: "invoice",
      itemId: existingInvoice._id,
      details: {
        invoiceNumber: existingInvoice.invoiceNumber
      }
    });

    const invoice = await populateInvoiceRelations(
      InvoiceRecord.findOneAndUpdate(
      buildScopedWorkspaceFilter(req, { _id: req.params.id }),
      {
        $set: {
          workspaceId: req.workspaceId,
          status: "reconciled",
          reconciledBy: req.user._id
        }
      },
      { new: true }
    )
    );

    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found." });
    }

    await syncInvoiceAccountingIfEnabled(req, invoice, req.user._id);

    await createFinanceAction({
      workspaceId: req.workspaceId,
      itemType: "invoice",
      itemId: invoice._id,
      action: "reconciled",
      performedBy: req.user._id,
      metadata: { invoiceNumber: invoice.invoiceNumber }
    });

    await writeAuditLog({
      actor: req.user._id,
      action: "finance.invoice.reconcile",
      targetId: invoice._id.toString(),
      targetType: "InvoiceRecord",
      metadata: buildFinanceAuditPayload(req, {
        invoiceNumber: invoice.invoiceNumber
      })
    });

    return res.json(serializeInvoice(invoice));
  } catch (error) {
    if (error instanceof FinancePeriodLockError) {
      return res.status(409).json({ message: error.message, details: error.details });
    }

    return res.status(500).json({ message: "Unable to reconcile invoice." });
  }
});

router.get("/expenses", async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) {
      const requestedStatus = String(req.query.status);
      if (requestedStatus === "pending_review" || requestedStatus === "submitted") {
        filter.status = { $in: ["pending_review", "submitted"] };
      } else {
        filter.status = requestedStatus;
      }
    }
    if (req.query.vendorId && mongoose.isValidObjectId(req.query.vendorId)) {
      filter.vendorId = req.query.vendorId;
    }
    if (req.query.category) {
      filter.category = String(req.query.category);
    }

    const expenses = await ExpenseRecord.find(buildScopedWorkspaceFilter(req, filter))
      .sort({ expenseDate: -1, createdAt: -1 })
      .populate("createdBy approvedBy rejectedBy reimbursedBy reconciledBy", "name email")
      .populate("vendorId", "name email");

    return res.json(expenses.map(serializeExpense));
  } catch (error) {
    return res.status(500).json({ message: "Unable to load expenses." });
  }
});

router.get("/members", requireFinanceManager, async (_req, res) => {
  try {
    const memberships = await WorkspaceMembership.find({
      workspaceId: _req.workspaceId,
      status: { $ne: "suspended" }
    })
      .sort({ createdAt: 1 })
      .populate("userId", "name email isAdmin presenceStatus lastActiveAt");

    return res.json(
      memberships.map((membership) => serializeFinanceMember(membership, membership.userId))
    );
  } catch (error) {
    return res.status(500).json({ message: "Unable to load finance members." });
  }
});

router.patch("/members/:id/roles", requireFinanceManager, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid user id." });
    }

    const workspaceRoles = Array.isArray(req.body.workspaceRoles)
      ? [...new Set(req.body.workspaceRoles.map((role) => String(role).trim()))]
      : [];
    const allowedRoles = ["viewer", "approver", "finance_staff", "accountant"];
    const invalidRole = workspaceRoles.find((role) => !allowedRoles.includes(role));
    if (invalidRole) {
      return res.status(400).json({ message: `Invalid finance role: ${invalidRole}` });
    }

    const membership = await WorkspaceMembership.findOne({
      workspaceId: req.workspaceId,
      userId: req.params.id,
      status: { $ne: "suspended" }
    }).populate("userId", "name email isAdmin presenceStatus lastActiveAt");

    if (!membership) {
      return res.status(404).json({ message: "Workspace membership not found." });
    }

    const nextModules = new Set(Array.isArray(membership.modules) ? membership.modules : []);

    if (workspaceRoles.length > 0) {
      nextModules.add("finance");
    } else {
      nextModules.delete("finance");
    }

    membership.financeRoles = workspaceRoles;
    membership.modules = [...nextModules];
    membership.status = "active";
    await membership.save();

    await writeAuditLog({
      actor: req.user._id,
      action: "finance.member.roles.update",
      targetId: membership.userId?._id?.toString?.() || membership.userId.toString(),
      targetType: "WorkspaceMembership",
      metadata: {
        workspaceId: req.workspaceId?.toString?.() || null,
        email: membership.email,
        workspaceRoles,
        workspaceModules: membership.modules
      }
    });

    return res.json(serializeFinanceMember(membership, membership.userId));
  } catch (error) {
    return res.status(500).json({ message: "Unable to update finance member roles." });
  }
});

router.patch("/members/:id/access", requireSystemAdmin, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid user id." });
    }

    const targetUser = await User.findById(req.params.id).select("name email isAdmin presenceStatus lastActiveAt");
    if (!targetUser) {
      return res.status(404).json({ message: "User not found." });
    }

    const allowedWorkspaceRoles = ["owner", "manager", "member"];
    const allowedModules = ["finance", "warehouse"];
    const allowedFinanceRoles = ["viewer", "approver", "finance_staff", "accountant"];

    const nextWorkspaceEnabled =
      req.body.workspaceEnabled === undefined ? undefined : req.body.workspaceEnabled;
    if (nextWorkspaceEnabled !== undefined && typeof nextWorkspaceEnabled !== "boolean") {
      return res.status(400).json({ message: "Workspace access flag must be true or false." });
    }

    let nextWorkspaceRole;
    if (req.body.workspaceRole !== undefined) {
      nextWorkspaceRole = req.body.workspaceRole === null ? null : String(req.body.workspaceRole).trim();
      if (nextWorkspaceRole && !allowedWorkspaceRoles.includes(nextWorkspaceRole)) {
        return res.status(400).json({ message: `Invalid workspace role: ${nextWorkspaceRole}` });
      }
    }

    let nextModules;
    if (req.body.workspaceModules !== undefined) {
      if (!Array.isArray(req.body.workspaceModules)) {
        return res.status(400).json({ message: "Workspace modules must be an array." });
      }

      nextModules = [...new Set(req.body.workspaceModules.map((module) => String(module).trim()))];
      const invalidModule = nextModules.find((module) => !allowedModules.includes(module));
      if (invalidModule) {
        return res.status(400).json({ message: `Invalid workspace module: ${invalidModule}` });
      }
    }

    let nextFinanceRoles;
    if (req.body.workspaceRoles !== undefined) {
      if (!Array.isArray(req.body.workspaceRoles)) {
        return res.status(400).json({ message: "Finance roles must be an array." });
      }

      nextFinanceRoles = [...new Set(req.body.workspaceRoles.map((role) => String(role).trim()))];
      const invalidFinanceRole = nextFinanceRoles.find((role) => !allowedFinanceRoles.includes(role));
      if (invalidFinanceRole) {
        return res.status(400).json({ message: `Invalid finance role: ${invalidFinanceRole}` });
      }
    }

    let membership = await WorkspaceMembership.findOne({
      workspaceId: req.workspaceId,
      userId: targetUser._id
    });

    if (!membership && nextWorkspaceEnabled === false) {
      return res.status(404).json({ message: "Workspace membership not found." });
    }

    if (!membership) {
      membership = await WorkspaceMembership.create({
        workspaceId: req.workspaceId,
        userId: targetUser._id,
        email: targetUser.email,
        workspaceRole: nextWorkspaceRole || "member",
        financeRoles: nextFinanceRoles || [],
        modules: nextModules || [],
        status: "active",
        invitedBy: req.user._id
      });
    } else {
      if (nextWorkspaceRole !== undefined) {
        membership.workspaceRole = nextWorkspaceRole || "member";
      }
      if (nextModules !== undefined) {
        membership.modules = nextModules;
      }
      if (nextFinanceRoles !== undefined) {
        membership.financeRoles = nextFinanceRoles;
      }
      if (nextWorkspaceEnabled !== undefined) {
        membership.status = nextWorkspaceEnabled ? "active" : "suspended";
      }

      await membership.save();
    }

    await membership.populate("userId", "name email isAdmin presenceStatus lastActiveAt");

    await writeAuditLog({
      actor: req.user._id,
      action: "finance.member.access.update",
      targetId: targetUser._id.toString(),
      targetType: "WorkspaceMembership",
      metadata: {
        email: targetUser.email,
        workspaceId: req.workspaceId?.toString?.() || null,
        workspaceEnabled: membership.status !== "suspended",
        workspaceRole: membership.workspaceRole || null,
        workspaceModules: membership.modules || [],
        workspaceRoles: membership.financeRoles || []
      }
    });

    return res.json(serializeFinanceMember(membership, membership.userId));
  } catch (error) {
    return res.status(500).json({ message: "Unable to update workspace access." });
  }
});

router.get("/expenses/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid expense id." });
    }

    const expense = await ExpenseRecord.findOne(buildScopedWorkspaceFilter(req, { _id: req.params.id }))
      .populate("createdBy approvedBy rejectedBy reimbursedBy reconciledBy", "name email")
      .populate("vendorId", "name email");

    if (!expense) {
      return res.status(404).json({ message: "Expense not found." });
    }

    const accountingEnabled = isAccountingEnabledForWorkspace(req.workspace);
    const actions = await loadRecentFinanceActions(req, "expense", expense._id, 10);

    return res.json({
      ...serializeExpense(expense),
      accountingEnabled,
      accountingJournalRefs: accountingEnabled
        ? {
            expenseEntryId: expense.accounting?.expenseEntryId?.toString?.() || null,
            expenseEntryStatus: expense.accounting?.expenseEntryStatus || "unposted",
            settlementEntryId: expense.accounting?.settlementEntryId?.toString?.() || null,
            settlementEntryStatus: expense.accounting?.settlementEntryStatus || "unposted"
          }
        : null,
      actionLog: actions.map(serializeAction)
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load expense detail." });
  }
});

router.post("/expenses", requireFinanceStaff, async (req, res) => {
  try {
    const errors = validateExpensePayload(req.body);
    if (errors.length) {
      return res.status(400).json({ message: errors[0], errors });
    }

    const expenseDate = req.body.expenseDate ? new Date(req.body.expenseDate) : new Date();
    await assertPeriodsUnlocked(req, {
      dates: [expenseDate],
      action: "expense.create",
      itemType: "expense",
      details: {
        category: req.body.category || "other",
        amount: Number(req.body.amount || 0)
      }
    });

    const vendor = await upsertFinanceVendor(req.workspaceId, req.body);
    const expenseTaxValues = computeTaxValues(req.body.amount, req.body.taxRate || 0);
    const expense = await ExpenseRecord.create({
      workspaceId: req.workspaceId,
      amount: expenseTaxValues.totalWithTax,
      taxRate: expenseTaxValues.taxRate,
      taxAmount: expenseTaxValues.taxAmount,
      taxLabel: String(req.body.taxLabel || "Tax").trim().slice(0, 40) || "Tax",
      totalWithTax: expenseTaxValues.totalWithTax,
      currency: normalizeCurrencyCode(req.body.currency || req.workspace?.defaultCurrency || "USD"),
      category: req.body.category || "other",
      vendorId: vendor?._id || null,
      vendorName: vendor?.name || (typeof req.body.vendorName === "string" ? req.body.vendorName.trim() : ""),
      vendorEmail: vendor?.email || String(req.body.vendorEmail || "").trim().toLowerCase(),
      expenseDate,
      note: typeof req.body.note === "string" ? req.body.note.trim() : "",
      status: req.body.status || "pending_review",
      createdBy: req.user._id,
      threadKey: "financebot",
      receipt: req.body.receipt || null
    });

    await syncExpenseAccountingIfEnabled(req, expense, req.user._id);

    await createFinanceAction({
      workspaceId: req.workspaceId,
      itemType: "expense",
      itemId: expense._id,
      action: expense.status === "draft" ? "created" : "submitted",
      performedBy: req.user._id,
      metadata: {
        category: expense.category,
        amount: expense.amount
      }
    });

    await writeAuditLog({
      actor: req.user._id,
      action: "finance.expense.create",
      targetId: expense._id.toString(),
      targetType: "ExpenseRecord",
      metadata: {
        category: expense.category,
        amount: expense.amount
      }
    });

    const populated = await ExpenseRecord.findOne({ _id: expense._id, workspaceId: req.workspaceId })
      .populate("createdBy approvedBy rejectedBy reimbursedBy reconciledBy", "name email")
      .populate("vendorId", "name email");
    return res.status(201).json(serializeExpense(populated));
  } catch (error) {
    if (error instanceof FinancePeriodLockError) {
      return res.status(409).json({ message: error.message, details: error.details });
    }

    return res.status(500).json({ message: "Unable to create expense." });
  }
});

router.patch("/expenses/:id", requireFinanceStaff, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid expense id." });
    }

    const errors = validateExpensePayload(req.body, { partial: true });
    if (errors.length) {
      return res.status(400).json({ message: errors[0], errors });
    }

    const updates = {};
    if (req.body.amount !== undefined) updates.amount = Number(req.body.amount);
    if (req.body.currency !== undefined) updates.currency = normalizeCurrencyCode(req.body.currency);
    if (req.body.category !== undefined) updates.category = req.body.category;
    if (req.body.vendorName !== undefined) {
      const vendor = await upsertFinanceVendor(req.workspaceId, req.body);
      updates.vendorId = vendor?._id || null;
      updates.vendorName = vendor?.name || String(req.body.vendorName || "").trim();
    }
    if (req.body.vendorEmail !== undefined) updates.vendorEmail = String(req.body.vendorEmail || "").trim().toLowerCase();
    if (req.body.expenseDate !== undefined) updates.expenseDate = new Date(req.body.expenseDate);
    if (req.body.note !== undefined) updates.note = String(req.body.note || "").trim();
    if (req.body.taxRate !== undefined) updates.taxRate = Number(req.body.taxRate || 0);
    if (req.body.taxLabel !== undefined) updates.taxLabel = String(req.body.taxLabel || "Tax").trim().slice(0, 40) || "Tax";
    if (req.body.receipt !== undefined) updates.receipt = req.body.receipt;

    const existingExpense = await ExpenseRecord.findOne(buildScopedWorkspaceFilter(req, { _id: req.params.id }));
    if (!existingExpense) {
      return res.status(404).json({ message: "Expense not found." });
    }

    const materialUpdate = isExpenseMaterialUpdate(updates);
    if (materialUpdate) {
      const lockDates = [existingExpense.expenseDate || existingExpense.createdAt];
      if (updates.status === "reimbursed" || updates.status === "reconciled") {
        lockDates.push(new Date());
      }

      await assertPeriodsUnlocked(req, {
        dates: lockDates,
        action: "expense.update",
        itemType: "expense",
        itemId: existingExpense._id,
        details: {
          category: existingExpense.category,
          updatedFields: Object.keys(updates)
        }
      });
    }

    const nextExpenseSubtotal = updates.amount !== undefined
      ? Number(updates.amount)
      : Number(existingExpense.totalWithTax || existingExpense.amount || 0) - Number(existingExpense.taxAmount || 0);
    const nextExpenseTaxRate = updates.taxRate !== undefined
      ? Number(updates.taxRate)
      : Number(existingExpense.taxRate || 0);
    const nextExpenseTaxValues = computeTaxValues(nextExpenseSubtotal, nextExpenseTaxRate);
    updates.taxRate = nextExpenseTaxValues.taxRate;
    updates.taxAmount = nextExpenseTaxValues.taxAmount;
    updates.totalWithTax = nextExpenseTaxValues.totalWithTax;
    updates.amount = nextExpenseTaxValues.totalWithTax;
    if (updates.taxLabel === undefined) {
      updates.taxLabel = existingExpense.taxLabel || "Tax";
    }

    const expense = await ExpenseRecord.findOneAndUpdate(
      buildScopedWorkspaceFilter(req, { _id: req.params.id }),
      { $set: { ...updates, workspaceId: req.workspaceId } },
      { new: true, runValidators: true }
    )
      .populate("createdBy approvedBy rejectedBy reimbursedBy reconciledBy", "name email")
      .populate("vendorId", "name email");

    if (!expense) {
      return res.status(404).json({ message: "Expense not found." });
    }

    if (materialUpdate) {
      await syncExpenseAccountingIfEnabled(req, expense, req.user._id);
    }

    await createFinanceAction({
      workspaceId: req.workspaceId,
      itemType: "expense",
      itemId: expense._id,
      action: updates.note !== undefined ? "note_added" : "updated",
      performedBy: req.user._id,
      metadata: { updatedFields: Object.keys(updates) }
    });

    await writeAuditLog({
      actor: req.user._id,
      action: "finance.expense.update",
      targetId: expense._id.toString(),
      targetType: "ExpenseRecord",
      metadata: buildFinanceAuditPayload(req, {
        category: expense.category,
        updatedFields: Object.keys(updates)
      })
    });

    return res.json(serializeExpense(expense));
  } catch (error) {
    if (error instanceof FinancePeriodLockError) {
      return res.status(409).json({ message: error.message, details: error.details });
    }

    return res.status(500).json({ message: "Unable to update expense." });
  }
});

router.patch("/expenses/:id/approve", requireFinanceManager, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid expense id." });
    }

    const existingExpense = await ExpenseRecord.findOne(buildScopedWorkspaceFilter(req, { _id: req.params.id })).select(
      "_id category amount status expenseDate createdAt"
    );
    if (!existingExpense) {
      return res.status(404).json({ message: "Expense not found." });
    }

    try {
      assertValidTransition(EXPENSE_TRANSITIONS, existingExpense.status, "approved", "expense");
    } catch (transitionError) {
      return res.status(transitionError.statusCode || 400).json({ message: transitionError.message });
    }

    await assertPeriodsUnlocked(req, {
      dates: [existingExpense.expenseDate || existingExpense.createdAt || new Date()],
      action: "expense.approve",
      itemType: "expense",
      itemId: existingExpense._id,
      details: {
        category: existingExpense.category,
        amount: Number(existingExpense.amount || 0)
      }
    });

    const expense = await ExpenseRecord.findOneAndUpdate(
      buildScopedWorkspaceFilter(req, { _id: req.params.id }),
      {
        $set: {
          workspaceId: req.workspaceId,
          status: "approved",
          approvedBy: req.user._id,
          approvedAt: new Date(),
          rejectedBy: null,
          rejectedAt: null,
          rejectionReason: ""
        }
      },
      { new: true }
    )
      .populate("createdBy approvedBy rejectedBy reimbursedBy reconciledBy", "name email")
      .populate("vendorId", "name email");

    if (!expense) {
      return res.status(404).json({ message: "Expense not found." });
    }

    await syncExpenseAccountingIfEnabled(req, expense, req.user._id);

    await createFinanceAction({
      workspaceId: req.workspaceId,
      itemType: "expense",
      itemId: expense._id,
      action: "approved",
      performedBy: req.user._id,
      metadata: { category: expense.category, amount: expense.amount }
    });

    await writeAuditLog({
      actor: req.user._id,
      action: "finance.expense.approve",
      targetId: expense._id.toString(),
      targetType: "ExpenseRecord",
      metadata: buildFinanceAuditPayload(req, {
        category: expense.category,
        amount: expense.amount
      })
    });

    return res.json(serializeExpense(expense));
  } catch (error) {
    if (error instanceof FinancePeriodLockError) {
      return res.status(409).json({ message: error.message, details: error.details });
    }

    return res.status(500).json({ message: "Unable to approve expense." });
  }
});

router.patch("/expenses/:id/reject", requireFinanceManager, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid expense id." });
    }

    const rejectionReason = String(req.body.reason || req.body.rejectionReason || "").trim();
    if (!rejectionReason) {
      return res.status(400).json({ message: "Rejection reason is required." });
    }

    const existingExpense = await ExpenseRecord.findOne(buildScopedWorkspaceFilter(req, { _id: req.params.id })).select(
      "_id category amount status expenseDate createdAt"
    );
    if (!existingExpense) {
      return res.status(404).json({ message: "Expense not found." });
    }

    try {
      assertValidTransition(EXPENSE_TRANSITIONS, existingExpense.status, "rejected", "expense");
    } catch (transitionError) {
      return res.status(transitionError.statusCode || 400).json({ message: transitionError.message });
    }

    await assertPeriodsUnlocked(req, {
      dates: [existingExpense.expenseDate || existingExpense.createdAt || new Date()],
      action: "expense.reject",
      itemType: "expense",
      itemId: existingExpense._id,
      details: {
        category: existingExpense.category,
        amount: Number(existingExpense.amount || 0)
      }
    });

    const expense = await ExpenseRecord.findOneAndUpdate(
      buildScopedWorkspaceFilter(req, { _id: req.params.id }),
      {
        $set: {
          workspaceId: req.workspaceId,
          status: "rejected",
          rejectedBy: req.user._id,
          rejectedAt: new Date(),
          rejectionReason
        }
      },
      { new: true }
    )
      .populate("createdBy approvedBy rejectedBy reimbursedBy reconciledBy", "name email")
      .populate("vendorId", "name email");

    if (!expense) {
      return res.status(404).json({ message: "Expense not found." });
    }

    await createFinanceAction({
      workspaceId: req.workspaceId,
      itemType: "expense",
      itemId: expense._id,
      action: "rejected",
      performedBy: req.user._id,
      metadata: { category: expense.category, amount: expense.amount, rejectionReason }
    });

    await writeAuditLog({
      actor: req.user._id,
      action: "finance.expense.reject",
      targetId: expense._id.toString(),
      targetType: "ExpenseRecord",
      metadata: buildFinanceAuditPayload(req, {
        category: expense.category,
        amount: expense.amount,
        rejectionReason
      })
    });

    return res.json(serializeExpense(expense));
  } catch (error) {
    if (error instanceof FinancePeriodLockError) {
      return res.status(409).json({ message: error.message, details: error.details });
    }

    return res.status(500).json({ message: "Unable to reject expense." });
  }
});

router.patch("/expenses/:id/reimburse", requireFinanceStaff, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid expense id." });
    }

    const reimbursement = {
      method: String(req.body.method || "").trim(),
      reference: String(req.body.reference || "").trim(),
      note: String(req.body.note || "").trim()
    };

    const existingExpense = await ExpenseRecord.findOne(buildScopedWorkspaceFilter(req, { _id: req.params.id })).select(
      "_id category amount status expenseDate createdAt"
    );
    if (!existingExpense) {
      return res.status(404).json({ message: "Expense not found." });
    }

    try {
      assertValidTransition(EXPENSE_TRANSITIONS, existingExpense.status, "reimbursed", "expense");
    } catch (transitionError) {
      return res.status(transitionError.statusCode || 400).json({ message: transitionError.message });
    }

    await assertPeriodsUnlocked(req, {
      dates: [existingExpense.expenseDate || existingExpense.createdAt || new Date(), new Date()],
      action: "expense.reimburse",
      itemType: "expense",
      itemId: existingExpense._id,
      details: {
        category: existingExpense.category,
        amount: Number(existingExpense.amount || 0)
      }
    });

    const expense = await ExpenseRecord.findOneAndUpdate(
      buildScopedWorkspaceFilter(req, { _id: req.params.id }),
      {
        $set: {
          workspaceId: req.workspaceId,
          status: "reimbursed",
          reimbursedBy: req.user._id,
          reimbursedAt: new Date(),
          reimbursement
        }
      },
      { new: true }
    )
      .populate("createdBy approvedBy rejectedBy reimbursedBy reconciledBy", "name email")
      .populate("vendorId", "name email");

    if (!expense) {
      return res.status(404).json({ message: "Expense not found." });
    }

    await syncExpenseAccountingIfEnabled(req, expense, req.user._id);

    await createFinanceAction({
      workspaceId: req.workspaceId,
      itemType: "expense",
      itemId: expense._id,
      action: "reimbursed",
      performedBy: req.user._id,
      metadata: {
        category: expense.category,
        amount: expense.amount,
        method: reimbursement.method,
        reference: reimbursement.reference
      }
    });

    await writeAuditLog({
      actor: req.user._id,
      action: "finance.expense.reimburse",
      targetId: expense._id.toString(),
      targetType: "ExpenseRecord",
      metadata: buildFinanceAuditPayload(req, {
        category: expense.category,
        amount: expense.amount,
        method: reimbursement.method,
        reference: reimbursement.reference
      })
    });

    return res.json(serializeExpense(expense));
  } catch (error) {
    if (error instanceof FinancePeriodLockError) {
      return res.status(409).json({ message: error.message, details: error.details });
    }

    return res.status(500).json({ message: "Unable to reimburse expense." });
  }
});

router.patch("/expenses/:id/reconcile", requireFinanceStaff, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid expense id." });
    }

    const existingExpense = await ExpenseRecord.findOne(buildScopedWorkspaceFilter(req, { _id: req.params.id })).select(
      "_id category amount status expenseDate"
    );
    if (!existingExpense) {
      return res.status(404).json({ message: "Expense not found." });
    }

    try {
      assertValidTransition(EXPENSE_TRANSITIONS, existingExpense.status, "reconciled", "expense");
    } catch (transitionError) {
      return res.status(transitionError.statusCode || 400).json({ message: transitionError.message });
    }

    await assertPeriodsUnlocked(req, {
      dates: [existingExpense.expenseDate || new Date(), new Date()],
      action: "expense.reconcile",
      itemType: "expense",
      itemId: existingExpense._id,
      details: {
        category: existingExpense.category,
        amount: Number(existingExpense.amount || 0)
      }
    });

    const expense = await ExpenseRecord.findOneAndUpdate(
      buildScopedWorkspaceFilter(req, { _id: req.params.id }),
      {
        $set: {
          workspaceId: req.workspaceId,
          status: "reconciled",
          reconciledBy: req.user._id
        }
      },
      { new: true }
    )
      .populate("createdBy approvedBy rejectedBy reimbursedBy reconciledBy", "name email")
      .populate("vendorId", "name email");

    if (!expense) {
      return res.status(404).json({ message: "Expense not found." });
    }

    await syncExpenseAccountingIfEnabled(req, expense, req.user._id);

    await createFinanceAction({
      workspaceId: req.workspaceId,
      itemType: "expense",
      itemId: expense._id,
      action: "reconciled",
      performedBy: req.user._id,
      metadata: { category: expense.category, amount: expense.amount }
    });

    await writeAuditLog({
      actor: req.user._id,
      action: "finance.expense.reconcile",
      targetId: expense._id.toString(),
      targetType: "ExpenseRecord",
      metadata: buildFinanceAuditPayload(req, {
        category: expense.category,
        amount: expense.amount
      })
    });

    return res.json(serializeExpense(expense));
  } catch (error) {
    if (error instanceof FinancePeriodLockError) {
      return res.status(409).json({ message: error.message, details: error.details });
    }

    return res.status(500).json({ message: "Unable to reconcile expense." });
  }
});

router.get("/activity", async (req, res) => {
  try {
    const limit = parseQueryInt(req.query.limit, 20, 1, 100);
    const actions = await FinanceActionLog.find(buildScopedWorkspaceFilter(req))
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("performedBy", "name email");

    return res.json(actions.map(serializeAction));
  } catch (error) {
    return res.status(500).json({ message: "Unable to load finance activity." });
  }
});

export default router;
