import { formatMoney, messagePreview, sortThreads } from "../WorkspaceMessenger.utils.js";

export function normalizeFinanceInvoiceStatus(status = "") {
  if (status === "pending_review" || status === "new") {
    return "pending";
  }

  return status;
}

export function normalizeFinanceExpenseStatus(status = "") {
  if (status === "submitted") {
    return "pending_review";
  }

  return status;
}

export function formatFinanceExpenseStatusLabel(status = "") {
  return String(status || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function isFinanceRecurringDue(recurring) {
  if (!recurring?.enabled || !recurring?.nextIssueDate) {
    return false;
  }

  const nextIssueDate = new Date(recurring.nextIssueDate);
  if (Number.isNaN(nextIssueDate.getTime())) {
    return false;
  }

  return nextIssueDate.getTime() <= Date.now();
}

export function mapFinanceInvoiceRecord(invoice) {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    companyName: invoice.customer?.name || invoice.customerName || invoice.vendorName,
    customer: invoice.customer || null,
    amount: invoice.amount,
    subtotal: invoice.subtotal ?? invoice.amount,
    currency: invoice.currency,
    dueDate: invoice.dueDate,
    status: normalizeFinanceInvoiceStatus(invoice.status),
    recordStatus: invoice.status,
    paidAmount: invoice.paidAmount || 0,
    taxRate: Number(invoice.taxRate || 0),
    taxAmount: Number(invoice.taxAmount || 0),
    taxLabel: invoice.taxLabel || "Tax",
    totalWithTax: invoice.totalWithTax ?? invoice.amount,
    paidAt: invoice.paidAt || null,
    payments: Array.isArray(invoice.payments) ? invoice.payments : [],
    outstandingAmount: invoice.outstandingAmount ?? Math.max(0, Number(invoice.amount || 0) - Number(invoice.paidAmount || 0)),
    recurring: invoice.recurring || {
      enabled: false,
      frequency: "monthly",
      interval: 1,
      nextIssueDate: null
    },
    recurringDue: Boolean(invoice.recurringDue || isFinanceRecurringDue(invoice.recurring)),
    recurringSourceInvoiceId: invoice.recurringSourceInvoiceId || null,
    recurringSequence: Number(invoice.recurringSequence || 0),
    note: invoice.note || "",
    rejectionReason: invoice.rejectionReason || "",
    attachments: invoice.attachments || [],
    accounting: invoice.accounting || null,
    approvedByName: invoice.approvedBy?.name || "",
    rejectedByName: invoice.rejectedBy?.name || "",
    paidByName: invoice.paidBy?.name || "",
    reconciledByName: invoice.reconciledBy?.name || "",
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt
  };
}

export function mapFinanceExpenseRecord(expense) {
  return {
    id: expense.id,
    amount: expense.amount,
    subtotal: expense.totalWithTax != null
      ? Number(expense.totalWithTax || 0) - Number(expense.taxAmount || 0)
      : expense.amount,
    currency: expense.currency,
    category: expense.category,
    vendorName: expense.vendorName || "",
    vendor: expense.vendor || null,
    note: expense.note || "",
    receipt: expense.receipt || null,
    status: normalizeFinanceExpenseStatus(expense.status),
    recordStatus: expense.status,
    logged: expense.status !== "draft",
    accounting: expense.accounting || null,
    approvedByName: expense.approvedBy?.name || "",
    approvedAt: expense.approvedAt || null,
    taxRate: Number(expense.taxRate || 0),
    taxAmount: Number(expense.taxAmount || 0),
    taxLabel: expense.taxLabel || "Tax",
    totalWithTax: expense.totalWithTax ?? expense.amount,
    rejectedByName: expense.rejectedBy?.name || "",
    rejectedAt: expense.rejectedAt || null,
    rejectionReason: expense.rejectionReason || "",
    reimbursedByName: expense.reimbursedBy?.name || "",
    reimbursedAt: expense.reimbursedAt || null,
    reimbursement: expense.reimbursement || { method: "", reference: "", note: "" },
    reconciledByName: expense.reconciledBy?.name || "",
    createdAt: expense.createdAt,
    updatedAt: expense.updatedAt,
    expenseDate: expense.expenseDate
  };
}

export function buildFinanceMessagesFromRecords({ invoices, expenses }) {
  const invoiceMessages = invoices.map((invoice) => ({
    id: `finance-invoice-${invoice.id}`,
    senderId: "financebot",
    senderName: "FinanceBot",
    createdAt: invoice.updatedAt || invoice.createdAt,
    type: "invoice",
    content: `Invoice #${invoice.invoiceNumber} is ${normalizeFinanceInvoiceStatus(invoice.status)}.`,
    metadata: {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      companyName: invoice.customer?.name || invoice.customerName || invoice.vendorName,
      customer: invoice.customer || null,
      amount: invoice.amount,
      subtotal: invoice.subtotal ?? invoice.amount,
      currency: invoice.currency,
      dueDate: invoice.dueDate,
      status: normalizeFinanceInvoiceStatus(invoice.status),
      recordStatus: invoice.status,
      paidAmount: invoice.paidAmount || 0,
      taxRate: Number(invoice.taxRate || 0),
      taxAmount: Number(invoice.taxAmount || 0),
      taxLabel: invoice.taxLabel || "Tax",
      totalWithTax: invoice.totalWithTax ?? invoice.amount,
      payments: Array.isArray(invoice.payments) ? invoice.payments : [],
      outstandingAmount: invoice.outstandingAmount ?? Math.max(0, Number(invoice.amount || 0) - Number(invoice.paidAmount || 0)),
      recurring: invoice.recurring || {
        enabled: false,
        frequency: "monthly",
        interval: 1,
        nextIssueDate: null
      },
      recurringDue: Boolean(invoice.recurringDue || isFinanceRecurringDue(invoice.recurring)),
      recurringSourceInvoiceId: invoice.recurringSourceInvoiceId || null,
      recurringSequence: Number(invoice.recurringSequence || 0),
      note: invoice.note || "",
      rejectionReason: invoice.rejectionReason || "",
      attachments: invoice.attachments || [],
      accounting: invoice.accounting || null,
      approvedByName: invoice.approvedBy?.name || "",
      rejectedByName: invoice.rejectedBy?.name || "",
      paidByName: invoice.paidBy?.name || "",
      reconciledByName: invoice.reconciledBy?.name || ""
    }
  }));

  const expenseMessages = expenses.map((expense) => ({
    id: `finance-expense-${expense.id}`,
    senderId: "financebot",
    senderName: "FinanceBot",
    createdAt: expense.updatedAt || expense.createdAt,
    type: "expense",
    content: `Expense ${formatMoney(expense.amount, expense.currency)} logged under ${expense.category}.`,
    metadata: {
      expenseId: expense.id,
      amount: expense.amount,
      subtotal: expense.subtotal ?? (expense.totalWithTax != null
        ? Number(expense.totalWithTax || 0) - Number(expense.taxAmount || 0)
        : expense.amount),
      currency: expense.currency,
      category: expense.category,
      vendorName: expense.vendorName || "",
      vendor: expense.vendor || null,
      note: expense.note || "",
      receipt: expense.receipt || null,
      status: normalizeFinanceExpenseStatus(expense.status),
      recordStatus: expense.status,
      logged: normalizeFinanceExpenseStatus(expense.status) !== "draft",
      accounting: expense.accounting || null,
      approvedByName: expense.approvedBy?.name || "",
      approvedAt: expense.approvedAt || null,
      taxRate: Number(expense.taxRate || 0),
      taxAmount: Number(expense.taxAmount || 0),
      taxLabel: expense.taxLabel || "Tax",
      totalWithTax: expense.totalWithTax ?? expense.amount,
      rejectedByName: expense.rejectedBy?.name || "",
      rejectedAt: expense.rejectedAt || null,
      rejectionReason: expense.rejectionReason || "",
      reimbursedByName: expense.reimbursedBy?.name || "",
      reimbursedAt: expense.reimbursedAt || null,
      reimbursement: expense.reimbursement || { method: "", reference: "", note: "" },
      reconciledByName: expense.reconciledBy?.name || ""
    }
  }));

  return [...invoiceMessages, ...expenseMessages].sort(
    (first, second) => new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime()
  );
}

export function applyRealFinanceRecords(current, financePayload) {
  const mappedInvoices = financePayload.invoices.map(mapFinanceInvoiceRecord);
  const mappedExpenses = financePayload.expenses.map(mapFinanceExpenseRecord);
  const financeMessages = buildFinanceMessagesFromRecords(financePayload);
  const lastFinanceMessage = financeMessages[financeMessages.length - 1] || null;

  return {
    ...current,
    invoices: mappedInvoices,
    expenses: mappedExpenses,
    threads: sortThreads(
      current.threads.map((thread) =>
        thread.id === "financebot"
          ? {
              ...thread,
              messages: financeMessages,
              unread: 0,
              updatedAt: lastFinanceMessage?.createdAt || thread.updatedAt,
              preview: lastFinanceMessage ? messagePreview(lastFinanceMessage) : "No finance records yet"
            }
          : thread
      )
    )
  };
}

export function buildFinancePayloadFromState(current, { replaceInvoice = null, replaceExpense = null } = {}) {
  return {
    invoices: current.invoices
      .filter((entry) => !replaceInvoice || entry.id !== replaceInvoice.id)
      .map((entry) => ({
        id: entry.id,
        invoiceNumber: entry.invoiceNumber,
        vendorName: entry.companyName,
        customerName: entry.companyName,
        customerEmail: entry.customer?.email || "",
        customer: entry.customer || null,
        amount: entry.amount,
        currency: entry.currency,
        dueDate: entry.dueDate,
        status: entry.recordStatus || entry.status,
        paidAmount: entry.paidAmount || 0,
        paidAt: entry.paidAt || null,
        payments: entry.payments || [],
        outstandingAmount: entry.outstandingAmount ?? Math.max(0, Number(entry.amount || 0) - Number(entry.paidAmount || 0)),
        note: entry.note || "",
        rejectionReason: entry.rejectionReason || "",
        attachments: entry.attachments || [],
        recurring: entry.recurring || {
          enabled: false,
          frequency: "monthly",
          interval: 1,
          nextIssueDate: null
        },
        recurringDue: Boolean(entry.recurringDue || isFinanceRecurringDue(entry.recurring)),
        recurringSourceInvoiceId: entry.recurringSourceInvoiceId || null,
        recurringSequence: Number(entry.recurringSequence || 0),
        updatedAt: entry.updatedAt,
        createdAt: entry.createdAt,
        approvedBy: entry.approvedByName ? { name: entry.approvedByName } : null,
        rejectedBy: entry.rejectedByName ? { name: entry.rejectedByName } : null,
        paidBy: entry.paidByName ? { name: entry.paidByName } : null,
        reconciledBy: entry.reconciledByName ? { name: entry.reconciledByName } : null
      }))
      .concat(replaceInvoice || []),
    expenses: current.expenses
      .filter((entry) => !replaceExpense || entry.id !== replaceExpense.id)
      .map((entry) => ({
        id: entry.id,
        amount: entry.amount,
        currency: entry.currency,
        category: entry.category,
        vendorName: entry.vendorName || "",
        vendorEmail: entry.vendor?.email || "",
        vendor: entry.vendor || null,
        note: entry.note || "",
        receipt: entry.receipt || null,
        status: entry.recordStatus || entry.status,
        updatedAt: entry.updatedAt,
        createdAt: entry.createdAt,
        expenseDate: entry.expenseDate,
        approvedBy: entry.approvedByName ? { name: entry.approvedByName } : null,
        approvedAt: entry.approvedAt || null,
        rejectedBy: entry.rejectedByName ? { name: entry.rejectedByName } : null,
        rejectedAt: entry.rejectedAt || null,
        rejectionReason: entry.rejectionReason || "",
        reimbursedBy: entry.reimbursedByName ? { name: entry.reimbursedByName } : null,
        reimbursedAt: entry.reimbursedAt || null,
        reimbursement: entry.reimbursement || { method: "", reference: "", note: "" },
        reconciledBy: entry.reconciledByName ? { name: entry.reconciledByName } : null
      }))
      .concat(replaceExpense || [])
  };
}
