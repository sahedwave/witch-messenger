import { ChartOfAccount } from "../models/ChartOfAccount.js";
import { ExpenseRecord } from "../models/ExpenseRecord.js";
import { InvoiceRecord } from "../models/InvoiceRecord.js";
import { JournalEntry } from "../models/JournalEntry.js";

const DEFAULT_CHART = [
  {
    code: "1000",
    name: "Cash",
    type: "asset",
    subtype: "cash",
    normalBalance: "debit",
    description: "Cash and cash-equivalent balance for receipt and reimbursement postings."
  },
  {
    code: "1100",
    name: "Accounts Receivable",
    type: "asset",
    subtype: "accounts_receivable",
    normalBalance: "debit",
    description: "Open invoice balances expected from customers."
  },
  {
    code: "2000",
    name: "Accounts Payable",
    type: "liability",
    subtype: "accounts_payable",
    normalBalance: "credit",
    description: "Approved expenses awaiting reimbursement or settlement."
  },
  {
    code: "3000",
    name: "Owner Equity",
    type: "equity",
    subtype: "owner_equity",
    normalBalance: "credit",
    description: "Equity placeholder for future accounting expansion."
  },
  {
    code: "4000",
    name: "Sales Revenue",
    type: "income",
    subtype: "sales_revenue",
    normalBalance: "credit",
    description: "Primary revenue account for approved invoices."
  },
  {
    code: "5000",
    name: "Operating Expenses",
    type: "expense",
    subtype: "operating_expense",
    normalBalance: "debit",
    description: "Fallback operating expense account."
  },
  {
    code: "5100",
    name: "Travel Expense",
    type: "expense",
    subtype: "travel_expense",
    normalBalance: "debit",
    description: "Expense account for travel-related submissions."
  },
  {
    code: "5200",
    name: "Supplies Expense",
    type: "expense",
    subtype: "supplies_expense",
    normalBalance: "debit",
    description: "Expense account for office or inventory support supplies."
  },
  {
    code: "5300",
    name: "Salary Expense",
    type: "expense",
    subtype: "salary_expense",
    normalBalance: "debit",
    description: "Expense account for payroll-style reimbursements."
  },
  {
    code: "5400",
    name: "Marketing Expense",
    type: "expense",
    subtype: "marketing_expense",
    normalBalance: "debit",
    description: "Expense account for campaign and acquisition spend."
  },
  {
    code: "5500",
    name: "Utilities Expense",
    type: "expense",
    subtype: "utilities_expense",
    normalBalance: "debit",
    description: "Expense account for utilities and recurring operational bills."
  },
  {
    code: "5900",
    name: "Other Expense",
    type: "expense",
    subtype: "other_expense",
    normalBalance: "debit",
    description: "Catch-all expense account for uncategorized spend."
  }
];

const EXPENSE_CATEGORY_TO_SUBTYPE = {
  travel: "travel_expense",
  supplies: "supplies_expense",
  utilities: "utilities_expense",
  salary: "salary_expense",
  marketing: "marketing_expense",
  other: "other_expense"
};

function normalizeAmount(value) {
  return Number(Number(value || 0).toFixed(2));
}

function buildEntryNumber(entryType) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `JE-${entryType.replace("_", "").slice(0, 6).toUpperCase()}-${stamp}-${suffix}`;
}

function buildLine(account, { debit = 0, credit = 0, memo = "" }) {
  return {
    accountId: account._id,
    accountCode: account.code,
    accountName: account.name,
    accountType: account.type,
    debit: normalizeAmount(debit),
    credit: normalizeAmount(credit),
    memo: String(memo || "").trim().slice(0, 280)
  };
}

function validateBalancedLines(lines) {
  const totalDebit = normalizeAmount(lines.reduce((sum, line) => sum + Number(line.debit || 0), 0));
  const totalCredit = normalizeAmount(lines.reduce((sum, line) => sum + Number(line.credit || 0), 0));

  if (!lines.length || totalDebit <= 0 || totalCredit <= 0 || totalDebit !== totalCredit) {
    throw new Error("Accounting entry lines must be balanced.");
  }

  return { totalDebit, totalCredit };
}

