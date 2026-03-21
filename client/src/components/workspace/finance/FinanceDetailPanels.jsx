import { useEffect, useState } from "react";

import { formatDate, formatDateTime, formatMoney } from "../WorkspaceMessenger.utils.js";
import InvoicePaymentModal from "./InvoicePaymentModal.jsx";
import { FinanceActionLogList } from "./FinanceSummaryPanels.jsx";

export function FinanceInvoiceDetailPanel({
  detail = null,
  message = null,
  canApprove = false,
  canMarkPaid = false,
  canReconcile = false,
  downloadingPdf = false,
  onBack = null,
  onApprove = null,
  onReject = null,
  onRecordPayment = null,
  onReconcile = null,
  onDownloadPdf = null
}) {
  const record = detail || { ...(message?.metadata || {}) };
  const actionLog = Array.isArray(detail?.actionLog) ? detail.actionLog : [];
  const payments = Array.isArray(record.payments) ? record.payments : [];
  const [rejectionReason, setRejectionReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [paymentDraft, setPaymentDraft] = useState({
    amount: String(record.outstandingAmount || record.amount || ""),
    method: "bank_transfer",
    reference: "",
    note: ""
  });

  useEffect(() => {
    setRejectionReason("");
    setShowReject(false);
    setShowPayment(false);
    setPaymentDraft({
      amount: String(record.outstandingAmount || record.amount || ""),
      method: "bank_transfer",
      reference: "",
      note: ""
    });
  }, [record.id, record.outstandingAmount, record.amount]);

  const messageLike = message || { metadata: record };

  return (
    <div className="finance-record-detail-panel rounded-[24px] border border-white/8 bg-white/[0.04] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button type="button" onClick={onBack} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-300">
            Back to invoices
          </button>
          <div className="mt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-400">{record.invoiceNumber || "Invoice detail"}</div>
          <h3 className="mt-2 text-2xl font-bold text-white">{record.customer?.name || record.customerName || record.companyName || "Customer"}</h3>
          <div className="mt-2 text-sm text-slate-400">{record.customer?.email || "No customer email saved"}</div>
        </div>
        <div className="text-right">
          <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-200">{record.status || "pending_review"}</div>
          <div className="mt-3 text-3xl font-bold text-emerald-300">{formatMoney(record.amount || 0, record.currency || "USD")}</div>
          <div className="mt-1 text-xs text-slate-500">Due {record.dueDate ? formatDate(record.dueDate) : "Not set"}</div>
        </div>
      </div>
      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        <div className="rounded-[18px] border border-white/8 bg-slate-950/40 px-4 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Subtotal</div>
          <div className="mt-2 text-sm font-semibold text-slate-100">{formatMoney(record.subtotal || record.amount || 0, record.currency || "USD")}</div>
        </div>
        <div className="rounded-[18px] border border-white/8 bg-slate-950/40 px-4 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{record.taxLabel || "Tax"}</div>
          <div className="mt-2 text-sm font-semibold text-slate-100">{formatMoney(record.taxAmount || 0, record.currency || "USD")}</div>
        </div>
        <div className="rounded-[18px] border border-white/8 bg-slate-950/40 px-4 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Total with tax</div>
          <div className="mt-2 text-sm font-semibold text-slate-100">{formatMoney(record.totalWithTax || record.amount || 0, record.currency || "USD")}</div>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {["pending_review", "pending"].includes(record.status) && canApprove ? (
          <button type="button" onClick={() => onApprove?.(messageLike)} className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-300">
            Approve
          </button>
        ) : null}
        {["pending_review", "pending", "approved"].includes(record.status) ? (
          <button type="button" onClick={() => setShowReject((current) => !current)} className="rounded-full border border-rose-400/20 bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-300">
            {showReject ? "Hide reject" : "Reject"}
          </button>
        ) : null}
        {["approved", "partial", "overdue"].includes(record.status) && canMarkPaid ? (
          <button type="button" onClick={() => setShowPayment((current) => !current)} className="rounded-full border border-sky-400/20 bg-sky-500/10 px-4 py-2 text-xs font-semibold text-sky-300">
            {showPayment ? "Hide payment" : "Record payment"}
          </button>
        ) : null}
        {["approved", "partial", "paid", "overdue"].includes(record.status) && canReconcile ? (
          <button type="button" onClick={() => onReconcile?.(messageLike)} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200">
            Reconcile
          </button>
        ) : null}
        {record.invoiceId || record.id ? (
          <button type="button" onClick={() => onDownloadPdf?.(messageLike)} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200">
            {downloadingPdf ? "Generating PDF..." : "Download PDF"}
          </button>
        ) : null}
      </div>
      {showReject ? (
        <div className="mt-4 rounded-[18px] border border-rose-400/15 bg-rose-500/5 px-4 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-rose-300">Reject invoice</div>
          <textarea
            rows={3}
            value={rejectionReason}
            onChange={(event) => setRejectionReason(event.target.value)}
            placeholder="Add a rejection reason"
            className="mt-3 w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 outline-none"
          />
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => onReject?.({ ...messageLike, metadata: { ...messageLike.metadata, rejectReason: rejectionReason } })}
              className="rounded-full border border-rose-400/20 bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-300"
            >
              Confirm reject
            </button>
          </div>
        </div>
      ) : null}
      {showPayment ? (
        <div className="mt-4 rounded-[18px] border border-sky-400/15 bg-sky-500/5 px-4 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-300">Record payment</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="number" step="0.01" value={paymentDraft.amount} onChange={(event) => setPaymentDraft((current) => ({ ...current, amount: event.target.value }))} className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 outline-none" />
            <select value={paymentDraft.method} onChange={(event) => setPaymentDraft((current) => ({ ...current, method: event.target.value }))} className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 outline-none">
              <option value="bank_transfer">Bank transfer</option>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="check">Check</option>
            </select>
            <input value={paymentDraft.reference} onChange={(event) => setPaymentDraft((current) => ({ ...current, reference: event.target.value }))} placeholder="Reference" className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 outline-none" />
            <input value={paymentDraft.note} onChange={(event) => setPaymentDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Note" className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 outline-none" />
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => onRecordPayment?.(messageLike, paymentDraft)}
              className="rounded-full border border-sky-400/20 bg-sky-500/10 px-4 py-2 text-xs font-semibold text-sky-300"
            >
              Save payment
            </button>
          </div>
        </div>
      ) : null}
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <div className="space-y-5">
          {record.note ? (
            <div className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Note</div>
              <div className="mt-2 text-sm text-slate-300">{record.note}</div>
            </div>
          ) : null}
          <div className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Payment history</div>
            <div className="mt-3 space-y-3">
              {payments.length ? payments.map((payment, index) => (
                <div key={`${payment.id || payment.recordedAt || index}-payment`} className="rounded-[14px] border border-white/8 bg-slate-950/40 px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-100">{formatMoney(payment.amount || 0, record.currency || "USD")}</div>
                      <div className="mt-1 text-xs text-slate-500">{formatDateTime(payment.recordedAt || payment.createdAt)}</div>
                      <div className="mt-1 text-xs text-slate-500">{formatPaymentMethod(payment.method)}{payment.reference ? ` · ${payment.reference}` : ""}</div>
                    </div>
                    <div className="text-right text-xs text-slate-500">
                      {payment.remainingBalance !== undefined ? `Remaining ${formatMoney(payment.remainingBalance || 0, record.currency || "USD")}` : ""}
                    </div>
                  </div>
                  {payment.note ? <div className="mt-2 text-xs text-slate-400">{payment.note}</div> : null}
                </div>
              )) : <div className="text-sm text-slate-400">No payments recorded yet.</div>}
            </div>
          </div>
          {Array.isArray(record.attachments) && record.attachments.length ? (
            <div className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Attachments</div>
              <div className="mt-3 space-y-2">
                {record.attachments.map((attachment, index) => (
                  <a key={`${attachment.url || attachment.name || index}-attachment`} href={attachment.url} target="_blank" rel="noreferrer" className="block rounded-[14px] border border-white/8 bg-slate-950/40 px-3 py-3 text-sm text-emerald-300">
                    {attachment.name || `Attachment ${index + 1}`}
                  </a>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <div className="space-y-5">
          {detail?.accountingEnabled && detail?.accountingJournalRefs ? (
            <div className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Accounting refs</div>
              <div className="mt-3 space-y-2 text-sm text-slate-300">
                <div>Revenue entry: {detail.accountingJournalRefs.revenueEntryStatus || "unposted"}</div>
                <div>Payment journals: {Number(detail.accountingJournalRefs.paymentPostedCount || 0)}</div>
              </div>
            </div>
          ) : null}
          <FinanceActionLogList actions={actionLog} emptyLabel="No invoice actions yet." />
        </div>
      </div>
    </div>
  );
}

export function FinanceExpenseDetailPanel({
  detail = null,
  message = null,
  canApprove = false,
  canEdit = false,
  canReconcile = false,
  onBack = null,
  onApprove = null,
  onReject = null,
  onReimburse = null,
  onReconcile = null
}) {
  const record = detail || { ...(message?.metadata || {}) };
  const actionLog = Array.isArray(detail?.actionLog) ? detail.actionLog : [];
  const [rejectionReason, setRejectionReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [showReimburse, setShowReimburse] = useState(false);
  const [reimbursementDraft, setReimbursementDraft] = useState({
    method: "",
    reference: "",
    note: ""
  });

  useEffect(() => {
    setRejectionReason("");
    setShowReject(false);
    setShowReimburse(false);
    setReimbursementDraft({ method: "", reference: "", note: "" });
  }, [record.id]);

  const messageLike = message || { metadata: record };

  return (
    <div className="finance-record-detail-panel rounded-[24px] border border-white/8 bg-white/[0.04] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button type="button" onClick={onBack} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-300">
            Back to expenses
          </button>
          <div className="mt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-300">Expense detail</div>
          <h3 className="mt-2 text-2xl font-bold text-white">{record.vendor?.name || record.vendorName || "Vendor"}</h3>
          <div className="mt-2 text-sm text-slate-400 capitalize">{record.category || "General"} · {record.expenseDate ? formatDate(record.expenseDate) : "No date"}</div>
        </div>
        <div className="text-right">
          <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-200">{record.status || "pending_review"}</div>
          <div className="mt-3 text-3xl font-bold text-sky-300">{formatMoney(record.amount || 0, record.currency || "USD")}</div>
        </div>
      </div>
      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        <div className="rounded-[18px] border border-white/8 bg-slate-950/40 px-4 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Subtotal</div>
          <div className="mt-2 text-sm font-semibold text-slate-100">{formatMoney(record.amount || 0, record.currency || "USD")}</div>
        </div>
        <div className="rounded-[18px] border border-white/8 bg-slate-950/40 px-4 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{record.taxLabel || "Tax"}</div>
          <div className="mt-2 text-sm font-semibold text-slate-100">{formatMoney(record.taxAmount || 0, record.currency || "USD")}</div>
        </div>
        <div className="rounded-[18px] border border-white/8 bg-slate-950/40 px-4 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Total with tax</div>
          <div className="mt-2 text-sm font-semibold text-slate-100">{formatMoney(record.totalWithTax || record.amount || 0, record.currency || "USD")}</div>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {record.status === "pending_review" && canApprove ? (
          <button type="button" onClick={() => onApprove?.(messageLike)} className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-300">
            Approve
          </button>
        ) : null}
        {["pending_review", "approved"].includes(record.status) ? (
          <button type="button" onClick={() => setShowReject((current) => !current)} className="rounded-full border border-rose-400/20 bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-300">
            {showReject ? "Hide reject" : "Reject"}
          </button>
        ) : null}
        {record.status === "approved" && canEdit ? (
          <button type="button" onClick={() => setShowReimburse((current) => !current)} className="rounded-full border border-sky-400/20 bg-sky-500/10 px-4 py-2 text-xs font-semibold text-sky-300">
            {showReimburse ? "Hide reimburse" : "Reimburse"}
          </button>
        ) : null}
        {["approved", "reimbursed"].includes(record.status) && canReconcile ? (
          <button type="button" onClick={() => onReconcile?.(messageLike)} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200">
            Reconcile
          </button>
        ) : null}
      </div>
      {showReject ? (
        <div className="mt-4 rounded-[18px] border border-rose-400/15 bg-rose-500/5 px-4 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-rose-300">Reject expense</div>
          <textarea
            rows={3}
            value={rejectionReason}
            onChange={(event) => setRejectionReason(event.target.value)}
            placeholder="Add a rejection reason"
            className="mt-3 w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 outline-none"
          />
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => onReject?.({ ...messageLike, metadata: { ...messageLike.metadata, rejectReason: rejectionReason } })}
              className="rounded-full border border-rose-400/20 bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-300"
            >
              Confirm reject
            </button>
          </div>
        </div>
      ) : null}
      {showReimburse ? (
        <div className="mt-4 rounded-[18px] border border-sky-400/15 bg-sky-500/5 px-4 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-300">Reimburse expense</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <input value={reimbursementDraft.method} onChange={(event) => setReimbursementDraft((current) => ({ ...current, method: event.target.value }))} placeholder="Method" className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 outline-none" />
            <input value={reimbursementDraft.reference} onChange={(event) => setReimbursementDraft((current) => ({ ...current, reference: event.target.value }))} placeholder="Reference" className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 outline-none" />
            <input value={reimbursementDraft.note} onChange={(event) => setReimbursementDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Note" className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 outline-none" />
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() =>
                onReimburse?.({
                  ...messageLike,
                  metadata: {
                    ...messageLike.metadata,
                    reimbursementMethod: reimbursementDraft.method,
                    reimbursementReference: reimbursementDraft.reference,
                    reimbursementNote: reimbursementDraft.note
                  }
                })
              }
              className="rounded-full border border-sky-400/20 bg-sky-500/10 px-4 py-2 text-xs font-semibold text-sky-300"
            >
              Confirm reimbursement
            </button>
          </div>
        </div>
      ) : null}
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <div className="space-y-5">
          {record.note ? (
            <div className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Note</div>
              <div className="mt-2 text-sm text-slate-300">{record.note}</div>
            </div>
          ) : null}
          {record.receipt?.url ? (
            <div className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Receipt</div>
              <a href={record.receipt.url} target="_blank" rel="noreferrer" className="mt-3 block rounded-[14px] border border-white/8 bg-slate-950/40 px-3 py-3 text-sm text-sky-300">
                {record.receipt.name || "Open receipt"}
              </a>
            </div>
          ) : null}
        </div>
        <div className="space-y-5">
          {detail?.accountingEnabled && detail?.accountingJournalRefs ? (
            <div className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Accounting refs</div>
              <div className="mt-3 space-y-2 text-sm text-slate-300">
                <div>Expense entry: {detail.accountingJournalRefs.expenseEntryStatus || "unposted"}</div>
                <div>Settlement entry: {detail.accountingJournalRefs.settlementEntryStatus || "unposted"}</div>
              </div>
            </div>
          ) : null}
          <FinanceActionLogList actions={actionLog} emptyLabel="No expense actions yet." />
        </div>
      </div>
    </div>
  );
}

