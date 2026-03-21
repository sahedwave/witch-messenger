import { useCallback } from "react";

import { api } from "../../../api";
import {
  financeGuardrailMessage,
  formatMoney,
  formatTime,
  messagePreview,
  todayDateInputValue,
  uid
} from "../WorkspaceMessenger.utils.js";
import { applyRealFinanceRecords, buildFinancePayloadFromState } from "../finance/finance-record-mappers.js";

export default function useWorkspaceFinanceData({
  authToken,
  activeWorkspaceId,
  realFinanceEnabled,
  financePermissions,
  workspaceDefaultCurrency,
  workspaceState,
  activeThread,
  pushToast,
  setWorkspaceState,
  loadRealFinanceState,
  loadRealFinanceActivity,
  updateMessage,
  decrementThreadUnread,
  appendBotAlert,
  setDraft,
  setDownloadingInvoicePdfId
}) {
  const handleSaveFinanceCustomer = useCallback(async (payload) => {
    if (!authToken || !activeWorkspaceId || !realFinanceEnabled) {
      return false;
    }

    try {
      if (payload.id) {
        await api.updateFinanceCustomer(authToken, payload.id, payload, activeWorkspaceId);
      } else {
        await api.createFinanceCustomer(authToken, payload, activeWorkspaceId);
      }

      await loadRealFinanceState(authToken, {}, activeWorkspaceId);
      pushToast({
        title: payload.id ? "Customer updated" : "Customer added",
        body: `${payload.name} is ready to reuse in Finance.`
      });
      return true;
    } catch (error) {
      pushToast({
        title: "Unable to save customer",
        body: error.message || "Please try again."
      });
      return false;
    }
  }, [activeWorkspaceId, authToken, loadRealFinanceState, realFinanceEnabled]);

  const handleSaveFinanceVendor = useCallback(async (payload) => {
    if (!authToken || !activeWorkspaceId || !realFinanceEnabled) {
      return false;
    }

    try {
      if (payload.id) {
        await api.updateFinanceVendor(authToken, payload.id, payload, activeWorkspaceId);
      } else {
        await api.createFinanceVendor(authToken, payload, activeWorkspaceId);
      }

      await loadRealFinanceState(authToken, {}, activeWorkspaceId);
      pushToast({
        title: payload.id ? "Vendor updated" : "Vendor added",
        body: `${payload.name} is ready to reuse in Finance.`
      });
      return true;
    } catch (error) {
      pushToast({
        title: "Unable to save vendor",
        body: error.message || "Please try again."
      });
      return false;
    }
  }, [activeWorkspaceId, authToken, loadRealFinanceState, realFinanceEnabled]);

  async function handleApproveInvoice(message) {
    if (!financePermissions.canApprove) {
      pushToast({
        title: "Approval unavailable",
        body: "Your finance role does not allow approving invoices."
      });
      return;
    }

    if (realFinanceEnabled && message.metadata.invoiceId) {
      try {
        const invoice = await api.approveFinanceInvoice(authToken, message.metadata.invoiceId, activeWorkspaceId);
        setWorkspaceState((current) =>
          applyRealFinanceRecords(current, buildFinancePayloadFromState(current, { replaceInvoice: invoice }))
        );
        pushToast({
          title: "Invoice approved",
          body: `${invoice.invoiceNumber} was approved.`
        });
        void loadRealFinanceActivity();
      } catch (error) {
        pushToast({
          title: "Unable to approve invoice",
          body: financeGuardrailMessage(error, "The invoice could not be approved.")
        });
      }
      return;
    }

    updateMessage("financebot", message.id, (currentMessage) => ({
      ...currentMessage,
      metadata: {
        ...currentMessage.metadata,
        status: "approved"
      }
    }));
    decrementThreadUnread("financebot");
    appendBotAlert("financebot", "FinanceBot", `Invoice #${message.metadata.invoiceNumber} approved.`, {
      type: "system",
      content: `Invoice #${message.metadata.invoiceNumber} approved by ${workspaceState.currentUser.name} at ${formatTime(new Date().toISOString())}.`
    });
    setWorkspaceState((current) => ({
      ...current,
      invoices: current.invoices.map((invoice) =>
        invoice.id === message.metadata.invoiceId ? { ...invoice, status: "approved" } : invoice
      )
    }));
  }

  function handleStartRejectInvoice(message) {
    if (!financePermissions.canApprove) {
      pushToast({
        title: "Approval unavailable",
        body: "Your finance role does not allow rejecting invoices."
      });
      return;
    }

    updateMessage("financebot", message.id, (currentMessage) => ({
      ...currentMessage,
      metadata: {
        ...currentMessage.metadata,
        showRejectInput: true
      }
    }));
  }

  function handleRejectReasonChange(message, value) {
    updateMessage("financebot", message.id, (currentMessage) => ({
      ...currentMessage,
      metadata: {
        ...currentMessage.metadata,
        rejectReason: value
      }
    }));
  }

  async function handleConfirmRejectInvoice(message) {
    if (!financePermissions.canApprove) {
      pushToast({
        title: "Approval unavailable",
        body: "Your finance role does not allow rejecting invoices."
      });
      return;
    }

    const rejectionReason = message.metadata.rejectReason || "Reason not provided";

    if (realFinanceEnabled && message.metadata.invoiceId) {
      try {
        const invoice = await api.rejectFinanceInvoice(authToken, message.metadata.invoiceId, rejectionReason, activeWorkspaceId);
        setWorkspaceState((current) =>
          applyRealFinanceRecords(current, buildFinancePayloadFromState(current, { replaceInvoice: invoice }))
        );
        pushToast({
          title: "Invoice rejected",
          body: `${invoice.invoiceNumber} was rejected.`
        });
        void loadRealFinanceActivity();
      } catch (error) {
        pushToast({
          title: "Unable to reject invoice",
          body: financeGuardrailMessage(error, "The invoice could not be rejected.")
        });
      }
      return;
    }

    updateMessage("financebot", message.id, (currentMessage) => ({
      ...currentMessage,
      metadata: {
        ...currentMessage.metadata,
        showRejectInput: false,
        status: "rejected",
        rejectionReason
      }
    }));
    decrementThreadUnread("financebot");
    appendBotAlert("financebot", "FinanceBot", `Invoice #${message.metadata.invoiceNumber} rejected.`, {
      type: "system",
      content: `Invoice #${message.metadata.invoiceNumber} rejected by ${workspaceState.currentUser.name}. Reason: ${rejectionReason}`
    });
    setWorkspaceState((current) => ({
      ...current,
      invoices: current.invoices.map((invoice) =>
        invoice.id === message.metadata.invoiceId
          ? { ...invoice, status: "rejected", rejectionReason }
          : invoice
      )
    }));
  }

  async function handleMarkInvoicePaid(message, paymentDetails = null) {
    if (!financePermissions.canMarkPaid) {
      pushToast({
        title: "Action unavailable",
        body: "Your finance role does not allow marking invoices as paid."
      });
      return false;
    }

    if (paymentDetails === null) {
      return false;
    }

    const parsedPaidAmount = Number.parseFloat(paymentDetails?.amount);
    if (!Number.isFinite(parsedPaidAmount) || parsedPaidAmount <= 0) {
      pushToast({
        title: "Payment amount required",
        body: "Enter a payment amount greater than zero."
      });
      return false;
    }

    if (realFinanceEnabled && message.metadata.invoiceId) {
      try {
        const invoice = await api.markFinanceInvoicePaid(
          authToken,
          message.metadata.invoiceId,
          {
            paidAmount: parsedPaidAmount,
            method: paymentDetails?.method || "bank_transfer",
            reference: paymentDetails?.reference || "",
            note: paymentDetails?.note || ""
          },
          activeWorkspaceId
        );
        setWorkspaceState((current) =>
          applyRealFinanceRecords(current, buildFinancePayloadFromState(current, { replaceInvoice: invoice }))
        );
        pushToast({
          title: invoice.status === "paid" ? "Invoice marked paid" : "Partial payment recorded",
          body: invoice.status === "paid"
            ? `${invoice.invoiceNumber} was marked as paid.`
            : `${formatMoney(invoice.outstandingAmount || 0, invoice.currency)} is still outstanding.`
        });
        void loadRealFinanceActivity();
        return true;
      } catch (error) {
        pushToast({
          title: "Unable to mark invoice paid",
          body: financeGuardrailMessage(error, "The payment could not be recorded.")
        });
        return false;
      }
      return false;
    }

    const remainingBeforePayment = Number(message.metadata.outstandingAmount || message.metadata.amount || 0);
    const nextOutstandingAmount = Math.max(0, remainingBeforePayment - parsedPaidAmount);
    const paymentEntry = {
      id: uid("payment"),
      amount: parsedPaidAmount,
      recordedAt: new Date().toISOString(),
      remainingBalance: nextOutstandingAmount,
      method: paymentDetails?.method || "bank_transfer",
      reference: paymentDetails?.reference || "",
      note: paymentDetails?.note || "",
      recordedBy: {
        id: workspaceState.currentUser.id,
        name: workspaceState.currentUser.name,
        email: workspaceState.currentUser.email || ""
      }
    };

    updateMessage("financebot", message.id, (currentMessage) => ({
      ...currentMessage,
      metadata: {
        ...currentMessage.metadata,
        status: parsedPaidAmount >= Number(currentMessage.metadata.outstandingAmount || currentMessage.metadata.amount || 0) ? "paid" : "partial",
        paidByName: workspaceState.currentUser.name,
        paidAmount: Number(currentMessage.metadata.paidAmount || 0) + parsedPaidAmount,
        outstandingAmount: Math.max(0, Number(currentMessage.metadata.outstandingAmount || currentMessage.metadata.amount || 0) - parsedPaidAmount),
        payments: [...(currentMessage.metadata.payments || []), paymentEntry]
      }
    }));
    appendBotAlert("financebot", "FinanceBot", `Invoice #${message.metadata.invoiceNumber} payment recorded.`, {
      type: "system",
      content: `Payment of ${formatMoney(parsedPaidAmount, message.metadata.currency)} recorded for #${message.metadata.invoiceNumber}${paymentEntry.reference ? ` (${paymentEntry.reference})` : ""}.`
    });
    setWorkspaceState((current) => ({
      ...current,
      invoices: current.invoices.map((invoice) =>
        invoice.id === message.metadata.invoiceId
          ? {
              ...invoice,
              status: parsedPaidAmount >= Number(invoice.outstandingAmount ?? invoice.amount) ? "paid" : "partial",
              paidByName: workspaceState.currentUser.name,
              paidAmount: Number(invoice.paidAmount || 0) + parsedPaidAmount,
              outstandingAmount: Math.max(0, Number(invoice.outstandingAmount ?? invoice.amount) - parsedPaidAmount),
              payments: [...(invoice.payments || []), paymentEntry]
            }
          : invoice
      )
    }));
    return true;
  }

  async function handleIssueRecurringInvoice(message) {
    if (!financePermissions.canEdit) {
      pushToast({
        title: "Action unavailable",
        body: "Your finance role does not allow issuing recurring invoices."
      });
      return;
    }

    if (!realFinanceEnabled || !message.metadata.invoiceId) {
      pushToast({
        title: "Real finance required",
        body: "Recurring invoice execution is available in the real finance workspace."
      });
      return;
    }

    try {
      const result = await api.issueNextFinanceInvoice(authToken, message.metadata.invoiceId, activeWorkspaceId);
      await loadRealFinanceState(authToken, {}, activeWorkspaceId);
      pushToast({
        title: "Recurring invoice issued",
        body: `${result.createdInvoice?.invoiceNumber || "The next invoice"} is now in the finance queue.`
      });
      void loadRealFinanceActivity();
    } catch (error) {
      pushToast({
        title: "Unable to issue recurring invoice",
        body: financeGuardrailMessage(error, "The recurring invoice could not be issued.")
      });
    }
  }

  async function handleReconcileInvoice(message) {
    if (!financePermissions.canReconcile) {
      pushToast({
        title: "Action unavailable",
        body: "Your finance role does not allow reconciling invoices."
      });
      return;
    }

    if (realFinanceEnabled && message.metadata.invoiceId) {
      try {
        const invoice = await api.reconcileFinanceInvoice(authToken, message.metadata.invoiceId, activeWorkspaceId);
        setWorkspaceState((current) =>
          applyRealFinanceRecords(current, buildFinancePayloadFromState(current, { replaceInvoice: invoice }))
        );
        pushToast({
          title: "Invoice reconciled",
          body: `${invoice.invoiceNumber} was reconciled.`
        });
        void loadRealFinanceActivity();
      } catch (error) {
        pushToast({
          title: "Unable to reconcile invoice",
          body: financeGuardrailMessage(error, "The invoice could not be reconciled.")
        });
      }
      return;
    }

    updateMessage("financebot", message.id, (currentMessage) => ({
      ...currentMessage,
      metadata: {
        ...currentMessage.metadata,
        status: "reconciled",
        reconciledByName: workspaceState.currentUser.name
      }
    }));
    appendBotAlert("financebot", "FinanceBot", `Invoice #${message.metadata.invoiceNumber} reconciled.`, {
      type: "system",
      content: `Invoice #${message.metadata.invoiceNumber} reconciled by ${workspaceState.currentUser.name}.`
    });
    setWorkspaceState((current) => ({
      ...current,
      invoices: current.invoices.map((invoice) =>
        invoice.id === message.metadata.invoiceId
          ? { ...invoice, status: "reconciled", reconciledByName: workspaceState.currentUser.name }
          : invoice
      )
    }));
  }

  function handleExpenseNoteChange(message, value) {
    updateMessage("financebot", message.id, (currentMessage) => ({
      ...currentMessage,
      metadata: {
        ...currentMessage.metadata,
        note: value
      }
    }));
  }

  async function handleLogExpense(message) {
    if (!financePermissions.canEdit) {
      pushToast({
        title: "Action unavailable",
        body: "Your finance role does not allow updating expenses."
      });
      return;
    }

    if (realFinanceEnabled && message.metadata.expenseId) {
      try {
        const expense = await api.updateFinanceExpense(authToken, message.metadata.expenseId, {
          note: message.metadata.note || ""
        }, activeWorkspaceId);
        setWorkspaceState((current) =>
          applyRealFinanceRecords(current, buildFinancePayloadFromState(current, { replaceExpense: expense }))
        );
        pushToast({
          title: "Expense updated",
          body: "The finance note was saved."
        });
        void loadRealFinanceActivity();
      } catch (error) {
        pushToast({
          title: "Unable to save expense note",
          body: financeGuardrailMessage(error, "The expense note could not be saved.")
        });
      }
      return;
    }

    updateMessage("financebot", message.id, (currentMessage) => ({
      ...currentMessage,
      metadata: {
        ...currentMessage.metadata,
        logged: true,
        status: "pending_review"
      }
    }));
    appendBotAlert("financebot", "FinanceBot", `Expense ${formatMoney(message.metadata.amount, message.metadata.currency)} submitted for review.`, {
      type: "system",
      content: `Expense submitted for review under ${message.metadata.category}.`
    });
    setWorkspaceState((current) => ({
      ...current,
      expenses: [
        {
          id: uid("expense"),
          amount: message.metadata.amount,
          currency: message.metadata.currency,
          category: message.metadata.category,
          vendorName: message.metadata.vendorName || "",
          vendor: message.metadata.vendor || null,
          note: message.metadata.note,
          receipt: message.metadata.receipt || null,
          status: "pending_review",
          createdAt: new Date().toISOString().slice(0, 10)
        },
        ...current.expenses
      ]
    }));
  }

  async function handleApproveExpense(message) {
    if (!canManageFinanceMembers) {
      pushToast({
        title: "Approval unavailable",
        body: "Manager access is required to approve expenses."
      });
      return;
    }

    if (realFinanceEnabled && message.metadata.expenseId) {
      try {
        const expense = await api.approveExpense(authToken, message.metadata.expenseId, activeWorkspaceId);
        setWorkspaceState((current) =>
          applyRealFinanceRecords(current, buildFinancePayloadFromState(current, { replaceExpense: expense }))
        );
        pushToast({
          title: "Expense approved",
          body: `${formatMoney(expense.amount, expense.currency)} is ready for reimbursement or reconciliation.`
        });
        void loadRealFinanceActivity();
      } catch (error) {
        pushToast({
          title: "Unable to approve expense",
          body: financeGuardrailMessage(error, "The expense could not be approved.")
        });
      }
      return;
    }

    updateMessage("financebot", message.id, (currentMessage) => ({
      ...currentMessage,
      metadata: {
        ...currentMessage.metadata,
        status: "approved",
        approvedByName: workspaceState.currentUser.name,
        showRejectInput: false,
        rejectReason: "",
        rejectionReason: ""
      }
    }));
    appendBotAlert("financebot", "FinanceBot", `Expense ${formatMoney(message.metadata.amount, message.metadata.currency)} approved.`, {
      type: "system",
      content: `Expense approved by ${workspaceState.currentUser.name}.`
    });
    setWorkspaceState((current) => ({
      ...current,
      expenses: current.expenses.map((expense) =>
        expense.id === message.metadata.expenseId
          ? {
              ...expense,
              status: "approved",
              approvedByName: workspaceState.currentUser.name,
              rejectionReason: ""
            }
          : expense
      )
    }));
  }

  function handleStartRejectExpense(message) {
    if (!canManageFinanceMembers) {
      pushToast({
        title: "Action unavailable",
        body: "Manager access is required to reject expenses."
      });
      return;
    }

    updateMessage("financebot", message.id, (currentMessage) => ({
      ...currentMessage,
      metadata: {
        ...currentMessage.metadata,
        showRejectInput: true
      }
    }));
  }

  function handleRejectExpenseChange(message, value) {
    updateMessage("financebot", message.id, (currentMessage) => ({
      ...currentMessage,
      metadata: {
        ...currentMessage.metadata,
        rejectReason: value
      }
    }));
  }

  async function handleConfirmRejectExpense(message) {
    if (!canManageFinanceMembers) {
      pushToast({
        title: "Action unavailable",
        body: "Manager access is required to reject expenses."
      });
      return;
    }

    const rejectionReason = String(message.metadata.rejectReason || "").trim();
    if (!rejectionReason) {
      pushToast({
        title: "Reason required",
        body: "Add a rejection reason before confirming."
      });
      return;
    }

    if (realFinanceEnabled && message.metadata.expenseId) {
      try {
        const expense = await api.rejectExpense(authToken, message.metadata.expenseId, rejectionReason, activeWorkspaceId);
        setWorkspaceState((current) =>
          applyRealFinanceRecords(current, buildFinancePayloadFromState(current, { replaceExpense: expense }))
        );
        pushToast({
          title: "Expense rejected",
          body: `${formatMoney(expense.amount, expense.currency)} was rejected.`
        });
        void loadRealFinanceActivity();
      } catch (error) {
        pushToast({
          title: "Unable to reject expense",
          body: financeGuardrailMessage(error, "The expense could not be rejected.")
        });
      }
      return;
    }

    updateMessage("financebot", message.id, (currentMessage) => ({
      ...currentMessage,
      metadata: {
        ...currentMessage.metadata,
        status: "rejected",
        showRejectInput: false,
        rejectedByName: workspaceState.currentUser.name,
        rejectionReason,
        rejectReason: ""
      }
    }));
    appendBotAlert("financebot", "FinanceBot", `Expense ${formatMoney(message.metadata.amount, message.metadata.currency)} rejected.`, {
      type: "system",
      content: `Expense rejected by ${workspaceState.currentUser.name}. Reason: ${rejectionReason}`
    });
    setWorkspaceState((current) => ({
      ...current,
      expenses: current.expenses.map((expense) =>
        expense.id === message.metadata.expenseId
          ? {
              ...expense,
              status: "rejected",
              rejectedByName: workspaceState.currentUser.name,
              rejectionReason
            }
          : expense
      )
    }));
  }

  function handleStartReimburseExpense(message) {
    if (!financePermissions.canEdit) {
      pushToast({
        title: "Action unavailable",
        body: "Your finance role does not allow reimbursing expenses."
      });
      return;
    }

    updateMessage("financebot", message.id, (currentMessage) => ({
      ...currentMessage,
      metadata: {
        ...currentMessage.metadata,
        showReimburseInput: true
      }
    }));
  }

  function handleReimburseExpenseChange(message, field, value) {
    const fieldMap = {
      method: "reimbursementMethod",
      reference: "reimbursementReference",
      note: "reimbursementNote"
    };
    const metadataKey = fieldMap[field] || field;
    updateMessage("financebot", message.id, (currentMessage) => ({
      ...currentMessage,
      metadata: {
        ...currentMessage.metadata,
        [metadataKey]: value
      }
    }));
  }

  async function handleConfirmReimburseExpense(message) {
    if (!financePermissions.canEdit) {
      pushToast({
        title: "Action unavailable",
        body: "Your finance role does not allow reimbursing expenses."
      });
      return;
    }

    const reimbursement = {
      method: String(message.metadata.reimbursementMethod || "").trim(),
      reference: String(message.metadata.reimbursementReference || "").trim(),
      note: String(message.metadata.reimbursementNote || "").trim()
    };

    if (realFinanceEnabled && message.metadata.expenseId) {
      try {
        const expense = await api.reimburseExpense(authToken, message.metadata.expenseId, reimbursement, activeWorkspaceId);
        setWorkspaceState((current) =>
          applyRealFinanceRecords(current, buildFinancePayloadFromState(current, { replaceExpense: expense }))
        );
        pushToast({
          title: "Expense reimbursed",
          body: `${formatMoney(expense.amount, expense.currency)} was marked as reimbursed.`
        });
        void loadRealFinanceActivity();
      } catch (error) {
        pushToast({
          title: "Unable to reimburse expense",
          body: financeGuardrailMessage(error, "The expense could not be reimbursed.")
        });
      }
      return;
    }

    updateMessage("financebot", message.id, (currentMessage) => ({
      ...currentMessage,
      metadata: {
        ...currentMessage.metadata,
        status: "reimbursed",
        reimbursedByName: workspaceState.currentUser.name,
        reimbursedAt: new Date().toISOString(),
        reimbursement,
        showReimburseInput: false,
        reimbursementMethod: "",
        reimbursementReference: "",
        reimbursementNote: ""
      }
    }));
    appendBotAlert("financebot", "FinanceBot", `Expense ${formatMoney(message.metadata.amount, message.metadata.currency)} reimbursed.`, {
      type: "system",
      content: reimbursement.reference
        ? `Expense reimbursed by ${workspaceState.currentUser.name} with ref ${reimbursement.reference}.`
        : `Expense reimbursed by ${workspaceState.currentUser.name}.`
    });
    setWorkspaceState((current) => ({
      ...current,
      expenses: current.expenses.map((expense) =>
        expense.id === message.metadata.expenseId
          ? {
              ...expense,
              status: "reimbursed",
              reimbursedByName: workspaceState.currentUser.name,
              reimbursedAt: new Date().toISOString(),
              reimbursement
            }
          : expense
      )
    }));
  }

  async function handleReconcileExpense(message) {
    if (!financePermissions.canReconcile) {
      pushToast({
        title: "Action unavailable",
        body: "Your finance role does not allow reconciling expenses."
      });
      return;
    }

    if (realFinanceEnabled && message.metadata.expenseId) {
      try {
        const expense = await api.reconcileFinanceExpense(authToken, message.metadata.expenseId, activeWorkspaceId);
        setWorkspaceState((current) =>
          applyRealFinanceRecords(current, buildFinancePayloadFromState(current, { replaceExpense: expense }))
        );
        pushToast({
          title: "Expense reconciled",
          body: `${formatMoney(expense.amount, expense.currency)} was reconciled.`
        });
        void loadRealFinanceActivity();
      } catch (error) {
        pushToast({
          title: "Unable to reconcile expense",
          body: financeGuardrailMessage(error, "The expense could not be reconciled.")
        });
      }
      return;
    }

    updateMessage("financebot", message.id, (currentMessage) => ({
      ...currentMessage,
      metadata: {
        ...currentMessage.metadata,
        status: "reconciled",
        reconciledByName: workspaceState.currentUser.name
      }
    }));
    appendBotAlert("financebot", "FinanceBot", `Expense ${formatMoney(message.metadata.amount, message.metadata.currency)} reconciled.`, {
      type: "system",
      content: `Expense reconciled by ${workspaceState.currentUser.name}.`
    });
    setWorkspaceState((current) => ({
      ...current,
      expenses: current.expenses.map((expense) =>
        expense.id === message.metadata.expenseId
          ? { ...expense, status: "reconciled", reconciledByName: workspaceState.currentUser.name }
          : expense
      )
    }));
  }

  async function createInvoiceEntry({
    invoiceId = null,
    invoiceNumber,
    customerName,
    customerEmail,
    amount,
    currency = workspaceDefaultCurrency || "USD",
    dueDate,
    note = "",
    recurringEnabled = false,
    recurringFrequency = "monthly",
    attachments = []
  }) {
    if (!financePermissions.canCreate) {
      pushToast({
        title: "Action unavailable",
        body: "Your finance role does not allow creating or editing invoices."
      });
      return false;
    }

    const normalizedInvoiceNumber = String(invoiceNumber || "").replace(/^#/, "").trim().toUpperCase();
    const parsedAmount = Number.parseFloat(amount);
    const resolvedCurrency = String(currency || "USD").trim().toUpperCase() || "USD";
    const resolvedCustomerName = String(customerName || "").trim() || (activeThread?.isBot ? "Client account" : activeThread?.name || "Client account");
    const resolvedCustomerEmail = String(customerEmail || "").trim().toLowerCase();
    const resolvedDueDate = dueDate || new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10);
    const resolvedNote = String(note || "").trim();
    const recurring = {
      enabled: Boolean(recurringEnabled),
      frequency: recurringFrequency || "monthly",
      interval: 1,
      nextIssueDate: recurringEnabled ? resolvedDueDate : null
    };

    if (!normalizedInvoiceNumber) {
      pushToast({
        title: "Invoice number required",
        body: "Add a unique invoice number before saving."
      });
      return false;
    }

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      pushToast({
        title: "Amount required",
        body: "Enter a valid invoice amount greater than zero."
      });
      return false;
    }

    if (realFinanceEnabled) {
      try {
        const invoice = invoiceId
          ? await api.updateFinanceInvoice(authToken, invoiceId, {
              invoiceNumber: normalizedInvoiceNumber,
              customerName: resolvedCustomerName,
              customerEmail: resolvedCustomerEmail,
              amount: parsedAmount,
              currency: resolvedCurrency,
              dueDate: resolvedDueDate,
              note: resolvedNote,
              recurring,
              attachments
            }, activeWorkspaceId)
          : await api.createFinanceInvoice(authToken, {
              invoiceNumber: normalizedInvoiceNumber,
              customerName: resolvedCustomerName,
              customerEmail: resolvedCustomerEmail,
              amount: parsedAmount,
              currency: resolvedCurrency,
              dueDate: resolvedDueDate,
              status: "pending_review",
              note: resolvedNote,
              recurring,
              attachments
            }, activeWorkspaceId);
        setWorkspaceState((current) =>
          applyRealFinanceRecords(current, {
            invoices: current.invoices
              .filter((entry) => !invoiceId || entry.id !== invoiceId)
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
                updatedAt: entry.updatedAt,
                createdAt: entry.createdAt
              }))
              .concat(invoice),
            expenses: current.expenses.map((entry) => ({
              id: entry.id,
              amount: entry.amount,
              currency: entry.currency,
              category: entry.category,
              vendorName: entry.vendorName || "",
              vendorEmail: entry.vendor?.email || "",
              vendor: entry.vendor || null,
              note: entry.note || "",
              receipt: entry.receipt || null,
              status: entry.status,
              updatedAt: entry.updatedAt,
              createdAt: entry.createdAt,
              expenseDate: entry.expenseDate
            }))
          })
        );
        pushToast({
          title: invoiceId ? "Invoice updated" : "Invoice created",
          body: invoiceId
            ? `${invoice.invoiceNumber} was updated successfully.`
            : `${invoice.invoiceNumber} is now in the finance queue.`
        });
        void loadRealFinanceActivity();
        setDraft("");
        return true;
      } catch (error) {
        const errorMessage = error?.message || "Please try again.";
        const duplicateInvoice = /already exists/i.test(errorMessage);
        pushToast({
          title: duplicateInvoice ? "Invoice already exists" : "Unable to create invoice",
          body: duplicateInvoice
            ? `${normalizedInvoiceNumber} is already in the finance queue. Try a different invoice number.`
            : financeGuardrailMessage(error, "The invoice could not be saved.")
        });
        return false;
      }
    }

    if (invoiceId) {
      setWorkspaceState((current) => ({
        ...current,
        threads: current.threads.map((thread) =>
          thread.id === "financebot"
            ? {
                ...thread,
                messages: thread.messages.map((message) =>
                  message.type === "invoice" && message.metadata.invoiceId === invoiceId
                    ? {
                        ...message,
                        metadata: {
                          ...message.metadata,
                          invoiceNumber: normalizedInvoiceNumber,
                          companyName: resolvedCustomerName,
                          customer: {
                            id: null,
                            name: resolvedCustomerName,
                            email: resolvedCustomerEmail
                          },
                          amount: parsedAmount,
                          currency: resolvedCurrency,
                          dueDate: resolvedDueDate,
                          note: resolvedNote,
                          recurring,
                          attachments
                        }
                      }
                    : message
                ),
                preview: messagePreview(
                  thread.messages
                    .map((message) =>
                      message.type === "invoice" && message.metadata.invoiceId === invoiceId
                        ? {
                            ...message,
                            metadata: {
                              ...message.metadata,
                              invoiceNumber: normalizedInvoiceNumber,
                              companyName: resolvedCustomerName,
                              customer: {
                                id: null,
                                name: resolvedCustomerName,
                                email: resolvedCustomerEmail
                              },
                              amount: parsedAmount,
                              currency: resolvedCurrency,
                              dueDate: resolvedDueDate,
                              note: resolvedNote,
                              recurring,
                              attachments
                            }
                          }
                        : message
                    )
                    .slice(-1)[0]
                )
              }
            : thread
        ),
        invoices: current.invoices.map((invoice) =>
          invoice.id === invoiceId
            ? {
                ...invoice,
                invoiceNumber: normalizedInvoiceNumber,
                companyName: resolvedCustomerName,
                customer: {
                  id: null,
                  name: resolvedCustomerName,
                  email: resolvedCustomerEmail
                },
                amount: parsedAmount,
                currency: resolvedCurrency,
                dueDate: resolvedDueDate,
                note: resolvedNote,
                recurring,
                attachments
              }
            : invoice
        )
      }));
      pushToast({
        title: "Invoice updated",
        body: `${normalizedInvoiceNumber} was updated successfully.`
      });
      setDraft("");
      return true;
    }

    appendBotAlert("financebot", "FinanceBot", `New invoice card created for ${normalizedInvoiceNumber}.`, {
      type: "invoice",
      content: `Invoice ${normalizedInvoiceNumber} created from command.`,
        metadata: {
          invoiceId: uid("invoice"),
          invoiceNumber: normalizedInvoiceNumber,
          companyName: resolvedCustomerName,
          customer: {
            id: null,
            name: resolvedCustomerName,
            email: resolvedCustomerEmail
          },
          amount: parsedAmount,
          currency: resolvedCurrency,
          dueDate: resolvedDueDate,
          note: resolvedNote,
          status: "pending",
          recurring,
          attachments
        }
      });
    setDraft("");
    return true;
  }

  async function createExpenseEntry({
    expenseId = null,
    amount,
    currency = workspaceDefaultCurrency || "USD",
    category,
    expenseDate,
    vendorName,
    vendorEmail,
    note,
    receipt = null
  }) {
    if (!financePermissions.canCreate) {
      pushToast({
        title: "Action unavailable",
        body: "Your finance role does not allow creating or editing expenses."
      });
      return false;
    }

    const parsedAmount = Number.parseFloat(amount);
    const resolvedCurrency = String(currency || "USD").trim().toUpperCase() || "USD";
    const resolvedCategory = String(category || "").trim().toLowerCase() || "other";
    const resolvedExpenseDate = expenseDate || todayDateInputValue();
    const resolvedVendorName = String(vendorName || "").trim();
    const resolvedVendorEmail = String(vendorEmail || "").trim().toLowerCase();
    const resolvedNote = String(note || "").trim();

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      pushToast({
        title: "Amount required",
        body: "Enter a valid expense amount greater than zero."
      });
      return false;
    }

    if (realFinanceEnabled) {
      try {
        const expense = expenseId
          ? await api.updateFinanceExpense(authToken, expenseId, {
              amount: parsedAmount,
              currency: resolvedCurrency,
              category: resolvedCategory,
              expenseDate: resolvedExpenseDate,
              vendorName: resolvedVendorName,
              vendorEmail: resolvedVendorEmail,
              note: resolvedNote,
              receipt
            }, activeWorkspaceId)
          : await api.createFinanceExpense(authToken, {
              amount: parsedAmount,
              currency: resolvedCurrency,
              category: resolvedCategory,
              expenseDate: resolvedExpenseDate,
              vendorName: resolvedVendorName,
              vendorEmail: resolvedVendorEmail,
              note: resolvedNote,
              status: "pending_review",
              receipt
            }, activeWorkspaceId);
        setWorkspaceState((current) =>
          applyRealFinanceRecords(current, {
            invoices: current.invoices.map((entry) => ({
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
              updatedAt: entry.updatedAt,
              createdAt: entry.createdAt
            })),
            expenses: current.expenses
              .filter((entry) => !expenseId || entry.id !== expenseId)
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
                status: entry.status,
                updatedAt: entry.updatedAt,
                createdAt: entry.createdAt,
                expenseDate: entry.expenseDate
              }))
              .concat(expense)
          })
        );
        pushToast({
          title: expenseId ? "Expense updated" : "Expense created",
          body: expenseId
            ? `${formatMoney(expense.amount, expense.currency)} was updated in finance.`
            : `${formatMoney(expense.amount, expense.currency)} was added to finance.`
        });
        void loadRealFinanceActivity();
        setDraft("");
        return true;
      } catch (error) {
        pushToast({
          title: "Unable to create expense",
          body: financeGuardrailMessage(error, "The expense could not be saved.")
        });
        return false;
      }
    }

    appendBotAlert("financebot", "FinanceBot", `Expense draft created for ${formatMoney(parsedAmount || 0)}.`, {
      type: "expense",
      content: "Expense log drafted.",
        metadata: {
          amount: parsedAmount,
          currency: resolvedCurrency,
          category: resolvedCategory,
          expenseDate: resolvedExpenseDate,
          vendorName: resolvedVendorName,
          vendor: {
            id: null,
            name: resolvedVendorName,
            email: resolvedVendorEmail
          },
          note: resolvedNote,
          receipt,
          status: "draft",
          logged: false
        }
      });
    setDraft("");
    return true;
  }

  async function handleDownloadInvoicePdf(message) {
    const invoiceId = message?.metadata?.invoiceId;

    if (!invoiceId || !authToken || !activeWorkspaceId || !realFinanceEnabled) {
      return;
    }

    setDownloadingInvoicePdfId(invoiceId);

    try {
      const { blob, filename } = await api.downloadInvoicePdf(authToken, invoiceId, activeWorkspaceId);
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename || `invoice-${message.metadata.invoiceNumber || invoiceId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 0);
    } catch (error) {
      pushToast({
        title: "Unable to download invoice PDF",
        body: financeGuardrailMessage(error, "The invoice PDF could not be generated.")
      });
    } finally {
      setDownloadingInvoicePdfId(null);
    }
  }

  return {
    handleSaveFinanceCustomer,
    handleSaveFinanceVendor,
    handleApproveInvoice,
    handleStartRejectInvoice,
    handleRejectReasonChange,
    handleConfirmRejectInvoice,
    handleMarkInvoicePaid,
    handleIssueRecurringInvoice,
    handleReconcileInvoice,
    handleExpenseNoteChange,
    handleLogExpense,
    handleApproveExpense,
    handleStartRejectExpense,
    handleRejectExpenseChange,
    handleConfirmRejectExpense,
    handleStartReimburseExpense,
    handleReimburseExpenseChange,
    handleConfirmReimburseExpense,
    handleReconcileExpense,
    createInvoiceEntry,
    createExpenseEntry,
    handleDownloadInvoicePdf
  };
}
