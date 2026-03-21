import { motion } from "framer-motion";

import { formatMoney } from "../WorkspaceMessenger.utils.js";

export default function InvoicePaymentModal({ invoice, values, onChange, onClose, onSubmit, submitting = false }) {
  if (!invoice) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-30 flex justify-center p-2 sm:p-4"
      style={{ background: "rgba(2,6,23,0.72)", backdropFilter: "blur(8px)", overflowY: "auto", alignItems: "flex-start" }}
    >
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        transition={{ duration: 0.2 }}
        style={{
          width: "min(480px, calc(100vw - 16px))",
          borderRadius: 24,
          border: "1px solid rgba(255,255,255,0.1)",
          background: "linear-gradient(180deg,#111827 0%,#0f1623 100%)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.42)",
          padding: 16,
          maxHeight: "calc(100vh - 16px)",
          overflowY: "auto",
          margin: "auto 0"
        }}
      >
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">Record payment</div>
        <h3 style={{ margin: "6px 0 0", fontFamily: '"Sora","Manrope","DM Sans","Segoe UI",sans-serif', fontSize: 22, lineHeight: 1.2, fontWeight: 700, color: "#f8fafc" }}>
          {invoice.invoiceNumber}
        </h3>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Record a full or partial payment for {invoice.customerName || invoice.companyName || "this customer"} without losing the remaining balance.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-[16px] border border-white/10 bg-white/5 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Invoice total</div>
            <div className="mt-2 text-base font-semibold text-slate-100">{formatMoney(invoice.amount, invoice.currency)}</div>
          </div>
          <div className="rounded-[16px] border border-white/10 bg-white/5 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Already paid</div>
            <div className="mt-2 text-base font-semibold text-emerald-300">{formatMoney(invoice.paidAmount || 0, invoice.currency)}</div>
          </div>
          <div className="rounded-[16px] border border-white/10 bg-white/5 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Remaining</div>
            <div className="mt-2 text-base font-semibold text-amber-200">{formatMoney(invoice.outstandingAmount || 0, invoice.currency)}</div>
          </div>
        </div>

        <form
          className="mt-4 grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Payment Amount</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={values.amount || ""}
              onChange={(event) => onChange("amount", event.target.value)}
              placeholder={String(invoice.outstandingAmount || "")}
              className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500"
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Method</span>
              <select
                value={values.method || "bank_transfer"}
                onChange={(event) => onChange("method", event.target.value)}
                className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none"
              >
                <option value="bank_transfer">Bank transfer</option>
                <option value="card">Card</option>
                <option value="cash">Cash</option>
                <option value="mobile_wallet">Mobile wallet</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Reference</span>
              <input
                type="text"
                value={values.reference || ""}
                onChange={(event) => onChange("reference", event.target.value)}
                placeholder="TRX-2026-001"
                className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500"
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Note</span>
            <textarea
              rows={3}
              value={values.note || ""}
              onChange={(event) => onChange("note", event.target.value)}
              placeholder="Optional payment context for the finance team"
              className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="h-10 rounded-[12px] border border-white/10 bg-white/5 px-4 text-sm font-semibold text-slate-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="h-10 rounded-[12px] px-5 text-sm font-semibold text-white"
              style={{ background: "linear-gradient(135deg,#10b981,#059669)", boxShadow: "0 14px 28px rgba(5,150,105,0.24)" }}
            >
              {submitting ? "Saving..." : "Record Payment"}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

