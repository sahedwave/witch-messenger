import { useEffect, useState } from "react";

import { FINANCE_CURRENCY_OPTIONS } from "../WorkspaceMessenger.constants.js";
import { formatDate, formatMoney, roundMoney, todayDateInputValue } from "../WorkspaceMessenger.utils.js";

export default function FinancePayrollPanel({
  workspaceDefaultCurrency = "USD",
  payrollRecords = [],
  canManage = false,
  onCreatePayrollRecord = null,
  onApprovePayrollRecord = null,
  onPayPayrollRecord = null,
  onCancelPayrollRecord = null
}) {
  const [draft, setDraft] = useState({
    employeeName: "",
    employeeId: "",
    payPeriodStart: todayDateInputValue(),
    payPeriodEnd: todayDateInputValue(),
    grossAmount: "",
    currency: workspaceDefaultCurrency || "USD",
    deductions: [{ label: "Tax", amount: "" }],
    notes: ""
  });
  const [paymentDrafts, setPaymentDrafts] = useState({});
  const [submittingKey, setSubmittingKey] = useState("");

  useEffect(() => {
    setDraft((current) => ({
      ...current,
      currency: current.currency || workspaceDefaultCurrency || "USD"
    }));
  }, [workspaceDefaultCurrency]);

  const normalizedDeductions = draft.deductions
    .map((entry) => ({
      label: String(entry.label || "").trim(),
      amount: Number(entry.amount || 0)
    }))
    .filter((entry) => entry.label && Number.isFinite(entry.amount) && entry.amount >= 0);
  const netAmount = roundMoney(Math.max(0, Number(draft.grossAmount || 0) - normalizedDeductions.reduce((sum, entry) => sum + entry.amount, 0)));

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
      <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">Payroll</div>
        <h3 className="mt-2 text-xl font-bold text-white">Employee pay runs</h3>
        <div className="mt-4 space-y-3">
          {payrollRecords.length ? payrollRecords.map((record) => (
            <div key={record.id} className="rounded-[18px] border border-white/8 bg-slate-950/40 px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">{record.employeeName}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {formatDate(record.payPeriodStart)} to {formatDate(record.payPeriodEnd)}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-200">
                      {record.status}
                    </span>
                    {record.linkedExpense ? (
                      <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-[10px] font-semibold text-emerald-200">
                        Expense {formatMoney(record.linkedExpense.amount || 0, record.linkedExpense.currency || record.currency)}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-emerald-300">{formatMoney(record.netAmount || 0, record.currency || workspaceDefaultCurrency)}</div>
                  <div className="mt-1 text-xs text-slate-500">Gross {formatMoney(record.grossAmount || 0, record.currency || workspaceDefaultCurrency)}</div>
                </div>
              </div>
              {canManage ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {record.status === "draft" ? (
                    <button
                      type="button"
                      onClick={async () => {
                        setSubmittingKey(`approve-${record.id}`);
                        try {
                          await onApprovePayrollRecord?.(record.id);
                        } finally {
                          setSubmittingKey("");
                        }
                      }}
                      className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-200"
                    >
                      {submittingKey === `approve-${record.id}` ? "Approving..." : "Approve"}
                    </button>
                  ) : null}
                  {record.status === "approved" ? (
                    <>
                      <input
                        value={paymentDrafts[record.id]?.paymentMethod || ""}
                        onChange={(event) => setPaymentDrafts((current) => ({
                          ...current,
                          [record.id]: {
                            ...current[record.id],
                            paymentMethod: event.target.value
                          }
                        }))}
                        placeholder="Payment method"
                        className="rounded-[12px] border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100 outline-none"
                      />
                      <input
                        value={paymentDrafts[record.id]?.paymentReference || ""}
                        onChange={(event) => setPaymentDrafts((current) => ({
                          ...current,
                          [record.id]: {
                            ...current[record.id],
                            paymentReference: event.target.value
                          }
                        }))}
                        placeholder="Reference"
                        className="rounded-[12px] border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-100 outline-none"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          setSubmittingKey(`pay-${record.id}`);
                          try {
                            await onPayPayrollRecord?.(record.id, paymentDrafts[record.id] || {});
                          } finally {
                            setSubmittingKey("");
                          }
                        }}
                        className="rounded-full border border-sky-400/20 bg-sky-500/10 px-4 py-2 text-xs font-semibold text-sky-200"
                      >
                        {submittingKey === `pay-${record.id}` ? "Paying..." : "Mark paid"}
                      </button>
                    </>
                  ) : null}
                  {["draft", "approved"].includes(record.status) ? (
                    <button
                      type="button"
                      onClick={async () => {
                        setSubmittingKey(`cancel-${record.id}`);
                        try {
                          await onCancelPayrollRecord?.(record.id);
                        } finally {
                          setSubmittingKey("");
                        }
                      }}
                      className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200"
                    >
                      {submittingKey === `cancel-${record.id}` ? "Cancelling..." : "Cancel"}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )) : (
            <div className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4 text-sm text-slate-400">
              No payroll records yet.
            </div>
          )}
        </div>
      </div>

      <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">New payroll record</div>
        <form
          className="mt-4 grid gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!onCreatePayrollRecord) {
              return;
            }
            setSubmittingKey("payroll-create");
            try {
              const created = await onCreatePayrollRecord({
                ...draft,
                deductions: normalizedDeductions
              });
              if (created?.id) {
                setDraft({
                  employeeName: "",
                  employeeId: "",
                  payPeriodStart: todayDateInputValue(),
                  payPeriodEnd: todayDateInputValue(),
                  grossAmount: "",
                  currency: workspaceDefaultCurrency || "USD",
                  deductions: [{ label: "Tax", amount: "" }],
                  notes: ""
                });
              }
            } finally {
              setSubmittingKey("");
            }
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <input value={draft.employeeName} onChange={(event) => setDraft((current) => ({ ...current, employeeName: event.target.value }))} placeholder="Employee name" className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 outline-none" />
            <input value={draft.employeeId} onChange={(event) => setDraft((current) => ({ ...current, employeeId: event.target.value }))} placeholder="Employee ID" className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 outline-none" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <input type="date" value={draft.payPeriodStart} onChange={(event) => setDraft((current) => ({ ...current, payPeriodStart: event.target.value }))} className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 outline-none" />
            <input type="date" value={draft.payPeriodEnd} onChange={(event) => setDraft((current) => ({ ...current, payPeriodEnd: event.target.value }))} className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 outline-none" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <input type="number" step="0.01" value={draft.grossAmount} onChange={(event) => setDraft((current) => ({ ...current, grossAmount: event.target.value }))} placeholder="Gross amount" className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 outline-none" />
            <select value={draft.currency} onChange={(event) => setDraft((current) => ({ ...current, currency: event.target.value }))} className="rounded-[14px] border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-100 outline-none">
              {FINANCE_CURRENCY_OPTIONS.map((currency) => <option key={`payroll-currency-${currency}`} value={currency}>{currency}</option>)}
            </select>
          </div>
          <div className="rounded-[18px] border border-white/8 bg-slate-950/40 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Deductions</div>
            <div className="mt-3 space-y-3">
              {draft.deductions.map((entry, index) => (
                <div key={`payroll-deduction-${index}`} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px_auto]">
                  <input value={entry.label} onChange={(event) => setDraft((current) => ({ ...current, deductions: current.deductions.map((row, rowIndex) => rowIndex === index ? { ...row, label: event.target.value } : row) }))} placeholder="Tax" className="rounded-[12px] border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none" />
                  <input type="number" step="0.01" value={entry.amount} onChange={(event) => setDraft((current) => ({ ...current, deductions: current.deductions.map((row, rowIndex) => rowIndex === index ? { ...row, amount: event.target.value } : row) }))} placeholder="0.00" className="rounded-[12px] border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none" />
                  <button type="button" onClick={() => setDraft((current) => ({ ...current, deductions: current.deductions.filter((_, rowIndex) => rowIndex !== index) || [] }))} className="rounded-[12px] border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200">Remove</button>
                </div>
              ))}
              <button type="button" onClick={() => setDraft((current) => ({ ...current, deductions: [...current.deductions, { label: "", amount: "" }] }))} className="rounded-[12px] border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200">
                Add deduction
              </button>
            </div>
          </div>
          <div className="rounded-[18px] border border-emerald-400/20 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-100">
            Net amount: <strong>{formatMoney(netAmount, draft.currency || workspaceDefaultCurrency)}</strong>
          </div>
          <textarea rows={3} value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Notes" className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 outline-none" />
          <button type="submit" disabled={!canManage} className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-300 disabled:opacity-60">
            {submittingKey === "payroll-create" ? "Saving..." : "Create payroll record"}
          </button>
        </form>
      </div>
    </div>
  );
}

