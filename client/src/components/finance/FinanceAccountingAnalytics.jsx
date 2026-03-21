import { useEffect, useState } from "react";

function formatDateTime(isoString) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(isoString));
}

function formatMoney(amount, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency
  }).format(Number.isFinite(Number(amount)) ? Number(amount) : 0);
}

function isCurrencyBucket(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatMoneyDisplay(value, currency = "USD") {
  if (isCurrencyBucket(value)) {
    const entries = Object.entries(value)
      .filter(([code, amount]) => code && Number.isFinite(Number(amount)))
      .sort(([left], [right]) => String(left).localeCompare(String(right)));

    if (entries.length === 0) {
      return formatMoney(0, currency);
    }

    if (entries.length === 1) {
      const [[singleCurrency, singleAmount]] = entries;
      return formatMoney(singleAmount, singleCurrency);
    }

    return entries
      .map(([code, amount]) => `${formatMoney(amount, code)} ${code}`)
      .join(" / ");
  }

  return formatMoney(value, currency);
}

function formatAccountingPeriodLabel(period = "all") {
  if (period === "30d") {
    return "Last 30 days";
  }

  if (period === "90d") {
    return "Last 90 days";
  }

  return "All time";
}

function formatAccountingReportVariantLabel(variant = "pack") {
  if (variant === "profit_and_loss") {
    return "P&L";
  }

  if (variant === "balance_snapshot") {
    return "Balance";
  }

  return "Statement pack";
}

function formatPeriodKeyLabel(periodKey = "") {
  if (!/^\d{4}-\d{2}$/.test(String(periodKey || ""))) {
    return periodKey || "Unknown period";
  }

  const [yearString, monthString] = String(periodKey).split("-");
  const year = Number(yearString);
  const monthIndex = Number(monthString) - 1;
  const date = new Date(Date.UTC(year, monthIndex, 1));

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function financeStatusBadgeStyle(tone = "neutral") {
  if (tone === "danger") {
    return {
      border: "1px solid rgba(239,68,68,0.25)",
      background: "rgba(239,68,68,0.12)",
      color: "#fca5a5"
    };
  }

  if (tone === "warning") {
    return {
      border: "1px solid rgba(245,158,11,0.25)",
      background: "rgba(245,158,11,0.12)",
      color: "#fcd34d"
    };
  }

  if (tone === "good") {
    return {
      border: "1px solid rgba(16,185,129,0.25)",
      background: "rgba(16,185,129,0.12)",
      color: "#6ee7b7"
    };
  }

  if (tone === "info") {
    return {
      border: "1px solid rgba(56,189,248,0.25)",
      background: "rgba(56,189,248,0.12)",
      color: "#7dd3fc"
    };
  }

  return {
    border: "1px solid rgba(148,163,184,0.24)",
    background: "rgba(148,163,184,0.12)",
    color: "#cbd5e1"
  };
}

function financeCloseReadinessTone(status = "attention") {
  if (status === "ready") {
    return "good";
  }

  if (status === "blocked") {
    return "danger";
  }

  return "warning";
}

function formatFinanceCloseReadinessLabel(status = "attention") {
  if (status === "ready") {
    return "Ready";
  }

  if (status === "blocked") {
    return "Blocked";
  }

  return "Attention";
}

function FinanceControlsPanel({
  controls = null,
  canManage = false,
  selectedPeriodKey = "",
  onSelectPeriod = null,
  onLockPeriod = null,
  onUnlockPeriod = null,
  actionLoading = "",
  recentJournalEntries = []
}) {
  const lockedPeriods = Array.isArray(controls?.lockedPeriods) ? controls.lockedPeriods : [];
  const recentActions = Array.isArray(controls?.recentActions) ? controls.recentActions : [];
  const closeReviewPeriods = Array.isArray(controls?.closeReviewPeriods) ? controls.closeReviewPeriods : [];
  const currentPeriodKey = controls?.currentPeriodKey || "";
  const blockedActionsCount = Number(controls?.blockedActionsCount || 0);
  const selectablePeriods = Array.from({ length: 6 }, (_, index) => {
    const date = new Date();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() - index);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const periodKey = `${year}-${month}`;
    return {
      key: periodKey,
      label: formatPeriodKeyLabel(periodKey)
    };
  });
  const activePeriodKey = selectedPeriodKey || currentPeriodKey || selectablePeriods[0]?.key || "";
  const activeLock = lockedPeriods.find((lock) => lock.periodKey === activePeriodKey) || null;
  const activeCloseReview = closeReviewPeriods.find((period) => period.periodKey === activePeriodKey) || null;
  const [showLockReview, setShowLockReview] = useState(false);
  const [lockReviewAcknowledged, setLockReviewAcknowledged] = useState(false);
  const [lockReviewNote, setLockReviewNote] = useState("");

  useEffect(() => {
    setShowLockReview(false);
    setLockReviewAcknowledged(false);
    setLockReviewNote("");
  }, [activePeriodKey, activeLock?.id]);

  function startLockReview() {
    if (!canManage || activeLock) {
      return;
    }

    setShowLockReview(true);
    setLockReviewAcknowledged(false);
  }

  function cancelLockReview() {
    setShowLockReview(false);
    setLockReviewAcknowledged(false);
    setLockReviewNote("");
  }

  function confirmLockReview() {
    if (!lockReviewAcknowledged || actionLoading !== "") {
      return;
    }

    onLockPeriod?.({
      periodKey: activePeriodKey,
      note: lockReviewNote.trim()
    });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
      <div
        className="rounded-[24px] p-5"
        style={{
          border: "1px solid rgba(255,255,255,0.08)",
          background: "linear-gradient(180deg,#111827 0%,#10192a 100%)",
          boxShadow: "0 12px 32px rgba(0,0,0,0.28)"
        }}
      >
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">Finance controls</div>
        <h3 className="mt-2 text-xl font-bold text-white">Period locks and posting safety</h3>
        <p className="mt-2 text-sm text-slate-400">
          A lightweight control layer for locking closed periods and keeping finance-changing actions traceable.
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {[
            ["Current period", controls?.currentPeriodLabel || formatPeriodKeyLabel(currentPeriodKey)],
            ["Locked periods", String(lockedPeriods.length)],
            ["Blocked actions", String(blockedActionsCount)]
          ].map(([label, value]) => (
            <div key={label} className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
              <div className="mt-3 text-sm font-semibold text-slate-100">{value}</div>
            </div>
          ))}
        </div>

        <div className="mt-5 rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Lock target</div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <select
              value={activePeriodKey}
              onChange={(event) => onSelectPeriod?.(event.target.value)}
              className="rounded-full border border-white/10 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-100 outline-none"
            >
              {selectablePeriods.map((period) => (
                <option key={period.key} value={period.key}>
                  {period.label}
                </option>
              ))}
            </select>
            {canManage ? (
              activeLock ? (
                <button
                  type="button"
                  onClick={() => onUnlockPeriod?.(activePeriodKey)}
                  disabled={actionLoading !== ""}
                  className="rounded-full border border-rose-400/30 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-200 transition disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {actionLoading === "unlock" ? "Unlocking..." : "Unlock period"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startLockReview}
                  disabled={actionLoading !== ""}
                  className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-200 transition disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {actionLoading === "lock" ? "Locking..." : "Review before lock"}
                </button>
              )
            ) : null}
          </div>
          <div className="mt-3 text-xs text-slate-500">
            {activeLock
              ? `${formatPeriodKeyLabel(activePeriodKey)} is locked. Posting changes for that period are currently blocked.`
              : activeCloseReview?.readinessStatus === "ready"
                ? `${formatPeriodKeyLabel(activePeriodKey)} looks ready to lock based on the current review snapshot.`
                : `${formatPeriodKeyLabel(activePeriodKey)} is open for finance posting changes.`}
          </div>
        </div>

        {showLockReview && !activeLock ? (
          <div className="mt-5 rounded-[18px] border border-emerald-400/20 bg-emerald-500/10 px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-300">Close review</div>
                <div className="mt-2 text-sm font-semibold text-slate-100">
                  Review {activeCloseReview?.periodLabel || formatPeriodKeyLabel(activePeriodKey)} before lock
                </div>
                <div className="mt-2 text-xs text-slate-400">
                  Locking this month will block posting-related finance changes dated inside that period until it is unlocked again.
                </div>
              </div>
              {activeCloseReview ? (
                <span
                  className="rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]"
                  style={financeStatusBadgeStyle(financeCloseReadinessTone(activeCloseReview.readinessStatus))}
                >
                  {formatFinanceCloseReadinessLabel(activeCloseReview.readinessStatus)}
                </span>
              ) : null}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {[
                ["Open items", String(activeCloseReview?.openItemsCount || 0)],
                ["Blocked records", String(activeCloseReview?.metrics?.blockedItems || 0)],
                ["Pending accounting", String(activeCloseReview?.metrics?.pendingAccountingItems || 0)]
              ].map(([label, value]) => (
                <div key={`review-${label}`} className="rounded-[14px] border border-white/8 bg-white/5 px-3 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
                  <div className="mt-2 text-lg font-bold text-slate-100">{value}</div>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-[14px] border border-white/8 bg-white/5 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">What lock will block</div>
              <div className="mt-2 text-sm text-slate-400">
                Approval changes, payment posting, reconciliation updates, and other accounting-affecting edits dated in {activeCloseReview?.periodLabel || formatPeriodKeyLabel(activePeriodKey)}.
              </div>
            </div>

            <div className="mt-4">
              <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Lock note</label>
              <textarea
                value={lockReviewNote}
                onChange={(event) => setLockReviewNote(event.target.value)}
                rows={3}
                maxLength={240}
                placeholder="Optional context for why this month is being locked."
                className="mt-2 w-full rounded-[14px] border border-white/8 bg-slate-950 px-3 py-3 text-sm text-slate-100 outline-none"
              />
            </div>

            <label className="mt-4 flex items-start gap-3 rounded-[14px] border border-white/8 bg-white/5 px-3 py-3">
              <input
                type="checkbox"
                checked={lockReviewAcknowledged}
                onChange={(event) => setLockReviewAcknowledged(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border border-white/20 bg-slate-950 text-emerald-400"
              />
              <span className="text-sm text-slate-300">
                I understand this will block posting-related finance changes for this month until it is unlocked again.
              </span>
            </label>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={confirmLockReview}
                disabled={!lockReviewAcknowledged || actionLoading !== ""}
                className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-200 transition disabled:cursor-not-allowed disabled:opacity-60"
              >
                {actionLoading === "lock" ? "Locking..." : `Confirm lock ${activeCloseReview?.periodLabel || formatPeriodKeyLabel(activePeriodKey)}`}
              </button>
              <button
                type="button"
                onClick={cancelLockReview}
                disabled={actionLoading !== ""}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-5 rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Period-close review</div>
              <div className="mt-2 text-sm font-semibold text-slate-100">
                {activeCloseReview?.periodLabel || formatPeriodKeyLabel(activePeriodKey)}
              </div>
              <div className="mt-2 text-xs text-slate-400">
                {activeCloseReview?.guidance || "Select a period to see what is still open before locking the month."}
              </div>
              <div className="mt-2 text-[11px] text-slate-500">
                Review is based on invoice due dates, expense dates, and accounting control state in the selected month.
              </div>
            </div>
            {activeCloseReview ? (
              <span
                className="rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]"
                style={financeStatusBadgeStyle(financeCloseReadinessTone(activeCloseReview.readinessStatus))}
              >
                {formatFinanceCloseReadinessLabel(activeCloseReview.readinessStatus)}
              </span>
            ) : null}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[
              ["Open before lock", String(activeCloseReview?.openItemsCount || 0)],
              ["Unpaid invoices", String(activeCloseReview?.metrics?.unpaidInvoices || 0)],
              ["Unreconciled invoices", String(activeCloseReview?.metrics?.unreconciledInvoices || 0)],
              ["Unreconciled expenses", String(activeCloseReview?.metrics?.unreconciledExpenses || 0)],
              ["Pending accounting", String(activeCloseReview?.metrics?.pendingAccountingItems || 0)],
              ["Blocked records", String(activeCloseReview?.metrics?.blockedItems || 0)]
            ].map(([label, value]) => (
              <div key={`${activePeriodKey}-${label}`} className="rounded-[14px] border border-white/8 bg-white/5 px-3 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
                <div className="mt-2 text-lg font-bold text-slate-100">{value}</div>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-[14px] border border-white/8 bg-white/5 px-3 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Top blockers in this month</div>
            <div className="mt-3 space-y-2">
              {activeCloseReview?.blockers?.length ? activeCloseReview.blockers.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-3 rounded-[12px] border border-white/8 bg-white/5 px-3 py-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">{item.label}</div>
                    <div className="mt-1 text-xs text-slate-500">{item.detail}</div>
                  </div>
                  <span
                    className="rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]"
                    style={financeStatusBadgeStyle(item.tone === "danger" ? "danger" : "warning")}
                  >
                    {item.type}
                  </span>
                </div>
              )) : (
                <div className="rounded-[12px] border border-white/8 bg-white/5 px-3 py-3 text-sm text-slate-400">
                  No open blockers are currently highlighted for this month.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {lockedPeriods.length ? lockedPeriods.map((lock) => (
            <div key={lock.id} className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-100">{lock.periodLabel || formatPeriodKeyLabel(lock.periodKey)}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    Locked {lock.lockedBy?.name ? `by ${lock.lockedBy.name}` : "for this workspace"} on {formatDateTime(lock.createdAt)}
                  </div>
                  {lock.note ? <div className="mt-2 text-xs text-slate-400">{lock.note}</div> : null}
                </div>
                {lock.periodKey === currentPeriodKey ? (
                  <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200">
                    Current month
                  </span>
                ) : null}
              </div>
            </div>
          )) : (
            <div className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4 text-sm text-slate-400">
              No accounting periods are locked yet.
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
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">Control activity</div>
        <h3 className="mt-2 text-xl font-bold text-white">Recent lock and safeguard events</h3>
        <p className="mt-2 text-sm text-slate-400">
          Recent finance control actions, including period locks, unlocks, and blocked posting attempts.
        </p>

        <div className="mt-5 space-y-3">
          {recentActions.length ? recentActions.map((action) => (
            <div key={action.id} className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-100">
                    {action.action === "locked"
                      ? "Period locked"
                      : action.action === "unlocked"
                        ? "Period unlocked"
                        : "Blocked finance action"}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {action.action === "blocked"
                      ? `${action.metadata?.attemptedAction || "posting change"} blocked for ${action.metadata?.lockedPeriodLabel || action.metadata?.lockedPeriodKey || "a locked period"}`
                      : `${action.metadata?.periodLabel || action.metadata?.periodKey || "Period"} · ${formatDateTime(action.createdAt)}`}
                  </div>
                  {action.performedBy?.name ? <div className="mt-2 text-xs text-slate-400">By {action.performedBy.name}</div> : null}
                </div>
                <span
                  className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                    action.action === "locked"
                      ? "border border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                      : action.action === "unlocked"
                        ? "border border-sky-400/30 bg-sky-500/10 text-sky-200"
                        : "border border-rose-400/30 bg-rose-500/10 text-rose-200"
                  }`}
                >
                  {action.action.replace(/_/g, " ")}
                </span>
              </div>
            </div>
          )) : (
            <div className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4 text-sm text-slate-400">
              No finance control activity has been recorded in this workspace yet.
            </div>
          )}
        </div>

        <div className="mt-5 rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Recent posting states</div>
          <div className="mt-3 space-y-2">
            {recentJournalEntries.length ? recentJournalEntries.slice(0, 3).map((entry) => (
              <div key={`control-journal-${entry.id}`} className="flex items-center justify-between gap-3 rounded-[14px] border border-white/8 bg-white/5 px-3 py-3">
                <div>
                  <div className="text-sm font-semibold text-slate-100">{entry.entryNumber}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {entry.description} · {formatDateTime(entry.postingDate || entry.createdAt)}
                  </div>
                </div>
                <span
                  className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                    entry.status === "voided"
                      ? "border border-amber-400/30 bg-amber-500/10 text-amber-200"
                      : "border border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                  }`}
                >
                  {entry.status === "voided" ? "Voided" : "Posted"}
                </span>
              </div>
            )) : (
              <div className="rounded-[14px] border border-white/8 bg-white/5 px-3 py-3 text-sm text-slate-400">
                Posted and voided journal states will appear here once new accounting activity flows through this workspace.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FinanceAccountingSnapshot({
  accountingSnapshot = null,
  recentJournalEntries = []
}) {
  const cards = [
    ["Revenue posted", accountingSnapshot?.revenuePosted || 0, "text-emerald-300"],
    ["Expenses posted", accountingSnapshot?.expensesPosted || 0, "text-sky-300"],
    ["A/R balance", accountingSnapshot?.accountsReceivableBalance || 0, "text-amber-200"],
    ["A/P balance", accountingSnapshot?.accountsPayableBalance || 0, "text-rose-300"],
    [
      "Cash position",
      accountingSnapshot?.cashPosition || 0,
      accountingSnapshot?.cashDirection === "outflow"
        ? "text-rose-300"
        : accountingSnapshot?.cashDirection === "inflow"
          ? "text-emerald-300"
          : "text-slate-200"
    ]
  ];

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
      <div
        className="rounded-[24px] p-5"
        style={{
          border: "1px solid rgba(255,255,255,0.08)",
          background: "linear-gradient(180deg,#111827 0%,#10192a 100%)",
          boxShadow: "0 12px 32px rgba(0,0,0,0.28)"
        }}
      >
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">Accounting snapshot</div>
        <h3 className="mt-2 text-xl font-bold text-white">Posted accounting view</h3>
        <p className="mt-2 text-sm text-slate-400">
          Lightweight visibility from the journal layer so owners and managers can trust what Finance is posting underneath the workflow.
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map(([label, value, tone]) => (
            <div key={label} className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
              <div className={`mt-3 text-2xl font-bold ${tone}`}>{formatMoneyDisplay(value)}</div>
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[
            ["Accounts", accountingSnapshot?.chartOfAccountsCount || 0],
            ["Posted entries", accountingSnapshot?.postedEntries || 0],
            ["Voided entries", accountingSnapshot?.voidedEntries || 0],
            ["Invoice accruals", accountingSnapshot?.invoiceAccrualEntries || 0],
            ["Invoice payments", accountingSnapshot?.invoicePaymentEntries || 0],
            ["Expense postings", (accountingSnapshot?.expenseAccrualEntries || 0) + (accountingSnapshot?.expensePaymentEntries || 0)]
          ].map(([label, value]) => (
            <div key={label} className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
              <div className="mt-3 text-2xl font-bold text-slate-100">{value}</div>
            </div>
          ))}
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
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">Recent journals</div>
        <h3 className="mt-2 text-xl font-bold text-white">Latest journal entries</h3>
        <p className="mt-2 text-sm text-slate-400">
          A compact recent-entry view to confirm invoice and expense postings without moving into a dedicated accounting console.
        </p>

        <div className="mt-5 space-y-3">
          {recentJournalEntries.length ? recentJournalEntries.map((entry) => (
            <div key={entry.id} className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-100">{entry.entryNumber}</div>
                  <div className="mt-1 text-xs text-slate-400">{entry.description}</div>
                  <div className="mt-2 text-xs text-slate-500">
                    {entry.entryType.replace(/_/g, " ")} · {formatDateTime(entry.postingDate || entry.createdAt)}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-xs font-semibold ${entry.status === "voided" ? "text-rose-300" : "text-emerald-300"}`}>
                    {entry.status}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{formatMoneyDisplay(entry.totalDebit || 0)} debits</div>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {(entry.lines || []).slice(0, 2).map((line, index) => (
                  <div key={`${entry.id}-line-${line.accountCode}-${index}`} className="flex items-center justify-between gap-3 rounded-[14px] border border-white/8 bg-white/5 px-3 py-2 text-xs text-slate-300">
                    <div>
                      <div className="font-semibold text-slate-100">{line.accountCode} · {line.accountName}</div>
                      <div className="mt-1 text-slate-500">{line.accountType}</div>
                    </div>
                    <div>{line.debit ? `Dr ${formatMoneyDisplay(line.debit)}` : `Cr ${formatMoneyDisplay(line.credit)}`}</div>
                  </div>
                ))}
              </div>
            </div>
          )) : (
            <div className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4 text-sm text-slate-400">
              Journal entries will appear here once invoice and expense posting starts flowing through this workspace.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FinanceStatementSnapshot({
  statements = null,
  reportingWindow = "all",
  onSelectAccount = null,
  selectedAccountCode = "",
  accountDrilldown = null,
  accountDrilldownLoading = false
}) {
  const profitAndLoss = statements?.profitAndLoss || {};
  const balanceSnapshot = statements?.balanceSnapshot || {};
  const accountBalances = Array.isArray(statements?.accountBalances) ? statements.accountBalances : [];
  const comparison = statements?.comparison || null;
  const periodLabel = formatAccountingPeriodLabel(reportingWindow);

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
      <div
        className="rounded-[24px] p-5"
        style={{
          border: "1px solid rgba(255,255,255,0.08)",
          background: "linear-gradient(180deg,#111827 0%,#10192a 100%)",
          boxShadow: "0 12px 32px rgba(0,0,0,0.28)"
        }}
      >
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">Statement view</div>
        <h3 className="mt-2 text-xl font-bold text-white">Profit and loss</h3>
        <p className="mt-2 text-sm text-slate-400">
          A simple statement-style view from posted accounting data so owners and managers can see profit direction without leaving Finance.
        </p>
        <div className="mt-3 inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-300">
          {periodLabel}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {[
            ["Revenue", profitAndLoss.revenue || 0, "text-emerald-300"],
            ["Expenses", profitAndLoss.expenses || 0, "text-sky-300"],
            [
              "Net result",
              profitAndLoss.netOperatingResult || 0,
              profitAndLoss.profitDirection === "loss"
                ? "text-rose-300"
                : profitAndLoss.profitDirection === "profit"
                  ? "text-emerald-300"
                  : "text-slate-200"
            ]
          ].map(([label, value, tone]) => (
            <div key={label} className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
              <div className={`mt-3 text-2xl font-bold ${tone}`}>{formatMoneyDisplay(value)}</div>
            </div>
          ))}
        </div>

        <div className="mt-5 rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Profit direction</div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-slate-100">
              {profitAndLoss.profitDirection === "profit"
                ? "Posted activity is currently profitable."
                : profitAndLoss.profitDirection === "loss"
                  ? "Posted activity is currently operating at a loss."
                  : "Posted activity is currently at break-even."}
            </div>
            <div
              className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${
                profitAndLoss.profitDirection === "profit"
                  ? "border border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                  : profitAndLoss.profitDirection === "loss"
                    ? "border border-rose-400/30 bg-rose-500/10 text-rose-300"
                    : "border border-white/10 bg-white/5 text-slate-300"
              }`}
            >
              {profitAndLoss.profitDirection || "breakeven"}
            </div>
          </div>
        </div>

        {comparison ? (
          <div className="mt-5 rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Period comparison</div>
            <div className="mt-1 text-xs text-slate-500">Compared with {comparison.previousPeriodLabel}</div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {[
                ["Revenue", comparison.revenue],
                ["Expenses", comparison.expenses],
                ["Net result", comparison.netOperatingResult]
              ].map(([label, metric]) => (
                <div key={label} className="rounded-[14px] border border-white/8 bg-white/5 px-3 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
                  <div className="mt-2 text-sm font-semibold text-slate-100">{formatMoneyDisplay(metric?.current || 0)}</div>
                  <div className="mt-1 text-xs text-slate-500">Prev {formatMoneyDisplay(metric?.previous || 0)}</div>
                  <div className={`mt-2 text-xs font-semibold ${metric?.direction === "up" ? "text-emerald-300" : metric?.direction === "down" ? "text-rose-300" : "text-slate-400"}`}>
                    {metric?.direction === "up" ? "+" : metric?.direction === "down" ? "" : ""}
                    {formatMoneyDisplay(metric?.delta || 0)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid gap-6">
        <div
          className="rounded-[24px] p-5"
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            background: "linear-gradient(180deg,#111827 0%,#10192a 100%)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.28)"
          }}
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">Statement view</div>
          <h3 className="mt-2 text-xl font-bold text-white">Balance snapshot</h3>
          <p className="mt-2 text-sm text-slate-400">
            A lightweight look at posted assets, liabilities, and a current equity placeholder from the accounting foundation.
          </p>
          <div className="mt-3 inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-300">
            {periodLabel}
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {[
              ["Cash", balanceSnapshot.cash || 0, "text-emerald-300"],
              ["A/R", balanceSnapshot.accountsReceivable || 0, "text-amber-200"],
              ["A/P", balanceSnapshot.accountsPayable || 0, "text-rose-300"],
              ["Equity", balanceSnapshot.equityPlaceholder || 0, "text-violet-300"],
              ["Total assets", balanceSnapshot.totalAssets || 0, "text-slate-100"],
              ["Total liabilities", balanceSnapshot.totalLiabilities || 0, "text-slate-100"]
            ].map(([label, value, tone]) => (
              <div key={label} className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
                <div className={`mt-3 text-2xl font-bold ${tone}`}>{formatMoneyDisplay(value)}</div>
              </div>
            ))}
          </div>

          {comparison ? (
            <div className="mt-5 rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Balance comparison</div>
              <div className="mt-1 text-xs text-slate-500">Compared with {comparison.previousPeriodLabel}</div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {[
                  ["Cash", comparison.cash],
                  ["A/R", comparison.accountsReceivable],
                  ["A/P", comparison.accountsPayable]
                ].map(([label, metric]) => (
                  <div key={label} className="rounded-[14px] border border-white/8 bg-white/5 px-3 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
                    <div className="mt-2 text-sm font-semibold text-slate-100">{formatMoneyDisplay(metric?.current || 0)}</div>
                    <div className="mt-1 text-xs text-slate-500">Prev {formatMoneyDisplay(metric?.previous || 0)}</div>
                    <div className={`mt-2 text-xs font-semibold ${metric?.direction === "up" ? "text-emerald-300" : metric?.direction === "down" ? "text-rose-300" : "text-slate-400"}`}>
                      {metric?.direction === "up" ? "+" : metric?.direction === "down" ? "" : ""}
                      {formatMoneyDisplay(metric?.delta || 0)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div
          className="rounded-[24px] p-5"
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            background: "linear-gradient(180deg,#111827 0%,#10192a 100%)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.28)"
          }}
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">Account balances</div>
          <h3 className="mt-2 text-xl font-bold text-white">Posted accounts</h3>
          <p className="mt-2 text-sm text-slate-400">
            Current posted balances by account, ready for deeper account-level drill-down later.
          </p>

          <div className="mt-5 space-y-3">
            {accountBalances.length ? accountBalances.slice(0, 8).map((account) => (
              <button
                key={account.code}
                type="button"
                onClick={() => onSelectAccount?.(account.code)}
                className="w-full rounded-[18px] border border-white/8 bg-white/5 px-4 py-4 text-left transition hover:-translate-y-0.5"
                style={
                  selectedAccountCode === account.code
                    ? {
                        borderColor: "rgba(16,185,129,0.35)",
                        background: "rgba(16,185,129,0.08)"
                      }
                    : undefined
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">{account.code} · {account.name}</div>
                    <div className="mt-1 text-xs text-slate-500">{account.type}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-slate-100">{formatMoneyDisplay(account.balance || 0)}</div>
                    <div className="mt-1 text-xs text-slate-500">Open activity</div>
                  </div>
                </div>
              </button>
            )) : (
              <div className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4 text-sm text-slate-400">
                Account balances will appear here once posted journal entries accumulate in this workspace.
              </div>
            )}
          </div>

          {selectedAccountCode ? (
            <div className="mt-5 rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-400">Account drill-down</div>
                  <div className="mt-2 text-lg font-bold text-white">
                    {accountDrilldown?.account?.code || selectedAccountCode}
                    {accountDrilldown?.account?.name ? ` · ${accountDrilldown.account.name}` : ""}
                  </div>
                  <div className="mt-1 text-sm text-slate-400">{periodLabel}</div>
                </div>
                {accountDrilldown && !accountDrilldownLoading ? (
                  <div className="text-right text-xs text-slate-400">
                    <div>{formatMoneyDisplay(accountDrilldown.balance || 0)} balance</div>
                    <div className="mt-1">{formatMoneyDisplay(accountDrilldown.totalDebits || 0)} Dr · {formatMoneyDisplay(accountDrilldown.totalCredits || 0)} Cr</div>
                  </div>
                ) : null}
              </div>

              <div className="mt-4 space-y-3">
                {accountDrilldownLoading ? (
                  <div className="rounded-[14px] border border-white/8 bg-white/5 px-3 py-3 text-sm text-slate-400">
                    Loading account activity...
                  </div>
                ) : accountDrilldown?.entries?.length ? accountDrilldown.entries.map((entry) => (
                  <div key={entry.id} className="rounded-[14px] border border-white/8 bg-white/5 px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-100">{entry.entryNumber}</div>
                        <div className="mt-1 text-xs text-slate-400">{entry.description}</div>
                        <div className="mt-2 text-xs text-slate-500">
                          {entry.entryType.replace(/_/g, " ")} · {formatDateTime(entry.postingDate)}
                        </div>
                      </div>
                      <div className="text-right text-xs">
                        <div className={entry.netMovement < 0 ? "text-rose-300" : "text-emerald-300"}>
                          {formatMoneyDisplay(entry.netMovement || 0)}
                        </div>
                        <div className="mt-1 text-slate-500">{entry.debit ? `Dr ${formatMoneyDisplay(entry.debit)}` : `Cr ${formatMoneyDisplay(entry.credit)}`}</div>
                      </div>
                    </div>
                    {entry.counterparts?.length ? (
                      <div className="mt-3 space-y-2">
                        {entry.counterparts.map((line, index) => (
                          <div key={`${entry.id}-counterpart-${line.accountCode}-${index}`} className="flex items-center justify-between gap-3 rounded-[12px] border border-white/8 bg-white/5 px-3 py-2 text-xs text-slate-300">
                            <div className="font-semibold text-slate-100">{line.accountCode} · {line.accountName}</div>
                            <div>{line.debit ? `Dr ${formatMoneyDisplay(line.debit)}` : `Cr ${formatMoneyDisplay(line.credit)}`}</div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )) : (
                  <div className="rounded-[14px] border border-white/8 bg-white/5 px-3 py-3 text-sm text-slate-400">
                    No posted activity was found for this account in the selected period.
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FinanceAccountingTopSection({
  reportingWindow = "all",
  accountingExporting = "",
  onExportAccountingStatementVariant = null,
  onExportAccountingJournals = null,
  onPrintFinanceReport = null,
  activeWorkspace = null,
  financeSummary = null,
  canManageFinanceControls = false,
  selectedLockPeriodKey = "",
  onSelectLockPeriodKey = null,
  onLockFinancePeriod = null,
  onUnlockFinancePeriod = null,
  financeControlAction = ""
}) {
  const accountingEnabledAt = financeSummary?.accountingEnabledAt || activeWorkspace?.accountingEnabledAt || null;

  return (
    <>
      {accountingEnabledAt ? (
        <div className="mb-6 rounded-[24px] border border-emerald-400/18 bg-emerald-500/8 px-4 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-300">Accounting activation boundary</div>
          <div className="mt-1 text-sm font-semibold text-slate-100">Accounting started for this workspace on {formatDateTime(accountingEnabledAt)}.</div>
          <div className="mt-1 text-xs text-slate-400">
            Statement and journal visibility in this module reflect accounting activity from that point forward. Earlier Finance workflow history is not being backfilled in this pass.
          </div>
          <div className="mt-2 text-xs text-slate-500">
            If you review older invoices or expenses in Finance, some of them may belong to the workflow history from before accounting was switched on.
          </div>
        </div>
      ) : null}

      <div className="finance-print-hide mb-6 flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-white/8 bg-white/5 px-4 py-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-400">Reporting outputs</div>
          <div className="mt-1 text-sm font-semibold text-slate-100">Export focused report variants or print the current accounting pack</div>
          <div className="mt-1 text-xs text-slate-500">
            {formatAccountingPeriodLabel(reportingWindow)} · accountant-friendly tables stay workspace-scoped and ready to share.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onExportAccountingStatementVariant?.("pack")}
            disabled={accountingExporting !== ""}
            className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-200 transition disabled:cursor-not-allowed disabled:opacity-60"
          >
            {accountingExporting === "pack" ? "Preparing..." : "Pack CSV"}
          </button>
          <button
            type="button"
            onClick={() => onExportAccountingStatementVariant?.("profit_and_loss")}
            disabled={accountingExporting !== ""}
            className="rounded-full border border-violet-400/30 bg-violet-500/10 px-4 py-2 text-sm font-semibold text-violet-200 transition disabled:cursor-not-allowed disabled:opacity-60"
          >
            {accountingExporting === "profit_and_loss" ? "Preparing..." : "P&L CSV"}
          </button>
          <button
            type="button"
            onClick={() => onExportAccountingStatementVariant?.("balance_snapshot")}
            disabled={accountingExporting !== ""}
            className="rounded-full border border-amber-400/30 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-200 transition disabled:cursor-not-allowed disabled:opacity-60"
          >
            {accountingExporting === "balance_snapshot" ? "Preparing..." : "Balance CSV"}
          </button>
          <button
            type="button"
            onClick={onExportAccountingJournals}
            disabled={accountingExporting !== ""}
            className="rounded-full border border-sky-400/30 bg-sky-500/10 px-4 py-2 text-sm font-semibold text-sky-200 transition disabled:cursor-not-allowed disabled:opacity-60"
          >
            {accountingExporting === "journals" ? "Preparing..." : "Journals CSV"}
          </button>
          <button
            type="button"
            onClick={onPrintFinanceReport}
            className="rounded-full border border-white/12 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-white/20 hover:bg-white/10"
          >
            Print report
          </button>
        </div>
      </div>

      <section className="finance-print-report hidden">
        <div className="finance-print-header">
          <div className="finance-print-kicker">Finance report</div>
          <h1>Accounting statement snapshot</h1>
          <p>
            {activeWorkspace?.name || "Workspace"} · {formatAccountingPeriodLabel(reportingWindow)} · Generated{" "}
            {formatDateTime(new Date().toISOString())}
          </p>
        </div>

        <div className="finance-print-section">
          <h2>Report metadata</h2>
          <div className="finance-print-grid">
            {[
              ["Workspace", activeWorkspace?.name || "Workspace"],
              ["Period", formatAccountingPeriodLabel(reportingWindow)],
              ["Report basis", "Posted journal activity"],
              ["Accounting active since", accountingEnabledAt ? formatDateTime(accountingEnabledAt) : "Not available"],
              ["Prepared from", "Finance shell accounting snapshot"],
              ["Accounts in view", String((financeSummary?.accountingStatements?.accountBalances || []).length)],
              ["Recent journals", String((financeSummary?.recentJournalEntries || []).length)]
            ].map(([label, value]) => (
              <div key={label} className="finance-print-stat">
                <div className="finance-print-label">{label}</div>
                <div className="finance-print-text">{value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="finance-print-section">
          <h2>Posted accounting snapshot</h2>
          <div className="finance-print-grid">
            {[
              ["Revenue posted", financeSummary?.accountingSnapshot?.revenuePosted || 0],
              ["Expenses posted", financeSummary?.accountingSnapshot?.expensesPosted || 0],
              ["Accounts receivable", financeSummary?.accountingSnapshot?.accountsReceivableBalance || 0],
              ["Accounts payable", financeSummary?.accountingSnapshot?.accountsPayableBalance || 0],
              ["Cash position", financeSummary?.accountingSnapshot?.cashPosition || 0]
            ].map(([label, value]) => (
              <div key={label} className="finance-print-stat">
                <div className="finance-print-label">{label}</div>
                <div className="finance-print-value">{formatMoneyDisplay(value)}</div>
              </div>
            ))}
          </div>
        </div>

        {financeSummary?.accountingStatements?.comparison ? (
          <div className="finance-print-section">
            <h2>Period comparison</h2>
            <table className="finance-print-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Current</th>
                  <th>Previous</th>
                  <th>Delta</th>
                  <th>Direction</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Revenue", financeSummary.accountingStatements.comparison.revenue],
                  ["Expenses", financeSummary.accountingStatements.comparison.expenses],
                  ["Net result", financeSummary.accountingStatements.comparison.netOperatingResult],
                  ["Cash", financeSummary.accountingStatements.comparison.cash],
                  ["Accounts receivable", financeSummary.accountingStatements.comparison.accountsReceivable],
                  ["Accounts payable", financeSummary.accountingStatements.comparison.accountsPayable]
                ].map(([label, metric]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td>{formatMoneyDisplay(metric?.current || 0)}</td>
                    <td>{formatMoneyDisplay(metric?.previous || 0)}</td>
                    <td>{formatMoneyDisplay(metric?.delta || 0)}</td>
                    <td>{metric?.direction || "flat"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="finance-print-section">
          <h2>Profit and loss</h2>
          <div className="finance-print-grid">
            {[
              ["Revenue", financeSummary?.accountingStatements?.profitAndLoss?.revenue || 0],
              ["Expenses", financeSummary?.accountingStatements?.profitAndLoss?.expenses || 0],
              ["Net result", financeSummary?.accountingStatements?.profitAndLoss?.netOperatingResult || 0]
            ].map(([label, value]) => (
              <div key={label} className="finance-print-stat">
                <div className="finance-print-label">{label}</div>
                <div className="finance-print-value">{formatMoneyDisplay(value)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="finance-print-section">
          <h2>Balance snapshot</h2>
          <div className="finance-print-grid">
            {[
              ["Cash", financeSummary?.accountingStatements?.balanceSnapshot?.cash || 0],
              ["Accounts receivable", financeSummary?.accountingStatements?.balanceSnapshot?.accountsReceivable || 0],
              ["Accounts payable", financeSummary?.accountingStatements?.balanceSnapshot?.accountsPayable || 0],
              ["Equity", financeSummary?.accountingStatements?.balanceSnapshot?.equityPlaceholder || 0],
              ["Total assets", financeSummary?.accountingStatements?.balanceSnapshot?.totalAssets || 0],
              ["Total liabilities", financeSummary?.accountingStatements?.balanceSnapshot?.totalLiabilities || 0]
            ].map(([label, value]) => (
              <div key={label} className="finance-print-stat">
                <div className="finance-print-label">{label}</div>
                <div className="finance-print-value">{formatMoneyDisplay(value)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="finance-print-section">
          <h2>Account balances</h2>
          <table className="finance-print-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Type</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              {(financeSummary?.accountingStatements?.accountBalances || []).slice(0, 12).map((account) => (
                <tr key={account.code}>
                  <td>{account.code}</td>
                  <td>{account.name}</td>
                  <td>{account.type}</td>
                  <td>{formatMoneyDisplay(account.balance || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="finance-print-section">
          <h2>Recent journals</h2>
          <table className="finance-print-table">
            <thead>
              <tr>
                <th>Entry</th>
                <th>Date</th>
                <th>Type</th>
                <th>Status</th>
                <th>Total debit</th>
              </tr>
            </thead>
            <tbody>
              {(financeSummary?.recentJournalEntries || []).slice(0, 8).map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <strong>{entry.entryNumber}</strong>
                    <div className="finance-print-subtle">{entry.description}</div>
                  </td>
                  <td>{formatDateTime(entry.postingDate || entry.createdAt)}</td>
                  <td>{entry.entryType.replace(/_/g, " ")}</td>
                  <td>{entry.status}</td>
                  <td>{formatMoneyDisplay(entry.totalDebit || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {canManageFinanceControls ? (
        <div className="mb-6">
          <FinanceControlsPanel
            controls={financeSummary?.accountingControls || null}
            canManage={canManageFinanceControls}
            selectedPeriodKey={selectedLockPeriodKey}
            onSelectPeriod={onSelectLockPeriodKey}
            onLockPeriod={onLockFinancePeriod}
            onUnlockPeriod={onUnlockFinancePeriod}
            actionLoading={financeControlAction}
            recentJournalEntries={financeSummary?.recentJournalEntries || []}
          />
        </div>
      ) : null}
    </>
  );
}

function FinanceAccountingBottomSection({
  financeSummary = null,
  reportingWindow = "all",
  onSelectAccount = null,
  selectedAccountCode = "",
  accountDrilldown = null,
  accountDrilldownLoading = false
}) {
  return (
    <>
      <div className="mt-6">
        <FinanceAccountingSnapshot
          accountingSnapshot={financeSummary?.accountingSnapshot || null}
          recentJournalEntries={financeSummary?.recentJournalEntries || []}
        />
      </div>
      <div className="mt-6">
        <FinanceStatementSnapshot
          statements={financeSummary?.accountingStatements || null}
          reportingWindow={reportingWindow}
          onSelectAccount={onSelectAccount}
          selectedAccountCode={selectedAccountCode}
          accountDrilldown={accountDrilldown}
          accountDrilldownLoading={accountDrilldownLoading}
        />
      </div>
    </>
  );
}

export default function FinanceAccountingAnalytics({ section = "bottom", ...props }) {
  if (section === "top") {
    return <FinanceAccountingTopSection {...props} />;
  }

  return <FinanceAccountingBottomSection {...props} />;
}
