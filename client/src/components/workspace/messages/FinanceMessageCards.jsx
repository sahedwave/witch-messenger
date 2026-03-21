import { motion } from "framer-motion";

import { financeStatusBadgeStyle, formatDate, formatMoney, formatPaymentMethod } from "../WorkspaceMessenger.utils.js";
import { formatFinanceExpenseStatusLabel, normalizeFinanceExpenseStatus } from "../finance/finance-record-mappers.js";

export function InvoiceMessageCard({
  message,
  currentUser,
  onEdit,
  onApprove,
  onRejectStart,
  onRejectChange,
  onRejectConfirm,
  onMarkPaid,
  onDownloadPdf,
  onIssueRecurring,
  onReconcile,
  showAccounting = true,
  canEdit = true,
  canApprove = true,
  canMarkPaid = true,
  canReconcile = true,
  downloadingPdf = false
}) {
  const status = message.metadata.status;
  const canEditInvoice = Boolean(message.metadata.invoiceId) && canEdit;
  const canDownloadPdf = Boolean(message.metadata.invoiceId) && typeof onDownloadPdf === "function";
  const dueDate = new Date(message.metadata.dueDate);
  const diffDays = Math.ceil((dueDate.getTime() - Date.now()) / 86400000);
  const vendorInitials = String(message.metadata.companyName || "Vendor")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
  const payments = Array.isArray(message.metadata.payments) ? message.metadata.payments : [];
  const recurringDue = Boolean(message.metadata.recurringDue);
  const accounting = message.metadata.accounting || {};
  const blockedPeriodLabel = accounting.blockedPeriodKey ? formatPeriodKeyLabel(accounting.blockedPeriodKey) : "";
  const paymentPostedCount = Number(accounting.paymentPostedCount || 0);
  const invoiceAccountingBadges = [
    accounting.controlStatus && accounting.controlStatus !== "clear"
      ? {
          id: "control-status",
          label: accounting.controlStatus === "blocked"
            ? `Blocked${blockedPeriodLabel ? ` · ${blockedPeriodLabel}` : ""}`
            : formatFinanceControlStatusLabel(accounting.controlStatus),
          tone: financeStatusToneFromState(accounting.controlStatus)
        }
      : null,
    {
      id: "revenue-status",
      label: `Revenue ${formatAccountingEntryStatusLabel(accounting.revenueEntryStatus || "unposted")}`,
      tone: financeStatusToneFromState(accounting.revenueEntryStatus || "unposted")
    },
    payments.length
      ? {
          id: "payment-status",
          label: paymentPostedCount > 0 ? `Payments posted ${paymentPostedCount}` : "Payment journal pending",
          tone: paymentPostedCount > 0 ? "good" : "neutral"
        }
      : null
  ].filter(Boolean);

  const statusTheme = {
    pending: {
      bg: "rgba(245,158,11,0.15)",
      border: "1px solid rgba(245,158,11,0.3)",
      color: "#f59e0b",
      bar: "transparent"
    },
    approved: {
      bg: "rgba(16,185,129,0.15)",
      border: "1px solid rgba(16,185,129,0.3)",
      color: "#10b981",
      bar: "#10b981"
    },
    partial: {
      bg: "rgba(251,191,36,0.15)",
      border: "1px solid rgba(251,191,36,0.3)",
      color: "#fbbf24",
      bar: "#fbbf24"
    },
    paid: {
      bg: "rgba(34,197,94,0.16)",
      border: "1px solid rgba(34,197,94,0.3)",
      color: "#22c55e",
      bar: "#22c55e"
    },
    reconciled: {
      bg: "rgba(14,165,233,0.16)",
      border: "1px solid rgba(14,165,233,0.3)",
      color: "#38bdf8",
      bar: "#38bdf8"
    },
    rejected: {
      bg: "rgba(239,68,68,0.15)",
      border: "1px solid rgba(239,68,68,0.3)",
      color: "#ef4444",
      bar: "#ef4444"
    },
    overdue: {
      bg: "rgba(239,68,68,0.15)",
      border: "1px solid rgba(239,68,68,0.3)",
      color: "#ef4444",
      bar: "#ef4444"
    }
  }[status] || {
    bg: "rgba(100,116,139,0.14)",
    border: "1px solid rgba(100,116,139,0.22)",
    color: "#94a3b8",
    bar: "transparent"
  };

  const dueTone =
    status === "overdue" || diffDays < 0
      ? "#ef4444"
      : diffDays <= 2
        ? "#f59e0b"
        : "#f1f5f9";

  const amountTone =
    status === "approved" || status === "paid" || status === "reconciled"
      ? "#10b981"
      : status === "rejected" || status === "overdue"
        ? "#f1f5f9"
        : "#f1f5f9";

  const cardBorder =
    status === "approved" || status === "paid"
      ? "1px solid rgba(16,185,129,0.28)"
      : status === "reconciled"
        ? "1px solid rgba(56,189,248,0.28)"
      : status === "rejected" || status === "overdue"
        ? "1px solid rgba(239,68,68,0.24)"
        : "1px solid rgba(255,255,255,0.08)";

  const cardShadow =
    status === "approved" || status === "paid"
      ? "0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(16,185,129,0.12)"
      : status === "reconciled"
        ? "0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(56,189,248,0.12)"
      : status === "rejected" || status === "overdue"
        ? "0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(239,68,68,0.12)"
        : "0 4px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05)";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.3, ease: [0.34, 1.56, 0.64, 1] }}
      style={{
        position: "relative",
        width: "100%",
        maxWidth: 480,
        borderRadius: 22,
        padding: "20px 24px",
        background: "linear-gradient(180deg, #111827 0%, #121b2d 100%)",
        border: cardBorder,
        boxShadow: cardShadow,
        overflow: "hidden",
        fontFamily: '"Manrope","DM Sans","Segoe UI",sans-serif'
      }}
    >
      {(status === "overdue" || status === "rejected") && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            background: statusTheme.bar
          }}
        />
      )}

      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
        <div>
          <p
            style={{
              margin: 0,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "#10b981",
              fontFamily: '"Sora","Manrope","DM Sans","Segoe UI",sans-serif'
            }}
          >
            {message.metadata.invoiceNumber}
          </p>
          <h4
            style={{
              margin: "4px 0 0",
              fontSize: 18,
              fontWeight: 700,
              color: "#f1f5f9",
              fontFamily: '"Sora","Manrope","DM Sans","Segoe UI",sans-serif'
            }}
          >
            {message.metadata.companyName}
          </h4>
          {message.metadata.customer?.email ? (
            <p className="mt-1 text-xs text-slate-500">{message.metadata.customer.email}</p>
          ) : null}
        </div>

        <motion.span
          animate={
            status === "overdue"
              ? { opacity: [1, 0.78, 1], boxShadow: ["0 0 0 rgba(239,68,68,0)", "0 0 18px rgba(239,68,68,0.18)", "0 0 0 rgba(239,68,68,0)"] }
              : { opacity: 1, boxShadow: "0 0 0 rgba(0,0,0,0)" }
          }
          transition={status === "overdue" ? { repeat: Infinity, duration: 1.8 } : { duration: 0.2 }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            borderRadius: 20,
            padding: "8px 12px",
            fontSize: 12,
            fontWeight: 700,
            textTransform: "capitalize",
            background: statusTheme.bg,
            border: statusTheme.border,
            color: statusTheme.color,
            fontFamily: '"Manrope","DM Sans","Segoe UI",sans-serif'
          }}
        >
          {status}
        </motion.span>
      </div>

      <p
        style={{
          margin: "14px 0 0",
          fontSize: 40,
          lineHeight: 1,
          fontWeight: 800,
          color: amountTone,
          fontFamily: '"Sora","Manrope","DM Sans","Segoe UI",sans-serif',
          fontVariantNumeric: "tabular-nums"
        }}
      >
        {formatMoney(message.metadata.amount, message.metadata.currency)}
      </p>
      {(Number(message.metadata.taxAmount || 0) > 0 || Number(message.metadata.subtotal || 0) !== Number(message.metadata.amount || 0)) ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded-[14px] border border-white/10 bg-white/5 px-3 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Subtotal</div>
            <div className="mt-1 text-sm font-semibold text-slate-100">
              {formatMoney(message.metadata.subtotal || message.metadata.amount || 0, message.metadata.currency)}
            </div>
          </div>
          <div className="rounded-[14px] border border-white/10 bg-white/5 px-3 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{message.metadata.taxLabel || "Tax"}</div>
            <div className="mt-1 text-sm font-semibold text-slate-100">
              {formatMoney(message.metadata.taxAmount || 0, message.metadata.currency)}
            </div>
          </div>
          <div className="rounded-[14px] border border-white/10 bg-white/5 px-3 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Total</div>
            <div className="mt-1 text-sm font-semibold text-slate-100">
              {formatMoney(message.metadata.totalWithTax || message.metadata.amount || 0, message.metadata.currency)}
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {message.metadata.recurring?.enabled && !message.metadata.recurringSourceInvoiceId ? (
          <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-300">
            Template
          </span>
        ) : null}
        {message.metadata.recurringSourceInvoiceId ? (
          <span className="rounded-full border border-sky-400/20 bg-sky-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-300">
            Generated run #{message.metadata.recurringSequence || 1}
          </span>
        ) : null}
        {message.metadata.recurring?.enabled ? (
          <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-300">
            Recurring {message.metadata.recurring.frequency}
          </span>
        ) : null}
        {recurringDue ? (
          <span className="rounded-full border border-amber-300/20 bg-amber-400/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200">
            Due to issue now
          </span>
        ) : null}
        {message.metadata.outstandingAmount > 0 ? (
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-300">
            Remaining {formatMoney(message.metadata.outstandingAmount, message.metadata.currency)}
          </span>
        ) : null}
        {showAccounting
          ? invoiceAccountingBadges.map((badge) => (
              <span
                key={`${message.id}-${badge.id}`}
                className="rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]"
                style={financeStatusBadgeStyle(badge.tone)}
              >
                {badge.label}
              </span>
            ))
          : null}
      </div>

      {message.metadata.note ? (
        <div
          style={{
            marginTop: 14,
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.04)",
            padding: "12px 14px"
          }}
        >
          <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase" }}>
            Note
          </div>
          <div style={{ marginTop: 6, color: "#cbd5e1", fontSize: 13, lineHeight: 1.6 }}>
            {message.metadata.note}
          </div>
        </div>
      ) : null}

      {showAccounting && accounting.controlStatus === "blocked" ? (
        <div
          style={{
            marginTop: 14,
            borderRadius: 16,
            border: "1px solid rgba(239,68,68,0.22)",
            background: "rgba(127,29,29,0.22)",
            padding: "12px 14px"
          }}
        >
          <div
            style={{
              color: "#fecaca",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase"
            }}
          >
            Locked-period safeguard
          </div>
          <div style={{ marginTop: 6, color: "#fee2e2", fontSize: 13, fontWeight: 600 }}>
            {blockedPeriodLabel ? `${blockedPeriodLabel} is locked for accounting changes.` : "This invoice is currently blocked for accounting changes."}
          </div>
          <div style={{ marginTop: 4, color: "#fca5a5", fontSize: 12 }}>
            {accounting.blockedReason || "Unlock the period before changing approval, payment, reconciliation, or other posting-related fields."}
          </div>
        </div>
      ) : null}

      <div
        style={{
          marginTop: 18,
          paddingTop: 16,
          borderTop: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          justifyContent: "space-between",
          gap: 16,
          alignItems: "center"
        }}
      >
        <div>
          <p
            style={{
              margin: 0,
              fontSize: 10,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "#475569",
              fontWeight: 700
            }}
          >
            Due Date
          </p>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: 14,
              fontWeight: 700,
              color: dueTone,
              fontFamily: '"Manrope","DM Sans","Segoe UI",sans-serif'
            }}
          >
            {formatDate(message.metadata.dueDate)}
          </p>
        </div>

        <div
          aria-hidden="true"
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "#f1f5f9",
            fontSize: 13,
            fontWeight: 700,
            fontFamily: '"Sora","Manrope","DM Sans","Segoe UI",sans-serif'
          }}
        >
          {vendorInitials || "V"}
        </div>
      </div>

      {(status === "pending" || status === "overdue") && !message.metadata.showRejectInput ? (
        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid rgba(255,255,255,0.06)"
          }}
        >
          {canEditInvoice ? (
            <button
              type="button"
              onClick={() => onEdit(message)}
              style={{
                borderRadius: 12,
                padding: "10px 24px",
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.05)",
                color: "#e2e8f0",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer"
              }}
            >
              Edit Invoice
            </button>
          ) : null}
          {canApprove ? (
            <>
              <button
                type="button"
                onClick={() => onApprove(message)}
                style={{
                  borderRadius: 12,
                  padding: "10px 24px",
                  border: "1px solid rgba(16,185,129,0.4)",
                  background: "rgba(16,185,129,0.15)",
                  color: "#10b981",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer"
                }}
              >
                Approve ✓
              </button>
              <button
                type="button"
                onClick={() => onRejectStart(message)}
                style={{
                  borderRadius: 12,
                  padding: "10px 24px",
                  border: "1px solid rgba(239,68,68,0.3)",
                  background: "rgba(239,68,68,0.1)",
                  color: "#ef4444",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer"
                }}
              >
                Reject ✗
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {canDownloadPdf ? (
        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid rgba(255,255,255,0.06)"
          }}
        >
          <button
            type="button"
            onClick={() => onDownloadPdf(message)}
            disabled={downloadingPdf}
            style={{
              borderRadius: 12,
              padding: "10px 24px",
              border: "1px solid rgba(56,189,248,0.28)",
              background: "rgba(56,189,248,0.12)",
              color: "#38bdf8",
              fontSize: 14,
              fontWeight: 700,
              cursor: downloadingPdf ? "progress" : "pointer",
              opacity: downloadingPdf ? 0.7 : 1
            }}
          >
            {downloadingPdf ? "Generating PDF..." : "Download PDF"}
          </button>
        </div>
      ) : null}

      {message.metadata.showRejectInput && canApprove ? (
        <div
          style={{
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid rgba(255,255,255,0.06)"
          }}
        >
          <textarea
            value={message.metadata.rejectReason || ""}
            onChange={(event) => onRejectChange(message, event.target.value)}
            placeholder="Reason for rejection..."
            rows={3}
            style={{
              width: "100%",
              resize: "vertical",
              borderRadius: 12,
              border: "1px solid rgba(239,68,68,0.18)",
              background: "rgba(255,255,255,0.04)",
              color: "#f1f5f9",
              padding: "12px 14px",
              outline: "none",
              fontSize: 14,
              boxSizing: "border-box"
            }}
          />
          <button
            type="button"
            onClick={() => onRejectConfirm(message)}
            style={{
              marginTop: 12,
              borderRadius: 12,
              padding: "10px 18px",
              border: "1px solid rgba(239,68,68,0.34)",
              background: "rgba(239,68,68,0.14)",
              color: "#ef4444",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer"
            }}
          >
            Confirm Reject
          </button>
        </div>
      ) : null}

      {Array.isArray(message.metadata.attachments) && message.metadata.attachments.length ? (
        <div
          style={{
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            flexWrap: "wrap",
            gap: 10
          }}
        >
          {message.metadata.attachments.map((attachment) => (
            <a
              key={`${message.id}-${attachment.fileName}`}
              href={attachment.fileUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                borderRadius: 12,
                padding: "10px 12px",
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.04)",
                color: "#cbd5e1",
                fontSize: 13,
                fontWeight: 600,
                textDecoration: "none"
              }}
            >
              <span>📎</span>
              <span>{attachment.fileName}</span>
            </a>
          ))}
        </div>
      ) : null}

      {payments.length ? (
        <div
          style={{
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid rgba(255,255,255,0.06)"
          }}
        >
          <div style={{ color: "#94a3b8", fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase" }}>
            Payment history
          </div>
          <div style={{ marginTop: 8, color: "#cbd5e1", fontSize: 12 }}>
            {payments.length} payment{payments.length === 1 ? "" : "s"} recorded · {formatMoney(message.metadata.paidAmount || 0, message.metadata.currency)} collected
          </div>
          <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            {payments.slice().reverse().map((payment, index) => (
              <div
                key={`${message.id}-payment-${payment.id || index}`}
                style={{
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.04)",
                  padding: "10px 12px",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "center"
                }}
              >
                <div>
                  <div style={{ color: "#f8fafc", fontSize: 13, fontWeight: 700 }}>
                    Payment {payments.length - index} · {formatMoney(payment.amount, message.metadata.currency)}
                  </div>
                  <div style={{ marginTop: 4, color: "#64748b", fontSize: 12 }}>
                    {formatDateTime(payment.recordedAt)}
                  </div>
                  <div style={{ marginTop: 4, color: "#94a3b8", fontSize: 12 }}>
                    {formatPaymentMethod(payment.method)}
                    {payment.reference ? ` · Ref ${payment.reference}` : ""}
                  </div>
                  {payment.note ? (
                    <div style={{ marginTop: 4, color: "#94a3b8", fontSize: 12, maxWidth: 360 }}>
                      {payment.note}
                    </div>
                  ) : null}
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ color: "#cbd5e1", fontSize: 12 }}>
                    {payment.recordedBy?.name || "Finance staff"}
                  </div>
                  <div style={{ marginTop: 4, color: "#94a3b8", fontSize: 12 }}>
                    {formatMoney(payment.remainingBalance || 0, message.metadata.currency)} left
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {status === "approved" || status === "partial" ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          style={{
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid rgba(255,255,255,0.06)",
            color: status === "partial" ? "#fbbf24" : "#10b981",
            fontSize: 12,
            fontWeight: 700
          }}
        >
          {status === "partial"
            ? `Partial payment recorded. ${formatMoney(message.metadata.outstandingAmount || 0, message.metadata.currency)} still open`
            : `✓ Approved by ${message.metadata.approvedByName || currentUser.name}`}
        </motion.div>
      ) : null}

      {(status === "approved" || status === "partial") && canMarkPaid ? (
        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid rgba(255,255,255,0.06)"
          }}
        >
          {canEditInvoice ? (
            <button
              type="button"
              onClick={() => onEdit(message)}
              style={{
                borderRadius: 12,
                padding: "10px 24px",
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.05)",
                color: "#e2e8f0",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer"
              }}
            >
              Edit Invoice
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onMarkPaid(message)}
            style={{
              borderRadius: 12,
              padding: "10px 24px",
              border: "1px solid rgba(34,197,94,0.38)",
              background: "rgba(34,197,94,0.15)",
              color: "#22c55e",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer"
            }}
          >
            {status === "partial" ? "Record More Payment" : "Record Payment"}
          </button>
        </div>
      ) : null}

      {message.metadata.recurring?.enabled && canEdit ? (
        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid rgba(255,255,255,0.06)"
          }}
        >
          <div style={{ color: recurringDue ? "#fbbf24" : "#94a3b8", fontSize: 12, fontWeight: 700 }}>
            Next issue {message.metadata.recurring?.nextIssueDate ? formatDate(message.metadata.recurring.nextIssueDate) : "not scheduled"}
          </div>
          {recurringDue ? (
            <button
              type="button"
              onClick={() => onIssueRecurring(message)}
              style={{
                borderRadius: 12,
                padding: "10px 24px",
                border: "1px solid rgba(16,185,129,0.4)",
                background: "rgba(16,185,129,0.15)",
                color: "#10b981",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer"
              }}
            >
              Issue Next Invoice
            </button>
          ) : null}
        </div>
      ) : null}

      {status === "paid" && canReconcile ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          style={{
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid rgba(255,255,255,0.06)"
          }}
        >
          <div style={{ color: "#22c55e", fontSize: 12, fontWeight: 700 }}>
            Paid by {message.metadata.paidByName || currentUser.name}
          </div>
          {canEditInvoice ? (
            <button
              type="button"
              onClick={() => onEdit(message)}
              style={{
                marginTop: 12,
                marginRight: 12,
                borderRadius: 12,
                padding: "10px 24px",
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.05)",
                color: "#e2e8f0",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer"
              }}
            >
              Edit Invoice
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onReconcile(message)}
            style={{
              marginTop: 12,
              borderRadius: 12,
              padding: "10px 24px",
              border: "1px solid rgba(56,189,248,0.34)",
              background: "rgba(56,189,248,0.14)",
              color: "#38bdf8",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer"
            }}
          >
            Reconcile
          </button>
        </motion.div>
      ) : null}

      {canEditInvoice && (status === "rejected" || status === "reconciled") ? (
        <div
          style={{
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid rgba(255,255,255,0.06)"
          }}
        >
          <button
            type="button"
            onClick={() => onEdit(message)}
            style={{
              borderRadius: 12,
              padding: "10px 24px",
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.05)",
              color: "#e2e8f0",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer"
            }}
          >
            Edit Invoice
          </button>
        </div>
      ) : null}

      {status === "rejected" ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          style={{
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid rgba(255,255,255,0.06)"
          }}
        >
          <div style={{ color: "#ef4444", fontSize: 12, fontWeight: 700 }}>
            Rejected by {message.metadata.rejectedByName || currentUser.name}
          </div>
          {message.metadata.rejectionReason ? (
            <div style={{ marginTop: 6, color: "#94a3b8", fontSize: 13 }}>
              {message.metadata.rejectionReason}
            </div>
          ) : null}
        </motion.div>
      ) : null}

      {status === "reconciled" ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          style={{
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid rgba(255,255,255,0.06)",
            color: "#38bdf8",
            fontSize: 12,
            fontWeight: 700
          }}
        >
          ✓ Reconciled by {message.metadata.reconciledByName || currentUser.name}
        </motion.div>
      ) : null}
    </motion.div>
  );
}

