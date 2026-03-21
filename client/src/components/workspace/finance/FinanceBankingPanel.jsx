import { useEffect, useRef, useState } from "react";

import { normalizeCurrencyCode } from "../../../utils/currency.js";
import { FINANCE_CURRENCY_OPTIONS } from "../WorkspaceMessenger.constants.js";
import { formatDate, formatDateTime, formatMoney, formatMoneyDisplay, parseBankCsv, roundMoney, todayDateInputValue } from "../WorkspaceMessenger.utils.js";

export default function FinanceBankingPanel({
  workspaceDefaultCurrency = "USD",
  bankAccounts = [],
  bankTransactions = {},
  expenses = [],
  payments = [],
  financeFxRates = null,
  onCreateBankAccount = null,
  onCreatePlaidBankAccount = null,
  onUpdateBankAccount = null,
  onDeleteBankAccount = null,
  onCreateBankTransaction = null,
  onSyncBankTransactions = null,
  onSyncPlaidAccount = null,
  onRefreshPlaidBalance = null,
  onAutoMatchBankTransactions = null,
  onMatchBankTransactionExpense = null,
  onMatchBankTransactionPayment = null,
  onReconcileBankTransaction = null,
  onReconcileMatchedBankTransactions = null
}) {
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [accountDraft, setAccountDraft] = useState({
    accountName: "",
    accountType: "checking",
    currency: workspaceDefaultCurrency || "USD",
    currentBalance: "0"
  });
  const [transactionDraft, setTransactionDraft] = useState({
    transactionDate: todayDateInputValue(),
    description: "",
    amount: "",
    currency: workspaceDefaultCurrency || "USD",
    category: "other"
  });
  const [submittingKey, setSubmittingKey] = useState("");
  const [plaidDraft, setPlaidDraft] = useState({
    accountName: "",
    currency: workspaceDefaultCurrency || "USD",
    institutionName: "Plaid Bank",
    plaidAccountId: ""
  });
  const csvInputRef = useRef(null);

  useEffect(() => {
    if (!selectedAccountId && bankAccounts[0]?.id) {
      setSelectedAccountId(bankAccounts[0].id);
    } else if (selectedAccountId && !bankAccounts.some((account) => account.id === selectedAccountId)) {
      setSelectedAccountId(bankAccounts[0]?.id || "");
    }
  }, [bankAccounts, selectedAccountId]);

  useEffect(() => {
    setAccountDraft((current) => ({
      ...current,
      currency: current.currency || workspaceDefaultCurrency || "USD"
    }));
    setTransactionDraft((current) => ({
      ...current,
      currency: current.currency || workspaceDefaultCurrency || "USD"
    }));
  }, [workspaceDefaultCurrency]);

  const selectedAccount = bankAccounts.find((account) => account.id === selectedAccountId) || bankAccounts[0] || null;
  const selectedTransactions = selectedAccount ? (bankTransactions[selectedAccount.id] || []) : [];
  const unmatchedTransactions = selectedTransactions.filter((transaction) => !transaction.matchedExpenseId && !transaction.matchedInvoicePaymentId);
  const matchedTransactions = selectedTransactions.filter((transaction) => transaction.matchedExpenseId || transaction.matchedInvoicePaymentId);
  const reconciledTotals = selectedTransactions.reduce((bucket, transaction) => {
    if (!transaction.reconciled) {
      return bucket;
    }
    const currency = normalizeCurrencyCode(transaction.currency || selectedAccount?.currency || workspaceDefaultCurrency || "USD");
    bucket[currency] = roundMoney(Number(bucket[currency] || 0) + Math.abs(Number(transaction.amount || 0)));
    return bucket;
  }, {});
  const lastReconciledAt = selectedTransactions
    .filter((transaction) => transaction.reconciledAt)
    .sort((left, right) => new Date(right.reconciledAt).getTime() - new Date(left.reconciledAt).getTime())[0]?.reconciledAt || null;
  const highConfidenceSuggestions = unmatchedTransactions.filter(
    (transaction) => Number(transaction.matchConfidence || transaction.matchSuggestions?.[0]?.confidence || 0) > 70
  );
  const fxStatusLabel = financeFxRates?.live
    ? `Live rates as of ${formatDateTime(financeFxRates.timestamp)}`
    : "Approximate rates (static)";

  function expenseSuggestionsFor(transaction) {
    const serviceSuggestions = Array.isArray(transaction.matchSuggestions)
      ? transaction.matchSuggestions.filter((suggestion) => suggestion.referenceType === "expense")
      : [];
    if (serviceSuggestions.length) {
      return serviceSuggestions;
    }

    return [...expenses]
      .filter((expense) => !expense.metadata?.reimbursedAt && expense.metadata?.expenseId)
      .sort((left, right) => {
        const leftDiff = Math.abs(Number(left.metadata?.amount || 0) - Math.abs(Number(transaction.amount || 0)));
        const rightDiff = Math.abs(Number(right.metadata?.amount || 0) - Math.abs(Number(transaction.amount || 0)));
        return leftDiff - rightDiff;
      })
      .slice(0, 2)
      .map((expense) => ({
        referenceType: "expense",
        referenceId: expense.metadata.expenseId,
        confidence: 60,
        label: expense.metadata.vendorName || "Expense",
        amount: expense.metadata.amount || 0,
        currency: expense.metadata.currency || workspaceDefaultCurrency || "USD"
      }));
  }

  function paymentSuggestionsFor(transaction) {
    const serviceSuggestions = Array.isArray(transaction.matchSuggestions)
      ? transaction.matchSuggestions.filter((suggestion) => suggestion.referenceType === "invoice_payment")
      : [];
    if (serviceSuggestions.length) {
      return serviceSuggestions;
    }

    return [...payments]
      .filter((payment) => payment.id)
      .sort((left, right) => {
        const leftDiff = Math.abs(Number(left.amount || 0) - Math.abs(Number(transaction.amount || 0)));
        const rightDiff = Math.abs(Number(right.amount || 0) - Math.abs(Number(transaction.amount || 0)));
        return leftDiff - rightDiff;
      })
      .slice(0, 2)
      .map((payment) => ({
        referenceType: "invoice_payment",
        referenceId: payment.id,
        confidence: 60,
        label: payment.invoiceNumber || "Invoice payment",
        amount: payment.amount || 0,
        currency: payment.currency || workspaceDefaultCurrency || "USD"
      }));
  }

  async function handleCsvImport(event) {
    const file = event.target.files?.[0];
    if (!file || !selectedAccount || !onSyncBankTransactions) {
      return;
    }

    setSubmittingKey(`sync-${selectedAccount.id}`);
    try {
      const text = await file.text();
      const transactions = parseBankCsv(text)
        .filter((transaction) => transaction.description && Number.isFinite(Number(transaction.amount)) && Number(transaction.amount) !== 0)
        .map((transaction) => ({
          ...transaction,
          currency: normalizeCurrencyCode(transaction.currency || selectedAccount.currency || workspaceDefaultCurrency || "USD")
        }));
      await onSyncBankTransactions(selectedAccount.id, transactions);
    } finally {
      setSubmittingKey("");
      if (event.target) {
        event.target.value = "";
      }
    }
  }

  async function handleRunAutoMatch() {
    if (!selectedAccount || !onAutoMatchBankTransactions) {
      return;
    }
    setSubmittingKey(`auto-match-${selectedAccount.id}`);
    try {
      await onAutoMatchBankTransactions(selectedAccount.id);
    } finally {
      setSubmittingKey("");
    }
  }

  async function handleBulkAcceptHighConfidence() {
    if (!highConfidenceSuggestions.length) {
      return;
    }

    setSubmittingKey(`bulk-match-${selectedAccount?.id || "bank"}`);
    try {
      for (const transaction of highConfidenceSuggestions) {
        const bestSuggestion = Array.isArray(transaction.matchSuggestions)
          ? [...transaction.matchSuggestions].sort((left, right) => Number(right.confidence || 0) - Number(left.confidence || 0))[0]
          : null;
        if (!bestSuggestion || Number(bestSuggestion.confidence || 0) <= 70) {
          continue;
        }
        if (bestSuggestion.referenceType === "expense") {
          await onMatchBankTransactionExpense?.(transaction.id, bestSuggestion.referenceId);
        } else if (bestSuggestion.referenceType === "invoice_payment") {
          await onMatchBankTransactionPayment?.(transaction.id, bestSuggestion.referenceId);
        }
      }
    } finally {
      setSubmittingKey("");
    }
  }

  return (
    <div className="finance-banking-panel grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <div className="space-y-6">
        <div
          className="rounded-[24px] p-5"
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            background: "linear-gradient(180deg,#111827 0%,#10192a 100%)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.28)"
          }}
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">Bank accounts</div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-xl font-bold text-white">Cash position and connected accounts</h3>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold text-slate-300">
              {fxStatusLabel}
            </span>
          </div>
          <div className="mt-5 space-y-3">
            {bankAccounts.length ? bankAccounts.map((account) => (
              <button
                key={account.id}
                type="button"
                onClick={() => setSelectedAccountId(account.id)}
                className={`w-full rounded-[18px] border px-4 py-4 text-left transition ${
                  selectedAccount?.id === account.id ? "border-emerald-400/30 bg-emerald-500/10" : "border-white/8 bg-white/5 hover:border-white/15"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">{account.accountName}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span>{account.accountType} · {account.status}</span>
                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-slate-200">
                        {account.isManual ? "Upload CSV" : "Connected"}
                      </span>
                      {!account.isManual && account.plaidInstitutionName ? (
                        <span className="text-slate-400">{account.plaidInstitutionName}{account.plaidMask ? ` •••• ${account.plaidMask}` : ""}</span>
                      ) : null}
                    </div>
                    {account.lastSyncedAt ? (
                      <div className="mt-2 text-xs text-slate-500">Last synced {formatDateTime(account.lastSyncedAt)}</div>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-emerald-300">{formatMoney(account.currentBalance || 0, account.currency || workspaceDefaultCurrency)}</div>
                    <div className="mt-1 text-xs text-slate-500">{account.currency}</div>
                  </div>
                </div>
              </button>
            )) : (
              <div className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4 text-sm text-slate-400">
                No bank accounts yet. Add your first manual account below.
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
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">New bank account</div>
          <form
            className="mt-5 grid gap-3"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!onCreateBankAccount) {
                return;
              }
              setSubmittingKey("account");
              try {
                const account = await onCreateBankAccount(accountDraft);
                if (account?.id) {
                  setSelectedAccountId(account.id);
                  setAccountDraft({
                    accountName: "",
                    accountType: "checking",
                    currency: workspaceDefaultCurrency || "USD",
                    currentBalance: "0"
                  });
                }
              } finally {
                setSubmittingKey("");
              }
            }}
          >
            <input
              value={accountDraft.accountName}
              onChange={(event) => setAccountDraft((current) => ({ ...current, accountName: event.target.value }))}
              placeholder="Operating Account"
              className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 outline-none"
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <select
                value={accountDraft.accountType}
                onChange={(event) => setAccountDraft((current) => ({ ...current, accountType: event.target.value }))}
                className="rounded-[14px] border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-100 outline-none"
              >
                <option value="checking">Checking</option>
                <option value="savings">Savings</option>
                <option value="credit">Credit</option>
                <option value="other">Other</option>
              </select>
              <select
                value={accountDraft.currency}
                onChange={(event) => setAccountDraft((current) => ({ ...current, currency: event.target.value }))}
                className="rounded-[14px] border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-100 outline-none"
              >
                {FINANCE_CURRENCY_OPTIONS.map((currencyCode) => (
                  <option key={`bank-account-currency-${currencyCode}`} value={currencyCode}>{currencyCode}</option>
                ))}
              </select>
              <input
                type="number"
                step="0.01"
                value={accountDraft.currentBalance}
                onChange={(event) => setAccountDraft((current) => ({ ...current, currentBalance: event.target.value }))}
                placeholder="0.00"
                className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 outline-none"
              />
            </div>
            <button
              type="submit"
              className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-300"
            >
              {submittingKey === "account" ? "Saving..." : "Add bank account"}
            </button>
          </form>
          {onCreatePlaidBankAccount ? (
            <form
              className="mt-4 grid gap-3 rounded-[18px] border border-white/8 bg-white/5 p-4"
              onSubmit={async (event) => {
                event.preventDefault();
                setSubmittingKey("plaid-account");
                try {
                  const account = await onCreatePlaidBankAccount(plaidDraft);
                  if (account?.id) {
                    setSelectedAccountId(account.id);
                    setPlaidDraft({
                      accountName: "",
                      currency: workspaceDefaultCurrency || "USD",
                      institutionName: "Plaid Bank",
                      plaidAccountId: ""
                    });
                  }
                } finally {
                  setSubmittingKey("");
                }
              }}
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-300">Connect bank</div>
              <input
                value={plaidDraft.accountName}
                onChange={(event) => setPlaidDraft((current) => ({ ...current, accountName: event.target.value }))}
                placeholder="Connected checking account"
                className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 outline-none"
              />
              <div className="grid gap-3 sm:grid-cols-3">
                <input
                  value={plaidDraft.institutionName}
                  onChange={(event) => setPlaidDraft((current) => ({ ...current, institutionName: event.target.value }))}
                  placeholder="Institution"
                  className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 outline-none"
                />
                <input
                  value={plaidDraft.plaidAccountId}
                  onChange={(event) => setPlaidDraft((current) => ({ ...current, plaidAccountId: event.target.value }))}
                  placeholder="Account id (optional)"
                  className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 outline-none"
                />
                <select
                  value={plaidDraft.currency}
                  onChange={(event) => setPlaidDraft((current) => ({ ...current, currency: event.target.value }))}
                  className="rounded-[14px] border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-100 outline-none"
                >
                  {FINANCE_CURRENCY_OPTIONS.map((currencyCode) => (
                    <option key={`plaid-account-currency-${currencyCode}`} value={currencyCode}>{currencyCode}</option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                className="rounded-full border border-sky-400/20 bg-sky-500/10 px-4 py-2 text-sm font-semibold text-sky-300"
              >
                {submittingKey === "plaid-account" ? "Connecting..." : "Connect Bank Account"}
              </button>
            </form>
          ) : null}
        </div>
      </div>

      <div className="space-y-6">
        <div
          className="rounded-[24px] p-5"
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            background: "linear-gradient(180deg,#111827 0%,#10192a 100%)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.28)"
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">Transactions</div>
              <h3 className="mt-2 text-xl font-bold text-white">{selectedAccount?.accountName || "Select an account"}</h3>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {selectedAccount ? (
                <>
                  <input
                    ref={csvInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    onChange={handleCsvImport}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => csvInputRef.current?.click()}
                    className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-300"
                  >
                    {submittingKey === `sync-${selectedAccount.id}` ? "Importing..." : selectedAccount.isManual ? "Import transactions" : "Upload CSV"}
                  </button>
                  {!selectedAccount.isManual && onSyncPlaidAccount ? (
                    <button
                      type="button"
                      onClick={async () => {
                        setSubmittingKey(`plaid-sync-${selectedAccount.id}`);
                        try {
                          await onSyncPlaidAccount(selectedAccount.id);
                        } finally {
                          setSubmittingKey("");
                        }
                      }}
                      className="rounded-full border border-sky-400/20 bg-sky-500/10 px-4 py-2 text-xs font-semibold text-sky-300"
                    >
                      {submittingKey === `plaid-sync-${selectedAccount.id}` ? "Syncing..." : "Sync now"}
                    </button>
                  ) : null}
                  {!selectedAccount.isManual && onRefreshPlaidBalance ? (
                    <button
                      type="button"
                      onClick={async () => {
                        setSubmittingKey(`plaid-balance-${selectedAccount.id}`);
                        try {
                          await onRefreshPlaidBalance(selectedAccount.id);
                        } finally {
                          setSubmittingKey("");
                        }
                      }}
                      className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200"
                    >
                      {submittingKey === `plaid-balance-${selectedAccount.id}` ? "Refreshing..." : "Refresh balance"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={handleRunAutoMatch}
                    className="rounded-full border border-sky-400/20 bg-sky-500/10 px-4 py-2 text-xs font-semibold text-sky-300"
                  >
                    {submittingKey === `auto-match-${selectedAccount.id}` ? "Matching..." : "Auto-match"}
                  </button>
                  {highConfidenceSuggestions.length ? (
                    <button
                      type="button"
                      onClick={handleBulkAcceptHighConfidence}
                      className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200"
                    >
                      {submittingKey === `bulk-match-${selectedAccount.id}` ? "Applying..." : "Accept high confidence"}
                    </button>
                  ) : null}
                </>
              ) : null}
              {selectedAccount && onDeleteBankAccount ? (
                <button
                  type="button"
                  onClick={async () => {
                    setSubmittingKey(`delete-${selectedAccount.id}`);
                    try {
                      await onDeleteBankAccount(selectedAccount.id);
                    } finally {
                      setSubmittingKey("");
                    }
                  }}
                  className="rounded-full border border-rose-400/20 bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-300"
                >
                  {submittingKey === `delete-${selectedAccount.id}` ? "Disconnecting..." : "Disconnect"}
                </button>
              ) : null}
            </div>
          </div>
          {selectedAccount ? (
            <>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Matched</div>
                  <div className="mt-2 text-2xl font-bold text-slate-100">{matchedTransactions.length}</div>
                </div>
                <div className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Unmatched</div>
                  <div className="mt-2 text-2xl font-bold text-slate-100">{unmatchedTransactions.length}</div>
                </div>
                <div className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Reconciled</div>
                  <div className="mt-2 text-sm font-semibold text-emerald-300">{formatMoneyDisplay(reconciledTotals || {})}</div>
                </div>
                <div className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Last sync</div>
                  <div className="mt-2 text-sm font-semibold text-slate-100">{selectedAccount.lastSyncedAt ? formatDateTime(selectedAccount.lastSyncedAt) : "Never"}</div>
                  <div className="mt-1 text-xs text-slate-500">{lastReconciledAt ? `Last reconciliation ${formatTimeAgo(lastReconciledAt)}` : "No reconciliations yet"}</div>
                </div>
              </div>

              <form
                className="mt-5 grid gap-3"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (!onCreateBankTransaction) {
                    return;
                  }
                  setSubmittingKey(`transaction-${selectedAccount.id}`);
                  try {
                    await onCreateBankTransaction(selectedAccount.id, transactionDraft);
                    setTransactionDraft({
                      transactionDate: todayDateInputValue(),
                      description: "",
                      amount: "",
                      currency: selectedAccount.currency || workspaceDefaultCurrency || "USD",
                      category: "other"
                    });
                  } finally {
                    setSubmittingKey("");
                  }
                }}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    type="date"
                    value={transactionDraft.transactionDate}
                    onChange={(event) => setTransactionDraft((current) => ({ ...current, transactionDate: event.target.value }))}
                    className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 outline-none"
                  />
                  <input
                    value={transactionDraft.description}
                    onChange={(event) => setTransactionDraft((current) => ({ ...current, description: event.target.value }))}
                    placeholder="Supplier payment"
                    className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 outline-none"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <input
                    type="number"
                    step="0.01"
                    value={transactionDraft.amount}
                    onChange={(event) => setTransactionDraft((current) => ({ ...current, amount: event.target.value }))}
                    placeholder="-1250.00"
                    className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 outline-none"
                  />
                  <select
                    value={transactionDraft.currency}
                    onChange={(event) => setTransactionDraft((current) => ({ ...current, currency: event.target.value }))}
                    className="rounded-[14px] border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-100 outline-none"
                  >
                    {FINANCE_CURRENCY_OPTIONS.map((currencyCode) => (
                      <option key={`bank-transaction-currency-${currencyCode}`} value={currencyCode}>{currencyCode}</option>
                    ))}
                  </select>
                  <input
                    value={transactionDraft.category}
                    onChange={(event) => setTransactionDraft((current) => ({ ...current, category: event.target.value }))}
                    placeholder="supplies"
                    className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 outline-none"
                  />
                </div>
                <button
                  type="submit"
                  className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-300"
                >
                  {submittingKey === `transaction-${selectedAccount.id}` ? "Saving..." : "Add transaction"}
                </button>
              </form>

              <div className="mt-6 space-y-3">
                {selectedTransactions.length ? selectedTransactions.map((transaction) => {
                  const expenseSuggestions = expenseSuggestionsFor(transaction);
                  const paymentSuggestions = paymentSuggestionsFor(transaction);
                  const topSuggestion = [...expenseSuggestions, ...paymentSuggestions]
                    .sort((left, right) => Number(right.confidence || 0) - Number(left.confidence || 0))[0] || null;
                  return (
                    <div key={transaction.id} className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-100">{transaction.description}</div>
                          <div className="mt-1 text-xs text-slate-500">{formatDate(transaction.transactionDate)} · {transaction.category || "other"}</div>
                        </div>
                        <div className={`text-sm font-semibold ${Number(transaction.amount || 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                          {formatMoney(transaction.amount || 0, transaction.currency || selectedAccount.currency)}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        {transaction.matchedExpenseId ? (
                          <span className="rounded-full border border-sky-400/20 bg-sky-500/10 px-3 py-1 text-sky-300">Matched to expense</span>
                        ) : null}
                        {transaction.matchedInvoicePaymentId ? (
                          <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-emerald-300">Matched to payment</span>
                        ) : null}
                        {transaction.reconciled ? (
                          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-300">Reconciled</span>
                        ) : null}
                        {Number(transaction.matchConfidence || 0) > 0 ? (
                          <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-3 py-1 text-amber-200">
                            Match confidence {Math.round(Number(transaction.matchConfidence || 0))}%
                          </span>
                        ) : null}
                      </div>
                      {topSuggestion && Number(topSuggestion.confidence || 0) > 70 ? (
                        <div className="mt-3 rounded-[14px] border border-emerald-400/15 bg-emerald-500/5 px-3 py-3 text-xs text-emerald-200">
                          Suggested {topSuggestion.referenceType === "expense" ? "expense" : "payment"}: {topSuggestion.label} · {formatMoney(topSuggestion.amount || 0, topSuggestion.currency || selectedAccount.currency)}
                        </div>
                      ) : null}
                      {!transaction.matchedExpenseId && !transaction.matchedInvoicePaymentId ? (
                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          <div className="rounded-[14px] border border-white/8 bg-slate-950/40 px-3 py-3">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Suggested expenses</div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {expenseSuggestions.length ? expenseSuggestions.map((expense) => (
                                <button
                                  key={`tx-expense-${transaction.id}-${expense.referenceId || expense.metadata?.expenseId}`}
                                  type="button"
                                  onClick={() => onMatchBankTransactionExpense?.(transaction.id, expense.referenceId || expense.metadata?.expenseId)}
                                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200"
                                >
                                  {(expense.label || expense.metadata?.vendorName || "Expense")} · {formatMoney(expense.amount || expense.metadata?.amount || 0, expense.currency || expense.metadata?.currency)}
                                </button>
                              )) : <span className="text-xs text-slate-500">No close expense matches</span>}
                            </div>
                          </div>
                          <div className="rounded-[14px] border border-white/8 bg-slate-950/40 px-3 py-3">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Suggested payments</div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {paymentSuggestions.length ? paymentSuggestions.map((payment) => (
                                <button
                                  key={`tx-payment-${transaction.id}-${payment.referenceId || payment.id}`}
                                  type="button"
                                  onClick={() => onMatchBankTransactionPayment?.(transaction.id, payment.referenceId || payment.id)}
                                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200"
                                >
                                  {(payment.label || payment.invoiceNumber || "Payment")} · {formatMoney(payment.amount || 0, payment.currency)}
                                </button>
                              )) : <span className="text-xs text-slate-500">No close payment matches</span>}
                            </div>
                          </div>
                        </div>
                      ) : null}
                      {!transaction.reconciled ? (
                        <div className="mt-4">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => onReconcileBankTransaction?.(transaction.id)}
                              className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-300"
                            >
                              Mark reconciled
                            </button>
                            {(transaction.matchedExpenseId || transaction.matchedInvoicePaymentId) && onReconcileMatchedBankTransactions ? (
                              <button
                                type="button"
                                onClick={() => onReconcileMatchedBankTransactions(selectedAccount.id)}
                                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200"
                              >
                                Reconcile matched batch
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                }) : (
                  <div className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4 text-sm text-slate-400">
                    No transactions for this account yet.
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="mt-5 rounded-[18px] border border-white/8 bg-white/5 px-4 py-4 text-sm text-slate-400">
              Select or create a bank account to add and match transactions.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function normalizePlatformWorkspaceMember(entry) {
  const user = entry?.user || {};
  const membership = entry?.membership || {};

  return {
    id: user.id || membership.userId || "",
    membershipId: membership.id || null,
    name: user.name || membership.email || "Workspace member",
    email: user.email || membership.email || "",
    isAdmin: Boolean(user.isAdmin),
    workspaceEnabled: membership.status !== "suspended",
    workspaceRole: membership.workspaceRole || "member",
    workspaceRoles: Array.isArray(membership.financeRoles) ? membership.financeRoles : [],
    workspaceModules: Array.isArray(membership.modules) ? membership.modules : [],
    presenceStatus: user.presenceStatus || "offline",
    lastActiveAt: user.lastActiveAt || null,
    membershipStatus: membership.status || "active"
  };
}

function OperationsBridgePanel({
  financeMode = false,
  financeSummary = null,
  warehouseSummary = null,
  executionSummary = null,
  recentPayments = [],
  recentShipments = [],
  topCustomers = [],
  onSelectMetric,
  onNavigate = null
}) {
  const financeAttention = Number(financeSummary?.dueAttention || 0) + Number(financeSummary?.reconcileQueue || 0);
  const warehouseAttention =
    Number(warehouseSummary?.reorderAttention || 0) +
    Number(warehouseSummary?.delayedOrders || 0) +
    Number(warehouseSummary?.pendingPurchaseOrders || 0);
  const executionAttention = Number(executionSummary?.executionAttention || 0);
  const sharedAttention = financeAttention + warehouseAttention + executionAttention;
  const operationsCards = [
    {
      id: "ops-attention",
      label: "Shared attention",
      value: `${sharedAttention}`,
      subvalue: `${financeAttention} finance · ${warehouseAttention} warehouse · ${executionAttention} execution`
    },
    {
      id: "finance-outstanding",
      label: "Finance pressure",
      value: `${financeSummary?.outstandingInvoices || 0}`,
      subvalue: `${formatMoneyDisplay(financeSummary?.outstandingAmount || 0)} open`
    },
    {
      id: "warehouse-low-stock",
      label: "Warehouse pressure",
      value: `${warehouseSummary?.reorderAttention || 0}`,
      subvalue: `${warehouseSummary?.lowStockItems || 0} low stock · ${warehouseSummary?.pendingPurchaseOrders || 0} open PO`
    },
    {
      id: "execution-pressure",
      label: "Execution pressure",
      value: `${executionSummary?.executionAttention || 0}`,
      subvalue: `${executionSummary?.overdueTasks || 0} overdue task${Number(executionSummary?.overdueTasks || 0) === 1 ? "" : "s"}`
    }
  ];
  const attentionItems = [
    financeSummary?.overdueInvoices
      ? {
          id: "overdue",
          title: `${financeSummary.overdueInvoices} overdue invoice${financeSummary.overdueInvoices === 1 ? "" : "s"}`,
          detail: `${formatMoneyDisplay(financeSummary?.overdueAmount || 0)} now needs follow-up`,
          accent: financeMode ? "#fda4af" : "#e11d48"
        }
      : null,
    financeSummary?.outstandingInvoices
      ? {
          id: "outstanding",
          title: `${financeSummary.outstandingInvoices} invoice${financeSummary.outstandingInvoices === 1 ? "" : "s"} still open`,
          detail: `${formatMoneyDisplay(financeSummary?.outstandingAmount || 0)} remains unpaid`,
          accent: financeMode ? "#fcd34d" : "#d97706"
        }
      : null,
    warehouseSummary?.reorderAttention
      ? {
          id: "reorder",
          title: `${warehouseSummary.reorderAttention} product${warehouseSummary.reorderAttention === 1 ? "" : "s"} need reorder`,
          detail: `${warehouseSummary.lowStockItems || warehouseSummary.reorderAttention} low-stock signal${Number(warehouseSummary.lowStockItems || warehouseSummary.reorderAttention) === 1 ? "" : "s"} active · ${warehouseSummary.pendingPurchaseOrders || 0} purchase order${Number(warehouseSummary.pendingPurchaseOrders || 0) === 1 ? "" : "s"} open`,
          accent: financeMode ? "#93c5fd" : "#2563eb"
        }
      : null,
    warehouseSummary?.delayedOrders
      ? {
          id: "delayed",
          title: `${warehouseSummary.delayedOrders} shipment${warehouseSummary.delayedOrders === 1 ? "" : "s"} delayed`,
          detail: "Warehouse handoff timing needs review alongside finance commitments.",
          accent: financeMode ? "#c4b5fd" : "#7c3aed"
        }
      : null,
    financeSummary?.recurringDueInvoices
      ? {
          id: "recurring-due",
          title: `${financeSummary.recurringDueInvoices} recurring invoice${financeSummary.recurringDueInvoices === 1 ? "" : "s"} due`,
          detail: "Scheduled finance work is ready to issue.",
          accent: financeMode ? "#6ee7b7" : "#059669"
        }
      : null,
    executionSummary?.overdueTasks
      ? {
          id: "execution-overdue",
          title: `${executionSummary.overdueTasks} overdue task${executionSummary.overdueTasks === 1 ? "" : "s"}`,
          detail: "Execution follow-up is slipping and may now affect delivery timing.",
          accent: financeMode ? "#fca5a5" : "#dc2626"
        }
      : null,
    executionSummary?.projectsNeedingAttention
      ? {
          id: "execution-projects",
          title: `${executionSummary.projectsNeedingAttention} active project${executionSummary.projectsNeedingAttention === 1 ? "" : "s"} need review`,
          detail: "Project progress or due timing is now worth a manager pass.",
          accent: financeMode ? "#c4b5fd" : "#7c3aed"
        }
      : null
  ].filter(Boolean).slice(0, 5);
  const activityItems = [
    ...recentPayments.map((payment) => ({
      id: `payment-${payment.id}`,
      sortAt: payment.recordedAt,
      eyebrow: "Finance",
      title: `${payment.invoiceNumber} payment recorded`,
      detail: `${payment.customerName} · ${formatMoney(payment.amount || 0, payment.currency)} · ${formatPaymentMethod(payment.method)}`,
      meta: payment.reference ? `Ref ${payment.reference}` : payment.recordedBy?.name ? `Recorded by ${payment.recordedBy.name}` : "Payment logged",
      accent: financeMode ? "#34d399" : "#059669"
    })),
    ...recentShipments.map((shipment) => ({
      id: `shipment-${shipment.id}`,
      sortAt: shipment.updatedAt || shipment.createdAt || shipment.estimatedDelivery,
      eyebrow: "Warehouse",
      title: `${shipment.orderNumber} ${warehouseStatusLabel(shipment.status).toLowerCase()}`,
      detail: `${shipment.destination} · ${warehouseShipmentTypeLabel(shipment.shipmentType)} · ${shipment.itemsCount || 1} item${Number(shipment.itemsCount || 1) === 1 ? "" : "s"}`,
      meta: shipment.estimatedDelivery ? `ETA ${formatDate(shipment.estimatedDelivery)}` : "Shipment updated",
      accent: financeMode ? "#93c5fd" : "#2563eb"
    }))
  ]
    .filter((item) => item.sortAt)
    .sort((left, right) => new Date(right.sortAt).getTime() - new Date(left.sortAt).getTime())
    .slice(0, 6);
  const handoffCues = [
    warehouseSummary?.reorderAttention && financeSummary?.outstandingInvoices
      ? {
          id: "handoff-reorder-cash",
          title: "Reorder pressure meets open cash pressure",
          detail: `${warehouseSummary.reorderAttention} warehouse item${warehouseSummary.reorderAttention === 1 ? "" : "s"} need replenishment while ${financeSummary.outstandingInvoices} invoice${financeSummary.outstandingInvoices === 1 ? "" : "s"} remain unpaid.`,
          consequence: "Review collection timing before replenishment pressure turns into a purchasing squeeze.",
          eyebrow: "Cross-module",
          actionLabel: "Open Finance pressure",
          action: () => onNavigate?.({ scope: "finance", tab: "Pinned", metricId: "finance-outstanding" })
        }
      : null,
    warehouseSummary?.delayedOrders && financeSummary?.overdueInvoices
      ? {
          id: "handoff-delay-risk",
          title: "Delayed shipments may raise customer and cash risk",
          detail: `${warehouseSummary.delayedOrders} shipment${warehouseSummary.delayedOrders === 1 ? "" : "s"} are delayed while ${financeSummary.overdueInvoices} invoice${financeSummary.overdueInvoices === 1 ? "" : "s"} are already overdue.`,
          consequence: "Operations and finance may need the same customer conversations soon.",
          eyebrow: "Cross-module",
          actionLabel: "Open overdue invoices",
          action: () => onNavigate?.({ scope: "finance", tab: "Pinned", metricId: "finance-overdue" })
        }
      : null,
    executionSummary?.overdueTasks && warehouseSummary?.delayedOrders
      ? {
          id: "handoff-execution-warehouse",
          title: "Execution slippage is now sitting beside shipment delay",
          detail: `${executionSummary.overdueTasks} overdue task${executionSummary.overdueTasks === 1 ? "" : "s"} are active while ${warehouseSummary.delayedOrders} shipment${warehouseSummary.delayedOrders === 1 ? "" : "s"} remain delayed.`,
          consequence: "Check internal execution blockers before more shipment work slips.",
          eyebrow: "Execution to Warehouse",
          actionLabel: "Open projects",
          action: () => onNavigate?.({ scope: "projects" })
        }
      : null,
    executionSummary?.projectsNeedingAttention && financeSummary?.outstandingInvoices
      ? {
          id: "handoff-execution-finance",
          title: "Project pressure is rising while finance remains open",
          detail: `${executionSummary.projectsNeedingAttention} project${executionSummary.projectsNeedingAttention === 1 ? "" : "s"} need review and ${financeSummary.outstandingInvoices} invoice${financeSummary.outstandingInvoices === 1 ? "" : "s"} still remain unpaid.`,
          consequence: "Keep delivery commitments and collection timing aligned before pressure spreads.",
          eyebrow: "Execution to Finance",
          actionLabel: "Open tasks",
          action: () => onNavigate?.({ scope: "tasks" })
        }
      : null,
    warehouseSummary?.reorderAttention
      ? {
          id: "handoff-purchasing",
          title: "Reorder activity needs purchasing attention",
          detail: `${warehouseSummary.reorderAttention} item${warehouseSummary.reorderAttention === 1 ? "" : "s"} are pushing toward replenishment and ${warehouseSummary.pendingPurchaseOrders || 0} purchase order${Number(warehouseSummary.pendingPurchaseOrders || 0) === 1 ? "" : "s"} are already open.`,
          consequence: "Use Finance to review expense readiness before confirming the next purchasing step.",
          eyebrow: "Warehouse to Finance",
          actionLabel: "Open finance expenses",
          action: () => onNavigate?.({ scope: "finance", tab: "Media", metricId: "finance-expenses" })
        }
      : null,
    financeSummary?.recurringDueInvoices && warehouseSummary?.reorderAttention
      ? {
          id: "handoff-recurring-stock",
          title: "Recurring finance work is due while stock pressure is active",
          detail: `${financeSummary.recurringDueInvoices} recurring invoice${financeSummary.recurringDueInvoices === 1 ? "" : "s"} are ready to issue and ${warehouseSummary.reorderAttention} stock item${warehouseSummary.reorderAttention === 1 ? "" : "s"} need replenishment.`,
          consequence: "Use both modules together to keep billing and fulfillment timing aligned.",
          eyebrow: "Finance to Warehouse",
          actionLabel: "Open recurring work",
          action: () => onNavigate?.({ scope: "finance", tab: "Media", metricId: "finance-overdue" })
        }
      : null
  ]
    .concat(
      (warehouseSummary?.warehouseHandoffCues || []).map((cue) => ({
        id: `handoff-warehouse-${cue.id}`,
        title: cue.title,
        detail: cue.detail,
        consequence:
          cue.signal === "risk"
            ? "Check the shipment path and replenishment timing together before the delay spreads."
            : cue.signal === "attention"
              ? "Review both stock pressure and shipment timing in the same pass."
              : "This may improve on its own, but it is worth keeping in the shared view.",
        eyebrow: "Warehouse operations",
        actionLabel: "Open Warehouse",
        action: () => onNavigate?.({ scope: "warehouse", tab: "Media", metricId: cue.targetMetricId || "warehouse-in-transit" })
      }))
    )
    .filter(Boolean)
    .slice(0, 4);

  return (
    <div
      className="rounded-[24px] p-5"
      style={
        financeMode
          ? {
              border: "1px solid rgba(255,255,255,0.08)",
              background: "linear-gradient(180deg,#0f1726 0%,#101827 100%)",
              boxShadow: "0 18px 48px rgba(0,0,0,0.24)"
            }
          : {
              border: "1px solid #dbeafe",
              background: "linear-gradient(180deg,#f8fbff 0%,#eef6ff 100%)",
              boxShadow: "0 18px 40px rgba(37,99,235,0.08)"
            }
      }
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div
            className="text-[11px] font-semibold uppercase tracking-[0.18em]"
            style={{ color: financeMode ? "#93c5fd" : "#2563eb" }}
          >
            Operations bridge
          </div>
          <h3 className={`mt-2 text-xl font-bold ${financeMode ? "text-slate-50" : "text-slate-900"}`}>Finance and Warehouse together</h3>
          <p className={`mt-1 max-w-2xl text-sm ${financeMode ? "text-slate-400" : "text-slate-600"}`}>
            Shared operational visibility for workspaces running both modules, without turning the product into one merged system.
          </p>
        </div>
        {topCustomers.length ? (
          <div
            className="rounded-[18px] px-4 py-3"
            style={
              financeMode
                ? {
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.04)"
                  }
                : {
                    border: "1px solid #dbeafe",
                    background: "#ffffff"
                  }
            }
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Top open customer</div>
            <div className={`mt-2 text-sm font-semibold ${financeMode ? "text-slate-100" : "text-slate-900"}`}>{topCustomers[0].name}</div>
            <div className="mt-1 text-xs text-slate-500">{formatMoneyDisplay((topCustomers[0].outstandingAmountByCurrency ?? topCustomers[0].outstandingAmount) || 0)} still open</div>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {operationsCards.map((card) => (
          <button
            key={card.id}
            type="button"
            onClick={() => onSelectMetric?.({ id: card.id, label: card.label, value: card.value, subvalue: card.subvalue })}
            className="rounded-[18px] px-4 py-4 text-left transition hover:-translate-y-0.5"
            style={
              financeMode
                ? {
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.05)"
                  }
                : {
                    border: "1px solid #dbeafe",
                    background: "#ffffff"
                  }
            }
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{card.label}</div>
            <div className={`mt-3 text-3xl font-bold ${financeMode ? "text-slate-50" : "text-slate-900"}`}>{card.value}</div>
            <div className="mt-2 text-sm text-slate-500">{card.subvalue}</div>
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div>
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Needs coordination</div>
          <div className="space-y-3">
            {attentionItems.length ? attentionItems.map((item) => (
              <div
                key={item.id}
                className="rounded-[18px] px-4 py-4"
                style={
                  financeMode
                    ? {
                        border: "1px solid rgba(255,255,255,0.08)",
                        background: "rgba(255,255,255,0.04)"
                      }
                    : {
                        border: "1px solid #dbeafe",
                        background: "#ffffff"
                      }
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className={`text-sm font-semibold ${financeMode ? "text-slate-100" : "text-slate-900"}`}>{item.title}</div>
                    <div className="mt-1 text-sm text-slate-500">{item.detail}</div>
                  </div>
                  <span className="mt-0.5 h-2.5 w-2.5 rounded-full" style={{ background: item.accent }} />
                </div>
              </div>
            )) : (
              <div
                className="rounded-[18px] px-4 py-4 text-sm text-slate-500"
                style={
                  financeMode
                    ? {
                        border: "1px solid rgba(255,255,255,0.08)",
                        background: "rgba(255,255,255,0.04)"
                      }
                    : {
                        border: "1px solid #dbeafe",
                        background: "#ffffff"
                      }
                }
              >
                Nothing is currently asking for cross-module coordination.
              </div>
            )}
          </div>
        </div>
        <div>
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Recent cross-module flow</div>
          <div className="space-y-3">
            {activityItems.length ? activityItems.map((item) => (
              <div
                key={item.id}
                className="rounded-[18px] px-4 py-4"
                style={
                  financeMode
                    ? {
                        border: "1px solid rgba(255,255,255,0.08)",
                        background: "rgba(255,255,255,0.04)"
                      }
                    : {
                        border: "1px solid #dbeafe",
                        background: "#ffffff"
                      }
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: item.accent }}>{item.eyebrow}</div>
                    <div className={`mt-1 text-sm font-semibold ${financeMode ? "text-slate-100" : "text-slate-900"}`}>{item.title}</div>
                    <div className="mt-1 text-sm text-slate-500">{item.detail}</div>
                    <div className="mt-2 text-xs text-slate-500">{item.meta}</div>
                  </div>
                  <div className="text-right text-xs text-slate-500">{formatDateTime(item.sortAt)}</div>
                </div>
              </div>
            )) : (
              <div
                className="rounded-[18px] px-4 py-4 text-sm text-slate-500"
                style={
                  financeMode
                    ? {
                        border: "1px solid rgba(255,255,255,0.08)",
                        background: "rgba(255,255,255,0.04)"
                      }
                    : {
                        border: "1px solid #dbeafe",
                        background: "#ffffff"
                      }
                }
              >
                Shared finance and warehouse events will show up here as the workspace gets busier.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Handoff cues</div>
        <div className="grid gap-3 xl:grid-cols-2">
          {handoffCues.length ? handoffCues.map((cue) => (
            <button
              key={cue.id}
              type="button"
              onClick={cue.action}
              className="rounded-[18px] px-4 py-4 text-left transition hover:-translate-y-0.5"
              style={
                financeMode
                  ? {
                      border: "1px solid rgba(255,255,255,0.08)",
                      background: "rgba(255,255,255,0.04)"
                    }
                  : {
                      border: "1px solid #dbeafe",
                      background: "#ffffff"
                    }
              }
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: financeMode ? "#c4b5fd" : "#7c3aed" }}>
                    {cue.eyebrow}
                  </div>
                  <div className={`mt-1 text-sm font-semibold ${financeMode ? "text-slate-100" : "text-slate-900"}`}>{cue.title}</div>
                  <div className="mt-1 text-sm text-slate-500">{cue.detail}</div>
                  <div className="mt-2 text-xs text-slate-500">{cue.consequence}</div>
                </div>
                <div className="shrink-0 text-xs font-semibold text-slate-500">{cue.actionLabel}</div>
              </div>
            </button>
          )) : (
            <div
              className="rounded-[18px] px-4 py-4 text-sm text-slate-500"
              style={
                financeMode
                  ? {
                      border: "1px solid rgba(255,255,255,0.08)",
                      background: "rgba(255,255,255,0.04)"
                    }
                  : {
                      border: "1px solid #dbeafe",
                      background: "#ffffff"
                    }
              }
            >
              Cross-module handoff cues will appear here when finance pressure and warehouse pressure start affecting each other.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ metric, onSelect, financeMode = false, onActivate = null }) {
  const meta = financeMetricMeta(metric);
  const clickHandler = onActivate || (() => onSelect(metric));
  const highlightTone = metric?.highlightTone || "";
  const highlightStyle =
    !financeMode && highlightTone === "danger"
      ? { background: "linear-gradient(135deg,#fff1f2,#ffe4e6)", color: "#be123c" }
      : !financeMode && highlightTone === "warning"
        ? { background: "linear-gradient(135deg,#fffbeb,#fef3c7)", color: "#b45309" }
        : !financeMode && highlightTone === "info"
          ? { background: "linear-gradient(135deg,#eff6ff,#dbeafe)", color: "#1d4ed8" }
          : undefined;

  return (
    <motion.button
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      type="button"
      onClick={clickHandler}
      className={`text-left ${financeMode ? "rounded-[22px] p-5" : `rounded-2xl bg-gradient-to-br p-4 shadow-sm ${metricTone(metric.id)}`}`}
      style={
        financeMode
          ? {
              border: "1px solid rgba(255,255,255,0.08)",
              background: "#111827",
              boxShadow: "0 8px 32px rgba(0,0,0,0.35)"
            }
          : highlightStyle
      }
    >
      <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${financeMode ? "" : "text-current/70"}`} style={financeMode ? { color: meta.accent } : undefined}>
        {financeMode ? meta.label : metric.label}
      </p>
      <p className={`mt-2 font-bold ${financeMode ? "text-[28px] text-slate-50" : "text-2xl"}`} style={financeMode ? { fontFamily: '"Sora","Manrope","DM Sans","Segoe UI",sans-serif' } : undefined}>
        {metric.value}
      </p>
      {metric.subvalue ? <p className={`mt-1 text-xs ${financeMode ? "text-slate-400" : "text-current/70"}`}>{metric.subvalue}</p> : null}
    </motion.button>
  );
}

function DueDateTone({ dueDate, status }) {
  if (status === "approved") return "bg-emerald-100 text-emerald-700";
  if (status === "rejected") return "bg-rose-100 text-rose-700";
  const diffDays = Math.ceil((new Date(dueDate).getTime() - Date.now()) / 86400000);
  if (status === "overdue" || diffDays < 0) return "bg-rose-100 text-rose-700";
  if (diffDays <= 2) return "bg-orange-100 text-orange-700";
  return "bg-emerald-100 text-emerald-700";
}

