import { motion } from "framer-motion";

import { FINANCE_CURRENCY_OPTIONS } from "../WorkspaceMessenger.constants.js";
import { computeTaxPreview, formatMoney, todayDateInputValue } from "../WorkspaceMessenger.utils.js";

export default function FinanceEntryModal({
  type,
  values,
  onChange,
  onFileChange,
  customerSuggestions = [],
  vendorSuggestions = [],
  categorySuggestions = [],
  onClose,
  onSubmit,
  submitting = false,
  workspaceDefaultCurrency = "USD"
}) {
  const isInvoice = type === "invoice";
  const isEditingInvoice = isInvoice && Boolean(values.invoiceId);
  const isEditingExpense = !isInvoice && Boolean(values.expenseId);
  const taxPreview = computeTaxPreview(values.amount, values.taxRate);
  const resolvedCurrency = values.currency || workspaceDefaultCurrency || "USD";
  const title = isInvoice
    ? isEditingInvoice
      ? "Edit Invoice"
      : "New Invoice"
    : isEditingExpense
      ? "Edit Expense"
      : "Log Expense";
  const description = isInvoice
    ? isEditingInvoice
      ? "Update the invoice details and save the changes back into FinanceBot."
      : "Create a finance invoice with the details your team needs to process next."
    : isEditingExpense
      ? "Update the expense details and save the changes back into FinanceBot."
      : "Log a new finance expense with category and note details.";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-30 flex justify-center p-2 sm:p-4"
      style={{
        background: "rgba(2,6,23,0.68)",
        backdropFilter: "blur(8px)",
        overflowY: "auto",
        alignItems: "flex-start"
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        transition={{ duration: 0.2 }}
        style={{
          width: "min(640px, calc(100vw - 16px))",
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
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">
          Finance entry
        </div>
        <h3
          style={{
            margin: "6px 0 0",
            fontFamily: '"Sora","Manrope","DM Sans","Segoe UI",sans-serif',
            fontSize: 22,
            lineHeight: 1.2,
            fontWeight: 700,
            color: "#f8fafc"
          }}
        >
          {title}
        </h3>
        <p className="mt-2 text-sm leading-5 text-slate-400">{description}</p>

        <form
          className="mt-3"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
          style={{
            display: "grid",
            gap: 12
          }}
        >
          {isInvoice ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Invoice Number</span>
                  <input
                    value={values.invoiceNumber || ""}
                    onChange={(event) => onChange("invoiceNumber", event.target.value.toUpperCase())}
                    placeholder="INV-501"
                    className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Amount</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={values.amount || ""}
                    onChange={(event) => onChange("amount", event.target.value)}
                    placeholder="9800"
                    className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500"
                  />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Customer Name</span>
                  <input
                    value={values.customerName || values.vendorName || ""}
                    onChange={(event) => onChange("customerName", event.target.value)}
                    placeholder="Northwind Labs"
                    className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Due Date</span>
                  <input
                    type="date"
                    value={values.dueDate || ""}
                    onChange={(event) => onChange("dueDate", event.target.value)}
                    className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none"
                  />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Customer Email</span>
                  <input
                    type="email"
                    value={values.customerEmail || ""}
                    onChange={(event) => onChange("customerEmail", event.target.value)}
                    placeholder="billing@northwind.com"
                    className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Currency</span>
                  <select
                    value={resolvedCurrency}
                    onChange={(event) => onChange("currency", event.target.value)}
                    className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none"
                  >
                    {FINANCE_CURRENCY_OPTIONS.map((currency) => (
                      <option key={`invoice-currency-${currency}`} value={currency}>
                        {currency}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Recurring Invoice</span>
                  <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
                    <button
                      type="button"
                      onClick={() => onChange("recurringEnabled", !values.recurringEnabled)}
                      className="rounded-[14px] border border-white/10 bg-white/5 px-3 py-2.5 text-xs font-semibold text-slate-200"
                    >
                      {values.recurringEnabled ? "Enabled" : "Off"}
                    </button>
                    <select
                      value={values.recurringFrequency || "monthly"}
                      onChange={(event) => onChange("recurringFrequency", event.target.value)}
                      disabled={!values.recurringEnabled}
                      className="rounded-[14px] border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-slate-100 outline-none disabled:opacity-60"
                    >
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                      <option value="quarterly">Quarterly</option>
                    </select>
                  </div>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Note</span>
                  <textarea
                    rows={2}
                    value={values.note || ""}
                    onChange={(event) => onChange("note", event.target.value)}
                    placeholder="Extra billing context or internal note"
                    className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500"
                  />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)]">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Tax rate %</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={values.taxRate || "0"}
                    onChange={(event) => onChange("taxRate", event.target.value)}
                    className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Tax label</span>
                  <input
                    value={values.taxLabel || "Tax"}
                    onChange={(event) => onChange("taxLabel", event.target.value)}
                    placeholder="Tax / VAT / GST"
                    className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500"
                  />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Subtotal</div>
                  <div className="mt-2 font-semibold text-slate-100">{formatMoney(taxPreview.subtotal, resolvedCurrency)}</div>
                </div>
                <div className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{values.taxLabel || "Tax"}</div>
                  <div className="mt-2 font-semibold text-slate-100">{formatMoney(taxPreview.taxAmount, resolvedCurrency)}</div>
                </div>
                <div className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Total</div>
                  <div className="mt-2 font-semibold text-slate-100">{formatMoney(taxPreview.totalWithTax, resolvedCurrency)}</div>
                </div>
              </div>
              {customerSuggestions.length ? (
                <div>
                  <div className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Recent Customers</div>
                  <div className="flex flex-wrap gap-1.5">
                    {customerSuggestions.map((customer) => (
                      <button
                        key={`invoice-customer-${customer}`}
                        type="button"
                        onClick={() => onChange("customerName", customer)}
                        className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-300 transition hover:bg-white/10 hover:text-white"
                      >
                        {customer}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
                <label className="block min-w-0">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Attachment</span>
                  <input
                    type="file"
                    accept=".pdf,image/*"
                    onChange={(event) => onFileChange(event.target.files?.[0] || null)}
                    className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-300 outline-none file:mr-3 file:rounded-[10px] file:border-0 file:bg-emerald-500/20 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-emerald-300"
                  />
                </label>
                {values.attachment?.fileName ? (
                  <div className="rounded-[14px] border border-white/10 bg-white/5 px-3 py-2.5 text-xs text-slate-400">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Selected</div>
                    <div className="mt-1.5 break-words">{values.attachment.fileName}</div>
                  </div>
                ) : <div />}
              </div>
            </>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Amount</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={values.amount || ""}
                    onChange={(event) => onChange("amount", event.target.value)}
                    placeholder="450"
                    className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Currency</span>
                  <select
                    value={resolvedCurrency}
                    onChange={(event) => onChange("currency", event.target.value)}
                    className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none"
                  >
                    {FINANCE_CURRENCY_OPTIONS.map((currency) => (
                      <option key={`expense-currency-${currency}`} value={currency}>
                        {currency}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Category</span>
                  <input
                    value={values.category || ""}
                    onChange={(event) => onChange("category", event.target.value.toLowerCase())}
                    placeholder="supplies"
                    className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500"
                  />
                  {categorySuggestions.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {categorySuggestions.map((category) => (
                        <button
                          key={`expense-category-${category}`}
                          type="button"
                          onClick={() => onChange("category", category)}
                          className="rounded-full border px-2.5 py-1 text-xs font-semibold capitalize transition"
                          style={{
                            borderColor: values.category === category ? "rgba(16,185,129,0.4)" : "rgba(255,255,255,0.1)",
                            background: values.category === category ? "rgba(16,185,129,0.16)" : "rgba(255,255,255,0.05)",
                            color: values.category === category ? "#10b981" : "#cbd5e1"
                          }}
                        >
                          {category}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Expense Date</span>
                  <input
                    type="date"
                    value={values.expenseDate || todayDateInputValue()}
                    onChange={(event) => onChange("expenseDate", event.target.value)}
                    className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none"
                  />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Vendor Name</span>
                  <input
                    value={values.vendorName || ""}
                    onChange={(event) => onChange("vendorName", event.target.value)}
                    placeholder="Office Depot"
                    className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Vendor Email</span>
                  <input
                    type="email"
                    value={values.vendorEmail || ""}
                    onChange={(event) => onChange("vendorEmail", event.target.value)}
                    placeholder="accounts@officedepot.com"
                    className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500"
                  />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)]">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Tax rate %</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={values.taxRate || "0"}
                    onChange={(event) => onChange("taxRate", event.target.value)}
                    className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Tax label</span>
                  <input
                    value={values.taxLabel || "Tax"}
                    onChange={(event) => onChange("taxLabel", event.target.value)}
                    placeholder="Tax / VAT / GST"
                    className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500"
                  />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Subtotal</div>
                  <div className="mt-2 font-semibold text-slate-100">{formatMoney(taxPreview.subtotal, resolvedCurrency)}</div>
                </div>
                <div className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{values.taxLabel || "Tax"}</div>
                  <div className="mt-2 font-semibold text-slate-100">{formatMoney(taxPreview.taxAmount, resolvedCurrency)}</div>
                </div>
                <div className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Total</div>
                  <div className="mt-2 font-semibold text-slate-100">{formatMoney(taxPreview.totalWithTax, resolvedCurrency)}</div>
                </div>
              </div>
              {vendorSuggestions.length ? (
                <div>
                  <div className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Recent Vendors</div>
                  <div className="flex flex-wrap gap-1.5">
                    {vendorSuggestions.map((vendor) => (
                      <button
                        key={`expense-vendor-${vendor}`}
                        type="button"
                        onClick={() => onChange("vendorName", vendor)}
                        className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-300 transition hover:bg-white/10 hover:text-white"
                      >
                        {vendor}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
                <label className="block min-w-0">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Note</span>
                  <textarea
                    rows={2}
                    value={values.note || ""}
                    onChange={(event) => onChange("note", event.target.value)}
                    placeholder="Packaging tape for outbound shipments"
                    className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500"
                  />
                </label>
                <div className="grid gap-3">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Receipt</span>
                    <input
                      type="file"
                      accept=".pdf,image/*"
                      onChange={(event) => onFileChange(event.target.files?.[0] || null)}
                      className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-300 outline-none file:mr-3 file:rounded-[10px] file:border-0 file:bg-sky-500/20 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-sky-300"
                    />
                  </label>
                  {values.receipt?.fileName ? (
                    <div className="rounded-[14px] border border-white/10 bg-white/5 px-3 py-2.5 text-xs text-slate-400">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Selected</div>
                      <div className="mt-1.5 break-words">{values.receipt.fileName}</div>
                    </div>
                  ) : null}
                </div>
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-1">
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
              style={{
                background: "linear-gradient(135deg,#10b981,#059669)",
                boxShadow: "0 14px 28px rgba(5,150,105,0.24)"
              }}
            >
              {submitting
                ? "Saving..."
                : isInvoice
                  ? isEditingInvoice
                    ? "Save Invoice"
                    : "Create Invoice"
                  : isEditingExpense
                    ? "Save Expense"
                    : "Log Expense"}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