export function ExpenseMessageCard({
  message,
  onNoteChange,
  onLogExpense,
  onApproveExpense,
  onStartRejectExpense,
  onRejectExpenseChange,
  onConfirmRejectExpense,
  onStartReimburseExpense,
  onReimburseExpenseChange,
  onConfirmReimburseExpense,
  onReconcileExpense,
  onEditExpense,
  showAccounting = true,
  canEdit = true,
  canOperate = true,
  canManageWorkflow = false,
  canReimburse = true,
  canReconcile = true
}) {
  const status = normalizeFinanceExpenseStatus(message.metadata.status);
  const isPersistedExpense = Boolean(message.metadata.expenseId);
  const actionDisabled = !canOperate || (message.metadata.logged && !isPersistedExpense);
  const actionLabel = message.metadata.logged
    ? isPersistedExpense
      ? "Save Note"
      : "Logged"
    : "Log Expense";
  const canApproveExpense = canManageWorkflow && isPersistedExpense && status === "pending_review";
  const canRejectExpense = canManageWorkflow && isPersistedExpense && ["pending_review", "approved"].includes(status);
  const canShowRejectInput = Boolean(message.metadata.showRejectInput) && canRejectExpense;
  const canReimburseExpense = canReimburse && isPersistedExpense && status === "approved";
  const canShowReimburseInput = Boolean(message.metadata.showReimburseInput) && canReimburseExpense;
  const canReconcileExpense = canReconcile && isPersistedExpense && ["approved", "reimbursed"].includes(status);
  const accounting = message.metadata.accounting || {};
  const blockedPeriodLabel = accounting.blockedPeriodKey ? formatPeriodKeyLabel(accounting.blockedPeriodKey) : "";
  const statusBadgeClass = {
    draft: "bg-slate-100 text-slate-700",
    pending_review: "bg-amber-100 text-amber-700",
    approved: "bg-emerald-100 text-emerald-700",
    reimbursed: "bg-green-100 text-green-700",
    reconciled: "bg-sky-100 text-sky-700",
    rejected: "bg-rose-100 text-rose-700"
  }[status] || "bg-slate-100 text-slate-700";
  const expenseAccountingBadges = [
    accounting.controlStatus && accounting.controlStatus !== "clear"
      ? {
          id: "control-status",
          label: accounting.controlStatus === "blocked"
            ? `Blocked${blockedPeriodLabel ? ` · ${blockedPeriodLabel}` : ""}`
            : formatFinanceControlStatusLabel(accounting.controlStatus),
          tone: financeStatusToneFromState(accounting.controlStatus)
        }
      : null,
    {
      id: "expense-status",
      label: `Expense ${formatAccountingEntryStatusLabel(accounting.expenseEntryStatus || "unposted")}`,
      tone: financeStatusToneFromState(accounting.expenseEntryStatus || "unposted")
    },
    status === "reconciled" || accounting.settlementEntryStatus === "posted" || accounting.settlementEntryStatus === "voided"
      ? {
          id: "settlement-status",
          label: `Settlement ${formatAccountingEntryStatusLabel(accounting.settlementEntryStatus || "unposted")}`,
          tone: financeStatusToneFromState(accounting.settlementEntryStatus || "unposted")
        }
      : null
  ].filter(Boolean);

  return (
    <motion.div layout className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Expense</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{formatMoney(message.metadata.amount, message.metadata.currency)}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-bold capitalize ${statusBadgeClass}`}>
            {formatFinanceExpenseStatusLabel(status)}
          </span>
          <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-[#2D8EFF] capitalize">{message.metadata.category}</span>
        </div>
      </div>
      {(Number(message.metadata.taxAmount || 0) > 0 || Number(message.metadata.totalWithTax || message.metadata.amount || 0) !== Number(message.metadata.amount || 0)) ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Subtotal</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">
              {formatMoney((message.metadata.totalWithTax || message.metadata.amount || 0) - (message.metadata.taxAmount || 0), message.metadata.currency)}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{message.metadata.taxLabel || "Tax"}</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">
              {formatMoney(message.metadata.taxAmount || 0, message.metadata.currency)}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Total</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">
              {formatMoney(message.metadata.totalWithTax || message.metadata.amount || 0, message.metadata.currency)}
            </div>
          </div>
        </div>
      ) : null}
      {message.metadata.vendorName ? (
        <p className="mt-2 text-sm text-slate-500">{message.metadata.vendorName}</p>
      ) : null}
      {message.metadata.expenseDate ? (
        <p className="mt-1 text-xs font-medium uppercase tracking-[0.12em] text-slate-400">
          Expense date {formatDate(message.metadata.expenseDate)}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {showAccounting
          ? expenseAccountingBadges.map((badge) => (
              <span
                key={`${message.id}-${badge.id}`}
                className="rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]"
                style={financeStatusBadgeStyle(badge.tone)}
              >
                {badge.label}
              </span>
            ))
          : null}
      </div>
      {showAccounting && accounting.controlStatus === "blocked" ? (
        <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-rose-700">Locked-period safeguard</div>
          <div className="mt-1 text-sm font-semibold text-rose-900">
            {blockedPeriodLabel ? `${blockedPeriodLabel} is locked for expense posting changes.` : "This expense is currently blocked for posting changes."}
          </div>
          <div className="mt-1 text-xs text-rose-700">
            {accounting.blockedReason || "Unlock the period before changing reconciled or posted accounting fields."}
          </div>
        </div>
      ) : null}
      <textarea
        value={message.metadata.note || ""}
        onChange={(event) => onNoteChange(message, event.target.value)}
        rows={3}
        className="mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm outline-none"
        placeholder="Add a note for finance"
        readOnly={!canOperate}
      />
      {message.metadata.receipt ? (
        <a
          href={message.metadata.receipt.fileUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-700"
        >
          <span>🧾</span>
          <span>{message.metadata.receipt.fileName}</span>
        </a>
      ) : null}
      {canOperate ? (
        <button
          type="button"
          onClick={() => onLogExpense(message)}
          disabled={actionDisabled}
          className={`mt-4 rounded-full px-4 py-2 text-sm font-bold text-white shadow-sm ${
            message.metadata.logged ? "bg-emerald-500" : "bg-slate-900"
          }`}
        >
          {actionLabel}
        </button>
      ) : null}
      {isPersistedExpense && canEdit ? (
        <button
          type="button"
          onClick={() => onEditExpense(message)}
          className="mt-3 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700"
        >
          Edit Expense
        </button>
      ) : null}
      {(canApproveExpense || canRejectExpense) && !canShowRejectInput ? (
        <div className="mt-3 flex flex-wrap gap-3">
          {canApproveExpense ? (
            <button
              type="button"
              onClick={() => onApproveExpense(message)}
              className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700"
            >
              Approve Expense
            </button>
          ) : null}
          {canRejectExpense ? (
            <button
              type="button"
              onClick={() => onStartRejectExpense(message)}
              className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-bold text-rose-700"
            >
              Reject Expense
            </button>
          ) : null}
        </div>
      ) : null}
      {canShowRejectInput ? (
        <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4">
          <textarea
            value={message.metadata.rejectReason || ""}
            onChange={(event) => onRejectExpenseChange(message, event.target.value)}
            rows={3}
            className="w-full rounded-2xl border border-rose-200 bg-white px-3 py-3 text-sm outline-none"
            placeholder="Reason for rejection"
          />
          <button
            type="button"
            onClick={() => onConfirmRejectExpense(message)}
            className="mt-3 rounded-full border border-rose-200 bg-white px-4 py-2 text-sm font-bold text-rose-700"
          >
            Confirm Reject
          </button>
        </div>
      ) : null}
      {canReimburseExpense && !canShowReimburseInput ? (
        <button
          type="button"
          onClick={() => onStartReimburseExpense(message)}
          className="mt-3 rounded-full border border-green-200 bg-green-50 px-4 py-2 text-sm font-bold text-green-700"
        >
          Reimburse Expense
        </button>
      ) : null}
      {canShowReimburseInput ? (
        <div className="mt-3 rounded-2xl border border-green-200 bg-green-50 px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              value={message.metadata.reimbursementMethod || ""}
              onChange={(event) => onReimburseExpenseChange(message, "method", event.target.value)}
              className="rounded-2xl border border-green-200 bg-white px-3 py-3 text-sm outline-none"
              placeholder="Method (optional)"
            />
            <input
              value={message.metadata.reimbursementReference || ""}
              onChange={(event) => onReimburseExpenseChange(message, "reference", event.target.value)}
              className="rounded-2xl border border-green-200 bg-white px-3 py-3 text-sm outline-none"
              placeholder="Reference (optional)"
            />
          </div>
          <textarea
            value={message.metadata.reimbursementNote || ""}
            onChange={(event) => onReimburseExpenseChange(message, "note", event.target.value)}
            rows={2}
            className="mt-3 w-full rounded-2xl border border-green-200 bg-white px-3 py-3 text-sm outline-none"
            placeholder="Note (optional)"
          />
          <button
            type="button"
            onClick={() => onConfirmReimburseExpense(message)}
            className="mt-3 rounded-full border border-green-200 bg-white px-4 py-2 text-sm font-bold text-green-700"
          >
            Confirm Reimbursement
          </button>
        </div>
      ) : null}
      {canReconcileExpense ? (
        <button
          type="button"
          onClick={() => onReconcileExpense(message)}
          className="mt-3 rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-bold text-sky-700"
        >
          Reconcile Expense
        </button>
      ) : null}
      {status === "approved" ? (
        <p className="mt-3 text-sm font-medium text-emerald-700">
          Approved{message.metadata.approvedByName ? ` by ${message.metadata.approvedByName}` : ""}.
        </p>
      ) : null}
      {status === "rejected" ? (
        <div className="mt-3 text-sm text-rose-700">
          <div className="font-medium">
            Rejected{message.metadata.rejectedByName ? ` by ${message.metadata.rejectedByName}` : ""}.
          </div>
          {message.metadata.rejectionReason ? (
            <div className="mt-1 text-rose-600">{message.metadata.rejectionReason}</div>
          ) : null}
        </div>
      ) : null}
      {status === "reimbursed" ? (
        <div className="mt-3 text-sm text-green-700">
          <div className="font-medium">
            Reimbursed{message.metadata.reimbursedByName ? ` by ${message.metadata.reimbursedByName}` : ""}.
          </div>
          {(message.metadata.reimbursement?.method || message.metadata.reimbursement?.reference) ? (
            <div className="mt-1 text-green-600">
              {message.metadata.reimbursement?.method || "Method not specified"}
              {message.metadata.reimbursement?.reference ? ` · Ref ${message.metadata.reimbursement.reference}` : ""}
            </div>
          ) : null}
          {message.metadata.reimbursement?.note ? (
            <div className="mt-1 text-green-600">{message.metadata.reimbursement.note}</div>
          ) : null}
        </div>
      ) : null}
      {status === "reconciled" ? (
        <p className="mt-3 text-sm font-medium text-sky-700">
          Reconciled{message.metadata.reconciledByName ? ` by ${message.metadata.reconciledByName}` : ""}.
        </p>
      ) : null}
    </motion.div>
  );
}

export function ReportMessageCard({ message }) {
  return (
    <motion.div layout className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h4 className="text-lg font-bold text-slate-900">Finance + Warehouse Summary</h4>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {message.metadata.metrics.map((metric) => (
          <div key={metric.label} className="rounded-2xl bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{metric.label}</p>
            <p className="mt-2 text-lg font-bold text-slate-900">{metric.value}</p>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

export function LinkedWorkMessageCard({ message, financeMode = false }) {
  const linkedWork = message?.metadata?.linkedWork;
  if (!linkedWork) {
    return null;
  }

  const accent = linkedWork.kind === "project"
    ? financeMode ? "rgba(59,130,246,0.18)" : "rgba(59,130,246,0.12)"
    : financeMode ? "rgba(245,158,11,0.2)" : "rgba(245,158,11,0.12)";
  const border = linkedWork.kind === "project"
    ? financeMode ? "rgba(96,165,250,0.32)" : "rgba(59,130,246,0.22)"
    : financeMode ? "rgba(251,191,36,0.32)" : "rgba(245,158,11,0.22)";
  const statusLabel = linkedWork.kind === "project"
    ? linkedWork.status === "planning"
      ? "Planning"
      : linkedWork.status === "active"
        ? "Active"
        : linkedWork.status === "completed"
          ? "Completed"
          : linkedWork.status || "Project"
    : linkedWork.status === "todo"
      ? "Todo"
      : linkedWork.status === "doing"
        ? "In progress"
        : linkedWork.status === "done"
          ? "Done"
          : linkedWork.status || "Task";

  return (
    <div
      className="max-w-[620px] rounded-2xl px-4 py-3"
      style={{
        background: accent,
        border: `1px solid ${border}`
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${financeMode ? "text-slate-300" : "text-slate-500"}`}>
            {linkedWork.kind === "project"
              ? linkedWork.action === "attached"
                ? "Attached project"
                : "Linked project"
              : "Linked task"}
          </p>
          <p className={`mt-1 text-sm font-semibold ${financeMode ? "text-slate-50" : "text-slate-900"}`}>{linkedWork.title}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${financeMode ? "bg-white/10 text-slate-100" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>
          {statusLabel}
        </span>
      </div>
      <p className={`mt-2 text-sm leading-6 ${financeMode ? "text-slate-300" : "text-slate-600"}`}>{message.content}</p>
      <p className={`mt-2 text-xs ${financeMode ? "text-slate-400" : "text-slate-400"}`}>{formatTime(message.createdAt)}</p>
    </div>
  );
}