function isInvoicePostable(status) {
  return ["approved", "partial", "paid", "overdue", "reconciled"].includes(String(status || ""));
}

function isExpensePostable(status) {
  return ["approved", "reimbursed", "reconciled"].includes(String(status || ""));
}

async function updateInvoiceAccountingState(invoiceId, updates = {}) {
  await InvoiceRecord.updateOne(
    { _id: invoiceId },
    {
      $set: {
        ...updates,
        "accounting.lastSyncedAt": new Date()
      }
    }
  );
}

async function updateExpenseAccountingState(expenseId, updates = {}) {
  await ExpenseRecord.updateOne(
    { _id: expenseId },
    {
      $set: {
        ...updates,
        "accounting.lastSyncedAt": new Date()
      }
    }
  );
}

export async function ensureWorkspaceChartOfAccounts(workspaceId) {
  await Promise.all(
    DEFAULT_CHART.map((account) =>
      ChartOfAccount.findOneAndUpdate(
        { workspaceId, code: account.code },
        {
          $setOnInsert: {
            workspaceId,
            ...account,
            status: "active",
            isSystem: true
          }
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true
        }
      )
    )
  );

  const accounts = await ChartOfAccount.find({ workspaceId, status: "active" }).sort({ code: 1 });
  const bySubtype = new Map(accounts.map((account) => [account.subtype, account]));
  return { accounts, bySubtype };
}

export function serializeChartOfAccount(account) {
  return {
    id: account._id.toString(),
    workspaceId: account.workspaceId?.toString?.() || null,
    code: account.code,
    name: account.name,
    type: account.type,
    subtype: account.subtype,
    normalBalance: account.normalBalance,
    status: account.status,
    isSystem: Boolean(account.isSystem),
    description: account.description || "",
    createdAt: account.createdAt,
    updatedAt: account.updatedAt
  };
}

export function serializeJournalEntry(entry) {
  return {
    id: entry._id.toString(),
    workspaceId: entry.workspaceId?.toString?.() || null,
    entryNumber: entry.entryNumber,
    entryType: entry.entryType,
    postingDate: entry.postingDate,
    status: entry.status,
    description: entry.description,
    sourceType: entry.sourceType,
    sourceId: entry.sourceId?.toString?.() || null,
    sourceSubId: entry.sourceSubId || null,
    totalDebit: Number(entry.totalDebit || 0),
    totalCredit: Number(entry.totalCredit || 0),
    lines: (entry.lines || []).map((line) => ({
      accountId: line.accountId?.toString?.() || null,
      accountCode: line.accountCode,
      accountName: line.accountName,
      accountType: line.accountType,
      debit: Number(line.debit || 0),
      credit: Number(line.credit || 0),
      memo: line.memo || ""
    })),
    metadata: entry.metadata || {},
    createdBy: entry.createdBy?._id?.toString?.() || entry.createdBy?.toString?.() || null,
    updatedBy: entry.updatedBy?._id?.toString?.() || entry.updatedBy?.toString?.() || null,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    voidedAt: entry.voidedAt || null
  };
}

async function upsertJournalEntry({
  workspaceId,
  sourceType,
  sourceId,
  sourceSubId = null,
  entryType,
  postingDate,
  description,
  lines,
  actorId,
  metadata = {}
}) {
  const { totalDebit, totalCredit } = validateBalancedLines(lines);
  const existingEntry = await JournalEntry.findOne({
    workspaceId,
    sourceType,
    sourceId,
    sourceSubId,
    entryType
  }).select("_id entryNumber");

  return JournalEntry.findOneAndUpdate(
    {
      workspaceId,
      sourceType,
      sourceId,
      sourceSubId,
      entryType
    },
    {
      $set: {
        postingDate,
        description,
        lines,
        totalDebit,
        totalCredit,
        status: "posted",
        metadata,
        updatedBy: actorId,
        voidedAt: null
      },
      $setOnInsert: {
        workspaceId,
        sourceType,
        sourceId,
        sourceSubId,
        entryType,
        entryNumber: existingEntry?.entryNumber || buildEntryNumber(entryType),
        createdBy: actorId
      }
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }
  );
}

