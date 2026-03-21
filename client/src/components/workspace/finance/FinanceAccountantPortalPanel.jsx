import { formatDate, formatMoneyDisplay } from "../WorkspaceMessenger.utils.js";

export default function FinanceAccountantPortalPanel({
  accountantSummary = null,
  canExport = false
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.92fr)]">
      <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">Accountant portal</div>
            <h3 className="mt-2 text-xl font-bold text-white">Read-only books review</h3>
          </div>
          {canExport ? (
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold text-slate-300">Exports available</span>
          ) : null}
        </div>
        <div className="mt-4 space-y-3">
          {(accountantSummary?.journals || []).slice(0, 12).map((entry) => (
            <div key={entry.id || entry.entryNumber} className="rounded-[18px] border border-white/8 bg-slate-950/40 px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">{entry.entryNumber || entry.description || "Journal entry"}</div>
                  <div className="mt-1 text-xs text-slate-500">{entry.description || "Accounting journal"} · {formatDate(entry.postingDate || entry.createdAt)}</div>
                </div>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-200">
                  {entry.status || "posted"}
                </span>
              </div>
            </div>
          ))}
          {!accountantSummary?.journals?.length ? (
            <div className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4 text-sm text-slate-400">
              Accountant summary is available once recent journal activity is loaded.
            </div>
          ) : null}
        </div>
      </div>
      <div className="space-y-6">
        <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Tax summary</div>
          <div className="mt-4 grid gap-3">
            <div className="rounded-[18px] border border-white/8 bg-slate-950/40 px-4 py-4">
              <div className="text-xs text-slate-500">Collected</div>
              <div className="mt-2 text-sm text-emerald-200">{formatMoneyDisplay(accountantSummary?.taxSummary?.collected || {})}</div>
            </div>
            <div className="rounded-[18px] border border-white/8 bg-slate-950/40 px-4 py-4">
              <div className="text-xs text-slate-500">Paid</div>
              <div className="mt-2 text-sm text-sky-200">{formatMoneyDisplay(accountantSummary?.taxSummary?.paid || {})}</div>
            </div>
          </div>
        </div>
        <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Period close review</div>
          <div className="mt-4 space-y-3">
            {(accountantSummary?.closeReviewPeriods || []).map((period) => (
              <div key={period.periodKey} className="rounded-[18px] border border-white/8 bg-slate-950/40 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-white">{period.periodLabel || period.periodKey}</div>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-200">
                    {period.readinessStatus || period.status || "review"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

