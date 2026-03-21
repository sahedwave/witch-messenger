import { useEffect, useState } from "react";

import {
  bucketEntries,
  downloadCsvFile,
  formatMoney,
  formatMoneyDisplay
} from "../WorkspaceMessenger.utils.js";
import {
  FinanceBalanceSheetPanel,
  FinanceCurrencyBreakdown
} from "./FinanceSummaryPanels.jsx";

export default function FinanceAdvancedReportsPanel({
  workspaceDefaultCurrency = "USD",
  financeSummary = null,
  financeTaxSummary = null,
  financeProfitLossReport = null,
  financeCashFlowReport = null,
  financeAgedReceivablesReport = null,
  financeBalanceSheetReport = null,
  onLoadFinanceTaxSummary = null,
  onLoadFinanceProfitLossReport = null,
  onLoadFinanceCashFlowReport = null,
  onLoadFinanceAgedReceivablesReport = null,
  onLoadFinanceBalanceSheetReport = null
}) {
  const [taxFilters, setTaxFilters] = useState({ startDate: "", endDate: "" });
  const [cashFlowFilters, setCashFlowFilters] = useState({ startDate: "", endDate: "" });
  const [agedFilters, setAgedFilters] = useState({ startDate: "", endDate: "" });
  const [profitLossPeriod, setProfitLossPeriod] = useState(financeProfitLossReport?.period || "month");
  const [loadingKey, setLoadingKey] = useState("");

  useEffect(() => {
    if (financeProfitLossReport?.period) {
      setProfitLossPeriod(financeProfitLossReport.period);
    }
  }, [financeProfitLossReport?.period]);

  const normalizedBaseCurrency = workspaceDefaultCurrency || "USD";

  async function refreshReport(key, loader, options = {}) {
    if (!loader) {
      return;
    }

    setLoadingKey(key);
    try {
      await loader(options);
    } finally {
      setLoadingKey("");
    }
  }

  const taxNetApproximate = Number(financeTaxSummary?.normalizedApproximate?.net || 0);
  const taxNetTone = taxNetApproximate >= 0 ? "text-emerald-300" : "text-rose-300";

  return (
    <div className="finance-reports-panel mt-6 grid gap-6">
      <div className="grid gap-6 xl:grid-cols-2">
        <div
          className="rounded-[24px] p-5"
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            background: "linear-gradient(180deg,#111827 0%,#10192a 100%)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.28)"
          }}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">Tax summary</div>
              <h3 className="mt-2 text-xl font-bold text-white">Collected, paid, and net tax</h3>
              <p className="mt-2 text-sm text-slate-400">Lightweight VAT/GST visibility without leaving Finance.</p>
            </div>
            <button
              type="button"
              onClick={() =>
                downloadCsvFile("finance-tax-summary.csv", [
                  ["Type", "Currency", "Amount"],
                  ...bucketEntries(financeTaxSummary?.collected || {}).map(([currency, amount]) => ["Collected", currency, amount]),
                  ...bucketEntries(financeTaxSummary?.paid || {}).map(([currency, amount]) => ["Paid", currency, amount]),
                  ...bucketEntries(financeTaxSummary?.net || {}).map(([currency, amount]) => ["Net", currency, amount])
                ])
              }
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200"
            >
              Export CSV
            </button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Start date</span>
              <input
                type="date"
                value={taxFilters.startDate}
                onChange={(event) => setTaxFilters((current) => ({ ...current, startDate: event.target.value }))}
                className="mt-2 w-full rounded-[14px] border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-slate-100 outline-none"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">End date</span>
              <input
                type="date"
                value={taxFilters.endDate}
                onChange={(event) => setTaxFilters((current) => ({ ...current, endDate: event.target.value }))}
                className="mt-2 w-full rounded-[14px] border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-slate-100 outline-none"
              />
            </label>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => refreshReport("tax", onLoadFinanceTaxSummary, { ...taxFilters, baseCurrency: normalizedBaseCurrency })}
              className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-300"
            >
              {loadingKey === "tax" ? "Refreshing..." : "Refresh tax summary"}
            </button>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Collected</div>
              <div className="mt-2 text-sm font-semibold text-emerald-300">
                approx. {formatMoney(financeTaxSummary?.normalizedApproximate?.collected || 0, normalizedBaseCurrency)}
              </div>
              <div className="mt-2"><FinanceCurrencyBreakdown bucket={financeTaxSummary?.collected || {}} /></div>
            </div>
            <div className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Paid</div>
              <div className="mt-2 text-sm font-semibold text-sky-300">
                approx. {formatMoney(financeTaxSummary?.normalizedApproximate?.paid || 0, normalizedBaseCurrency)}
              </div>
              <div className="mt-2"><FinanceCurrencyBreakdown bucket={financeTaxSummary?.paid || {}} /></div>
            </div>
            <div className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Net position</div>
              <div className={`mt-2 text-sm font-semibold ${taxNetTone}`}>
                approx. {formatMoney(taxNetApproximate, normalizedBaseCurrency)}
              </div>
              <div className="mt-2"><FinanceCurrencyBreakdown bucket={financeTaxSummary?.net || {}} /></div>
            </div>
          </div>
        </div>

        <div
          className="rounded-[24px] p-5"
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            background: "linear-gradient(180deg,#111827 0%,#10192a 100%)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.28)"
          }}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">Profit and loss</div>
              <h3 className="mt-2 text-xl font-bold text-white">Profitability over time</h3>
              <p className="mt-2 text-sm text-slate-400">Revenue, approved expenses, and gross profit grouped by period.</p>
            </div>
            <button
              type="button"
              onClick={() =>
                downloadCsvFile("finance-profit-loss.csv", [
                  ["Period", "Kind", "Currency", "Amount"],
                  ...(financeProfitLossReport?.rows || []).flatMap((row) => [
                    ...bucketEntries(row.revenue || {}).map(([currency, amount]) => [row.periodKey, "Revenue", currency, amount]),
                    ...bucketEntries(row.expenses || {}).map(([currency, amount]) => [row.periodKey, "Expenses", currency, amount]),
                    ...bucketEntries(row.grossProfit || {}).map(([currency, amount]) => [row.periodKey, "Gross profit", currency, amount])
                  ])
                ])
              }
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200"
            >
              Export CSV
            </button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Period</span>
              <select
                value={profitLossPeriod}
                onChange={(event) => setProfitLossPeriod(event.target.value)}
                className="mt-2 rounded-[14px] border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-slate-100 outline-none"
              >
                <option value="month">Month</option>
                <option value="quarter">Quarter</option>
                <option value="year">Year</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => refreshReport("profit-loss", onLoadFinanceProfitLossReport, { period: profitLossPeriod, baseCurrency: normalizedBaseCurrency })}
              className="mt-6 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-300"
            >
              {loadingKey === "profit-loss" ? "Refreshing..." : "Refresh P&L"}
            </button>
          </div>
          <div className="mt-5 rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Approx. gross profit</div>
            <div className="mt-2 text-lg font-semibold text-emerald-300">
              {formatMoney(financeProfitLossReport?.normalizedTotals?.grossProfit || 0, normalizedBaseCurrency)}
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {(financeProfitLossReport?.rows || []).length ? (
              financeProfitLossReport.rows.map((row) => (
                <div key={`pl-${row.periodKey}`} className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-100">{row.periodKey}</div>
                    <div className="text-xs text-emerald-300">
                      approx. {formatMoney(row.normalizedApproximateGrossProfit?.amount || 0, row.normalizedApproximateGrossProfit?.baseCurrency || normalizedBaseCurrency)}
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Revenue</div>
                      <div className="mt-2"><FinanceCurrencyBreakdown bucket={row.revenue || {}} /></div>
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Expenses</div>
                      <div className="mt-2"><FinanceCurrencyBreakdown bucket={row.expenses || {}} /></div>
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Gross profit</div>
                      <div className="mt-2"><FinanceCurrencyBreakdown bucket={row.grossProfit || {}} /></div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4 text-sm text-slate-400">
                No profit and loss data is available yet.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div
          className="rounded-[24px] p-5"
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            background: "linear-gradient(180deg,#111827 0%,#10192a 100%)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.28)"
          }}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">Cash flow</div>
              <h3 className="mt-2 text-xl font-bold text-white">Cash in vs cash out</h3>
              <p className="mt-2 text-sm text-slate-400">Track incoming payments against reimbursed or reconciled expense outflows.</p>
            </div>
            <button
              type="button"
              onClick={() =>
                downloadCsvFile("finance-cash-flow.csv", [
                  ["Period", "Kind", "Currency", "Amount"],
                  ...(financeCashFlowReport?.rows || []).flatMap((row) => [
                    ...bucketEntries(row.cashIn || {}).map(([currency, amount]) => [row.periodKey, "Cash in", currency, amount]),
                    ...bucketEntries(row.cashOut || {}).map(([currency, amount]) => [row.periodKey, "Cash out", currency, amount]),
                    ...bucketEntries(row.netCashFlow || {}).map(([currency, amount]) => [row.periodKey, "Net cash flow", currency, amount])
                  ])
                ])
              }
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200"
            >
              Export CSV
            </button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Start date</span>
              <input
                type="date"
                value={cashFlowFilters.startDate}
                onChange={(event) => setCashFlowFilters((current) => ({ ...current, startDate: event.target.value }))}
                className="mt-2 w-full rounded-[14px] border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-slate-100 outline-none"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">End date</span>
              <input
                type="date"
                value={cashFlowFilters.endDate}
                onChange={(event) => setCashFlowFilters((current) => ({ ...current, endDate: event.target.value }))}
                className="mt-2 w-full rounded-[14px] border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-slate-100 outline-none"
              />
            </label>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => refreshReport("cash-flow", onLoadFinanceCashFlowReport, { period: "month", ...cashFlowFilters, baseCurrency: normalizedBaseCurrency })}
              className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-300"
            >
              {loadingKey === "cash-flow" ? "Refreshing..." : "Refresh cash flow"}
            </button>
          </div>
          <div className="mt-5 rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Approx. net cash flow</div>
            <div className={`mt-2 text-lg font-semibold ${(Number(financeCashFlowReport?.normalizedTotals?.netCashFlow || 0) >= 0) ? "text-emerald-300" : "text-rose-300"}`}>
              {formatMoney(financeCashFlowReport?.normalizedTotals?.netCashFlow || 0, normalizedBaseCurrency)}
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {(financeCashFlowReport?.rows || []).length ? (
              financeCashFlowReport.rows.map((row) => (
                <div key={`cf-${row.periodKey}`} className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-100">{row.periodKey}</div>
                    <div className="text-xs text-slate-400">
                      approx. {formatMoney(row.normalizedApproximateNetCashFlow?.amount || 0, row.normalizedApproximateNetCashFlow?.baseCurrency || normalizedBaseCurrency)}
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Cash in</div>
                      <div className="mt-2"><FinanceCurrencyBreakdown bucket={row.cashIn || {}} /></div>
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Cash out</div>
                      <div className="mt-2"><FinanceCurrencyBreakdown bucket={row.cashOut || {}} /></div>
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Net</div>
                      <div className="mt-2"><FinanceCurrencyBreakdown bucket={row.netCashFlow || {}} /></div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4 text-sm text-slate-400">
                No cash flow data is available yet.
              </div>
            )}
          </div>
        </div>

        <div
          className="rounded-[24px] p-5"
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            background: "linear-gradient(180deg,#111827 0%,#10192a 100%)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.28)"
          }}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">Aged receivables</div>
              <h3 className="mt-2 text-xl font-bold text-white">Outstanding invoice aging</h3>
              <p className="mt-2 text-sm text-slate-400">See open receivables grouped by age bucket and customer concentration.</p>
            </div>
            <button
              type="button"
              onClick={() =>
                downloadCsvFile("finance-aged-receivables.csv", [
                  ["Customer", "Bucket", "Currency", "Amount"],
                  ...(financeAgedReceivablesReport?.customers || []).flatMap((customer) =>
                    Object.entries(customer.buckets || {}).flatMap(([bucketKey, bucket]) =>
                      bucketEntries(bucket || {}).map(([currency, amount]) => [customer.name, bucketKey, currency, amount])
                    )
                  )
                ])
              }
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200"
            >
              Export CSV
            </button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Start date</span>
              <input
                type="date"
                value={agedFilters.startDate}
                onChange={(event) => setAgedFilters((current) => ({ ...current, startDate: event.target.value }))}
                className="mt-2 w-full rounded-[14px] border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-slate-100 outline-none"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">End date</span>
              <input
                type="date"
                value={agedFilters.endDate}
                onChange={(event) => setAgedFilters((current) => ({ ...current, endDate: event.target.value }))}
                className="mt-2 w-full rounded-[14px] border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-slate-100 outline-none"
              />
            </label>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => refreshReport("aged", onLoadFinanceAgedReceivablesReport, { ...agedFilters, baseCurrency: normalizedBaseCurrency })}
              className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-300"
            >
              {loadingKey === "aged" ? "Refreshing..." : "Refresh aged receivables"}
            </button>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {Object.entries(financeAgedReceivablesReport?.buckets || {}).map(([bucketKey, bucket]) => (
              <div key={`aged-${bucketKey}`} className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{bucketKey.replace(/_/g, "-")} days</div>
                <div className="mt-2 text-sm text-amber-200">
                  approx. {formatMoney(financeAgedReceivablesReport?.normalizedTotals?.byBucket?.[bucketKey] || 0, normalizedBaseCurrency)}
                </div>
                <div className="mt-2"><FinanceCurrencyBreakdown bucket={bucket || {}} /></div>
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-3">
            {(financeAgedReceivablesReport?.customers || []).slice(0, 6).map((customer) => (
              <div key={`aged-customer-${customer.name}`} className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-100">{customer.name}</div>
                  <div className="text-xs text-amber-200">{formatMoneyDisplay(customer.totalOutstanding || {})}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <FinanceBalanceSheetPanel
        workspaceDefaultCurrency={workspaceDefaultCurrency}
        financeBalanceSheetReport={financeBalanceSheetReport}
        onLoadFinanceBalanceSheetReport={onLoadFinanceBalanceSheetReport}
      />
    </div>
  );
}