async function voidJournalEntries(filter = {}, actorId = null) {
  return JournalEntry.updateMany(
    {
      ...filter,
      status: { $ne: "voided" }
    },
    {
      $set: {
        status: "voided",
        voidedAt: new Date(),
        updatedBy: actorId
      }
    }
  );
}

export async function syncInvoiceAccounting(invoice, actorId) {
  if (!invoice?.workspaceId || !invoice?._id) {
    return { revenueEntry: null, paymentEntries: [] };
  }

  const { bySubtype } = await ensureWorkspaceChartOfAccounts(invoice.workspaceId);
  const accountsReceivable = bySubtype.get("accounts_receivable");
  const cashAccount = bySubtype.get("cash");
  const salesRevenue = bySubtype.get("sales_revenue");

  const shouldPostRevenue = isInvoicePostable(invoice.status);
  let revenueEntry = null;

  if (shouldPostRevenue) {
    revenueEntry = await upsertJournalEntry({
      workspaceId: invoice.workspaceId,
      sourceType: "invoice",
      sourceId: invoice._id,
      entryType: "invoice_accrual",
      postingDate: invoice.createdAt || new Date(),
      description: `Invoice ${invoice.invoiceNumber} accrual`,
      actorId,
      metadata: {
        invoiceNumber: invoice.invoiceNumber,
        customerName: invoice.customerName || invoice.vendorName || "",
        amount: normalizeAmount(invoice.amount),
        currency: String(invoice.currency || "USD").trim().toUpperCase()
      },
      lines: [
        buildLine(accountsReceivable, { debit: invoice.amount, memo: `Invoice ${invoice.invoiceNumber}` }),
        buildLine(salesRevenue, { credit: invoice.amount, memo: `Invoice ${invoice.invoiceNumber}` })
      ]
    });
  } else {
    await voidJournalEntries(
      {
        workspaceId: invoice.workspaceId,
        sourceType: "invoice",
        sourceId: invoice._id,
        entryType: "invoice_accrual"
      },
      actorId
    );
  }

  const paymentEntries = [];
  const activePaymentIds = new Set();

  if (shouldPostRevenue && Array.isArray(invoice.payments)) {
    for (const payment of invoice.payments) {
      if (!payment?._id) {
        continue;
      }

      const paymentSourceId = payment._id.toString();
      activePaymentIds.add(paymentSourceId);
      const paymentEntry = await upsertJournalEntry({
        workspaceId: invoice.workspaceId,
        sourceType: "invoice",
        sourceId: invoice._id,
        sourceSubId: paymentSourceId,
        entryType: "invoice_payment",
        postingDate: payment.recordedAt || new Date(),
        description: `Invoice ${invoice.invoiceNumber} payment`,
        actorId,
        metadata: {
          invoiceNumber: invoice.invoiceNumber,
          amount: normalizeAmount(payment.amount),
          currency: String(invoice.currency || "USD").trim().toUpperCase(),
          method: payment.method || "",
          reference: payment.reference || ""
        },
        lines: [
          buildLine(cashAccount, { debit: payment.amount, memo: `Payment for ${invoice.invoiceNumber}` }),
          buildLine(accountsReceivable, { credit: payment.amount, memo: `Payment for ${invoice.invoiceNumber}` })
        ]
      });
      paymentEntries.push(paymentEntry);
    }
  }

  const existingPaymentEntries = await JournalEntry.find({
    workspaceId: invoice.workspaceId,
    sourceType: "invoice",
    sourceId: invoice._id,
    entryType: "invoice_payment"
  }).select("_id sourceSubId");

  const stalePaymentEntryIds = existingPaymentEntries
    .filter((entry) => entry.sourceSubId && !activePaymentIds.has(entry.sourceSubId))
    .map((entry) => entry._id);

  if (!shouldPostRevenue) {
    await voidJournalEntries(
      {
        workspaceId: invoice.workspaceId,
        sourceType: "invoice",
        sourceId: invoice._id,
        entryType: "invoice_payment"
      },
      actorId
    );
  } else if (stalePaymentEntryIds.length) {
    await voidJournalEntries({ _id: { $in: stalePaymentEntryIds } }, actorId);
  }

  await updateInvoiceAccountingState(invoice._id, {
    "accounting.revenueEntryId": revenueEntry?._id || null,
    "accounting.revenueEntryStatus": shouldPostRevenue ? "posted" : "voided",
    "accounting.paymentEntryIds": paymentEntries.map((entry) => entry._id),
    "accounting.paymentPostedCount": paymentEntries.length
  });

  return { revenueEntry, paymentEntries };
}

export async function syncExpenseAccounting(expense, actorId) {
  if (!expense?.workspaceId || !expense?._id) {
    return { accrualEntry: null, settlementEntry: null };
  }

  const { bySubtype } = await ensureWorkspaceChartOfAccounts(expense.workspaceId);
  const accountsPayable = bySubtype.get("accounts_payable");
  const cashAccount = bySubtype.get("cash");
  const expenseAccount = bySubtype.get(EXPENSE_CATEGORY_TO_SUBTYPE[expense.category] || "other_expense") || bySubtype.get("operating_expense");

  const shouldPostExpense = isExpensePostable(expense.status);
  const shouldPostSettlement = ["reimbursed", "reconciled"].includes(String(expense.status || ""));

  let accrualEntry = null;
  let settlementEntry = null;

  if (shouldPostExpense) {
    accrualEntry = await upsertJournalEntry({
      workspaceId: expense.workspaceId,
      sourceType: "expense",
      sourceId: expense._id,
      entryType: "expense_accrual",
      postingDate: expense.expenseDate || expense.createdAt || new Date(),
      description: `${expense.category || "Other"} expense accrual`,
      actorId,
      metadata: {
        category: expense.category || "other",
        vendorName: expense.vendorName || "",
        amount: normalizeAmount(expense.amount),
        currency: String(expense.currency || "USD").trim().toUpperCase()
      },
      lines: [
        buildLine(expenseAccount, { debit: expense.amount, memo: expense.vendorName || "Expense" }),
        buildLine(accountsPayable, { credit: expense.amount, memo: expense.vendorName || "Expense" })
      ]
    });
  } else {
    await voidJournalEntries(
      {
        workspaceId: expense.workspaceId,
        sourceType: "expense",
        sourceId: expense._id,
        entryType: "expense_accrual"
      },
      actorId
    );
  }

  if (shouldPostSettlement) {
    settlementEntry = await upsertJournalEntry({
      workspaceId: expense.workspaceId,
      sourceType: "expense",
      sourceId: expense._id,
      entryType: "expense_payment",
      postingDate: expense.updatedAt || expense.expenseDate || new Date(),
      description: `${expense.category || "Other"} expense settlement`,
      actorId,
      metadata: {
        category: expense.category || "other",
        vendorName: expense.vendorName || "",
        amount: normalizeAmount(expense.amount),
        currency: String(expense.currency || "USD").trim().toUpperCase()
      },
      lines: [
        buildLine(accountsPayable, { debit: expense.amount, memo: expense.vendorName || "Expense settlement" }),
        buildLine(cashAccount, { credit: expense.amount, memo: expense.vendorName || "Expense settlement" })
      ]
    });
  } else {
    await voidJournalEntries(
      {
        workspaceId: expense.workspaceId,
        sourceType: "expense",
        sourceId: expense._id,
        entryType: "expense_payment"
      },
      actorId
    );
  }

  await updateExpenseAccountingState(expense._id, {
    "accounting.expenseEntryId": accrualEntry?._id || null,
    "accounting.expenseEntryStatus": shouldPostExpense ? "posted" : "voided",
    "accounting.settlementEntryId": settlementEntry?._id || null,
    "accounting.settlementEntryStatus": shouldPostSettlement ? "posted" : shouldPostExpense ? "pending" : "voided"
  });

  return { accrualEntry, settlementEntry };
}
