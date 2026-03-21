import { useCallback } from "react";

import { api } from "../../../api";
import { normalizeCurrencyCode } from "../../../utils/currency.js";
import { loadPlaidLinkScript, roundMoney, todayDateInputValue, uid } from "../WorkspaceMessenger.utils.js";

export default function useWorkspaceBankingAndPayroll({
  authToken,
  activeWorkspaceId,
  realFinanceEnabled,
  workspaceDefaultCurrency,
  financeBankAccounts,
  pushToast,
  setFinancePayrollRecords,
  setFinanceBankAccounts,
  setFinanceBankTransactions,
  loadRealFinanceState
}) {
  const loadPayrollRecords = useCallback(async (options = {}, tokenToUse = authToken, workspaceIdToUse = activeWorkspaceId) => {
    if (!tokenToUse || !realFinanceEnabled || !workspaceIdToUse) {
      return [];
    }

    const payload = await api.getPayrollRecords(tokenToUse, workspaceIdToUse, options);
    const records = Array.isArray(payload) ? payload : [];
    setFinancePayrollRecords(records);
    return records;
  }, [activeWorkspaceId, authToken, realFinanceEnabled]);

  const handleCreatePayrollRecord = useCallback(async (payload = {}) => {
    if (!realFinanceEnabled || !authToken || !activeWorkspaceId) {
      return null;
    }

    try {
      const record = await api.createPayrollRecord(authToken, payload, activeWorkspaceId);
      await loadRealFinanceState(authToken, { toastOnSuccess: false }, activeWorkspaceId);
      pushToast({
        title: "Payroll record created",
        body: `${record.employeeName || "Employee payroll"} is ready for approval.`
      });
      return record;
    } catch (error) {
      pushToast({
        title: "Unable to create payroll",
        body: error.message || "Please try again."
      });
      return null;
    }
  }, [activeWorkspaceId, authToken, loadRealFinanceState, pushToast, realFinanceEnabled]);

  const handleApprovePayrollRecord = useCallback(async (recordId) => {
    if (!recordId || !realFinanceEnabled || !authToken || !activeWorkspaceId) {
      return null;
    }

    try {
      const record = await api.approvePayrollRecord(authToken, recordId, activeWorkspaceId);
      await loadRealFinanceState(authToken, { toastOnSuccess: false }, activeWorkspaceId);
      pushToast({
        title: "Payroll approved",
        body: `${record.employeeName || "Payroll record"} is ready to be paid.`
      });
      return record;
    } catch (error) {
      pushToast({
        title: "Unable to approve payroll",
        body: error.message || "Please try again."
      });
      return null;
    }
  }, [activeWorkspaceId, authToken, loadRealFinanceState, pushToast, realFinanceEnabled]);

  const handlePayPayrollRecord = useCallback(async (recordId, payload = {}) => {
    if (!recordId || !realFinanceEnabled || !authToken || !activeWorkspaceId) {
      return null;
    }

    try {
      const record = await api.payPayrollRecord(authToken, recordId, payload, activeWorkspaceId);
      await loadRealFinanceState(authToken, { toastOnSuccess: false }, activeWorkspaceId);
      pushToast({
        title: "Payroll paid",
        body: `${record.employeeName || "Payroll record"} has been marked as paid.`
      });
      return record;
    } catch (error) {
      pushToast({
        title: "Unable to pay payroll",
        body: error.message || "Please try again."
      });
      return null;
    }
  }, [activeWorkspaceId, authToken, loadRealFinanceState, pushToast, realFinanceEnabled]);

  const handleCancelPayrollRecord = useCallback(async (recordId) => {
    if (!recordId || !realFinanceEnabled || !authToken || !activeWorkspaceId) {
      return null;
    }

    try {
      const record = await api.cancelPayrollRecord(authToken, recordId, activeWorkspaceId);
      await loadRealFinanceState(authToken, { toastOnSuccess: false }, activeWorkspaceId);
      pushToast({
        title: "Payroll cancelled",
        body: `${record.employeeName || "Payroll record"} has been cancelled.`
      });
      return record;
    } catch (error) {
      pushToast({
        title: "Unable to cancel payroll",
        body: error.message || "Please try again."
      });
      return null;
    }
  }, [activeWorkspaceId, authToken, loadRealFinanceState, pushToast, realFinanceEnabled]);

  const handleCreateBankAccount = useCallback(async (payload) => {
    const nextCurrency = normalizeCurrencyCode(payload?.currency || workspaceDefaultCurrency || "USD");
    const nextBalance = Number.parseFloat(payload?.currentBalance ?? 0);

    if (!String(payload?.accountName || "").trim()) {
      pushToast({
        title: "Bank account name required",
        body: "Add an account name before saving."
      });
      return null;
    }

    if (!Number.isFinite(nextBalance)) {
      pushToast({
        title: "Balance required",
        body: "Enter a valid current balance."
      });
      return null;
    }

    if (realFinanceEnabled && authToken && activeWorkspaceId) {
      try {
        const account = await api.createBankAccount(authToken, {
          accountName: payload.accountName,
          accountType: payload.accountType || "checking",
          currency: nextCurrency,
          currentBalance: nextBalance
        }, activeWorkspaceId);
        await loadRealFinanceState(authToken, { toastOnSuccess: false }, activeWorkspaceId);
        pushToast({
          title: "Bank account added",
          body: `${account.accountName} is now tracked in Finance.`
        });
        return account;
      } catch (error) {
        pushToast({
          title: "Unable to add bank account",
          body: error.message || "Please try again."
        });
        return null;
      }
    }

    const account = {
      id: uid("bank"),
      accountName: String(payload.accountName || "").trim(),
      accountType: payload.accountType || "checking",
      currency: nextCurrency,
      currentBalance: roundMoney(nextBalance),
      lastSyncedAt: new Date().toISOString(),
      provider: "",
      providerAccountId: "",
      isManual: true,
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    setFinanceBankAccounts((current) => [account, ...current]);
    return account;
  }, [activeWorkspaceId, authToken, loadRealFinanceState, pushToast, realFinanceEnabled, workspaceDefaultCurrency]);

  const handleConnectPlaidBankAccount = useCallback(async (payload = {}) => {
    if (!realFinanceEnabled || !authToken || !activeWorkspaceId) {
      return null;
    }

    try {
      const linkPayload = await api.createPlaidLinkToken(authToken, activeWorkspaceId);
      try {
        await loadPlaidLinkScript();
      } catch {
        // Fall back to the token exchange path if the hosted script is unavailable.
      }

      const linkedAccount = await api.exchangePlaidToken(authToken, {
        publicToken: payload.publicToken || linkPayload?.linkToken || `public-${Date.now()}`,
        accountName: payload.accountName || "Plaid Connected Account",
        currency: payload.currency || workspaceDefaultCurrency || "USD",
        plaidAccountId: payload.plaidAccountId || "",
        institutionName: payload.institutionName || "Plaid Bank",
        mask: payload.mask || "0000",
        accountType: payload.accountType || "checking"
      }, activeWorkspaceId);
      await loadRealFinanceState(authToken, { toastOnSuccess: false }, activeWorkspaceId);
      pushToast({
        title: "Bank connected",
        body: `${linkedAccount.accountName} is now linked through Plaid.`
      });
      return linkedAccount;
    } catch (error) {
      pushToast({
        title: "Unable to connect bank",
        body: error.message || "Plaid connection could not be completed."
      });
      return null;
    }
  }, [activeWorkspaceId, authToken, loadRealFinanceState, pushToast, realFinanceEnabled, workspaceDefaultCurrency]);

  const handleUpdateBankAccount = useCallback(async (accountId, payload) => {
    if (!accountId) {
      return null;
    }

    if (realFinanceEnabled && authToken && activeWorkspaceId) {
      try {
        const account = await api.updateBankAccount(authToken, accountId, payload, activeWorkspaceId);
        await loadRealFinanceState(authToken, { toastOnSuccess: false }, activeWorkspaceId);
        return account;
      } catch (error) {
        pushToast({
          title: "Unable to update bank account",
          body: error.message || "Please try again."
        });
        return null;
      }
    }

    let updated = null;
    setFinanceBankAccounts((current) =>
      current.map((account) => {
        if (account.id !== accountId) {
          return account;
        }
        updated = { ...account, ...payload, updatedAt: new Date().toISOString() };
        return updated;
      })
    );
    return updated;
  }, [activeWorkspaceId, authToken, loadRealFinanceState, pushToast, realFinanceEnabled]);

  const handleDeleteBankAccount = useCallback(async (accountId) => {
    if (!accountId) {
      return null;
    }

    if (realFinanceEnabled && authToken && activeWorkspaceId) {
      try {
        const account = await api.deleteBankAccount(authToken, accountId, activeWorkspaceId);
        await loadRealFinanceState(authToken, { toastOnSuccess: false }, activeWorkspaceId);
        return account;
      } catch (error) {
        pushToast({
          title: "Unable to disconnect bank account",
          body: error.message || "Please try again."
        });
        return null;
      }
    }

    setFinanceBankAccounts((current) => current.filter((account) => account.id !== accountId));
    setFinanceBankTransactions((current) => {
      const next = { ...current };
      delete next[accountId];
      return next;
    });
    return { id: accountId };
  }, [activeWorkspaceId, authToken, loadRealFinanceState, pushToast, realFinanceEnabled]);

  const handleCreateBankTransaction = useCallback(async (accountId, payload) => {
    if (!accountId) {
      return null;
    }

    const amount = Number.parseFloat(payload?.amount);
    if (!Number.isFinite(amount) || amount === 0) {
      pushToast({
        title: "Transaction amount required",
        body: "Enter a non-zero transaction amount."
      });
      return null;
    }

    if (realFinanceEnabled && authToken && activeWorkspaceId) {
      try {
        const transaction = await api.createBankTransaction(authToken, accountId, payload, activeWorkspaceId);
        await loadRealFinanceState(authToken, { toastOnSuccess: false }, activeWorkspaceId);
        return transaction;
      } catch (error) {
        pushToast({
          title: "Unable to add bank transaction",
          body: error.message || "Please try again."
        });
        return null;
      }
    }

    const account = financeBankAccounts.find((entry) => entry.id === accountId);
    const transaction = {
      id: uid("bank-tx"),
      bankAccountId: accountId,
      transactionDate: payload.transactionDate || todayDateInputValue(),
      description: String(payload.description || "").trim(),
      amount: roundMoney(amount),
      currency: normalizeCurrencyCode(payload.currency || account?.currency || workspaceDefaultCurrency || "USD"),
      category: String(payload.category || "other").trim(),
      matchedExpenseId: "",
      matchedInvoicePaymentId: "",
      reconciled: false,
      reconciledAt: null,
      source: "manual",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    setFinanceBankTransactions((current) => ({
      ...current,
      [accountId]: [transaction, ...(current[accountId] || [])]
    }));
    setFinanceBankAccounts((current) =>
      current.map((entry) =>
        entry.id === accountId
          ? {
              ...entry,
              currentBalance: roundMoney(Number(entry.currentBalance || 0) + transaction.amount),
              lastSyncedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          : entry
      )
    );
    return transaction;
  }, [activeWorkspaceId, authToken, financeBankAccounts, loadRealFinanceState, pushToast, realFinanceEnabled, workspaceDefaultCurrency]);

  const handleSyncBankTransactions = useCallback(async (accountId, transactions = []) => {
    if (!accountId || !Array.isArray(transactions) || !transactions.length) {
      pushToast({
        title: "Import file required",
        body: "Upload a CSV with date, description, amount, and currency columns."
      });
      return null;
    }

    if (realFinanceEnabled && authToken && activeWorkspaceId) {
      try {
        const result = await api.syncBankTransactions(authToken, accountId, transactions, activeWorkspaceId);
        await loadRealFinanceState(authToken, { toastOnSuccess: false }, activeWorkspaceId);
        pushToast({
          title: "Transactions imported",
          body: `${result.imported || 0} imported, ${result.duplicates || 0} duplicates skipped.`
        });
        return result;
      } catch (error) {
        pushToast({
          title: "Unable to import transactions",
          body: error.message || "Please try again."
        });
        return null;
      }
    }

    let imported = 0;
    setFinanceBankTransactions((current) => ({
      ...current,
      [accountId]: [
        ...(transactions.map((transaction) => {
          imported += 1;
          return {
            id: uid("bank-tx"),
            bankAccountId: accountId,
            transactionDate: transaction.transactionDate || todayDateInputValue(),
            description: transaction.description,
            amount: roundMoney(Number(transaction.amount || 0)),
            currency: normalizeCurrencyCode(transaction.currency || workspaceDefaultCurrency || "USD"),
            category: transaction.category || "other",
            matchedExpenseId: "",
            matchedInvoicePaymentId: "",
            reconciled: false,
            reconciledAt: null,
            source: "bank_sync",
            providerTransactionId: transaction.providerTransactionId || uid("provider-tx"),
            matchConfidence: 0,
            matchSuggestions: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
        })),
        ...(current[accountId] || [])
      ]
    }));
    setFinanceBankAccounts((current) =>
      current.map((account) =>
        account.id === accountId
          ? { ...account, lastSyncedAt: new Date().toISOString() }
          : account
      )
    );
    pushToast({
      title: "Transactions imported",
      body: `${imported} transactions were added to the selected account.`
    });
    return { imported, duplicates: 0, errors: [] };
  }, [activeWorkspaceId, authToken, loadRealFinanceState, pushToast, realFinanceEnabled, workspaceDefaultCurrency]);

  const handleSyncPlaidAccount = useCallback(async (accountId) => {
    if (!accountId || !realFinanceEnabled || !authToken || !activeWorkspaceId) {
      return null;
    }

    try {
      const result = await api.syncPlaidAccount(authToken, accountId, activeWorkspaceId);
      await loadRealFinanceState(authToken, { toastOnSuccess: false }, activeWorkspaceId);
      pushToast({
        title: "Plaid sync complete",
        body: `${result.imported || 0} transactions imported.`
      });
      return result;
    } catch (error) {
      pushToast({
        title: "Plaid sync failed",
        body: error.message || "Unable to sync the linked bank account."
      });
      return null;
    }
  }, [activeWorkspaceId, authToken, loadRealFinanceState, pushToast, realFinanceEnabled]);

  const handleRefreshPlaidBalance = useCallback(async (accountId) => {
    if (!accountId || !realFinanceEnabled || !authToken || !activeWorkspaceId) {
      return null;
    }

    try {
      const result = await api.refreshPlaidBalance(authToken, accountId, activeWorkspaceId);
      await loadRealFinanceState(authToken, { toastOnSuccess: false }, activeWorkspaceId);
      return result;
    } catch (error) {
      pushToast({
        title: "Balance refresh failed",
        body: error.message || "Unable to refresh the linked account balance."
      });
      return null;
    }
  }, [activeWorkspaceId, authToken, loadRealFinanceState, pushToast, realFinanceEnabled]);

  const handleAutoMatchBankTransactions = useCallback(async (accountId) => {
    if (!accountId) {
      return [];
    }

    if (realFinanceEnabled && authToken && activeWorkspaceId) {
      try {
        const suggestions = await api.autoMatchBankTransactions(authToken, accountId, activeWorkspaceId);
        await loadRealFinanceState(authToken, { toastOnSuccess: false }, activeWorkspaceId);
        pushToast({
          title: "Auto-match complete",
          body: `${Array.isArray(suggestions) ? suggestions.length : 0} transactions were reviewed for match suggestions.`
        });
        return suggestions;
      } catch (error) {
        pushToast({
          title: "Unable to auto-match transactions",
          body: error.message || "Please try again."
        });
        return [];
      }
    }

    return [];
  }, [activeWorkspaceId, authToken, loadRealFinanceState, pushToast, realFinanceEnabled]);

  const handleMatchBankTransactionExpense = useCallback(async (transactionId, expenseId) => {
    if (!transactionId || !expenseId) {
      return null;
    }

    if (realFinanceEnabled && authToken && activeWorkspaceId) {
      try {
        const transaction = await api.matchTransactionExpense(authToken, transactionId, expenseId, activeWorkspaceId);
        await loadRealFinanceState(authToken, { toastOnSuccess: false }, activeWorkspaceId);
        return transaction;
      } catch (error) {
        pushToast({
          title: "Unable to match expense",
          body: error.message || "Please try again."
        });
        return null;
      }
    }

    setFinanceBankTransactions((current) =>
      Object.fromEntries(
        Object.entries(current).map(([accountId, entries]) => [
          accountId,
          entries.map((entry) => (entry.id === transactionId ? { ...entry, matchedExpenseId: expenseId, updatedAt: new Date().toISOString() } : entry))
        ])
      )
    );
    return { id: transactionId, matchedExpenseId: expenseId };
  }, [activeWorkspaceId, authToken, loadRealFinanceState, pushToast, realFinanceEnabled]);

  const handleMatchBankTransactionPayment = useCallback(async (transactionId, paymentId) => {
    if (!transactionId || !paymentId) {
      return null;
    }

    if (realFinanceEnabled && authToken && activeWorkspaceId) {
      try {
        const transaction = await api.matchTransactionPayment(authToken, transactionId, paymentId, activeWorkspaceId);
        await loadRealFinanceState(authToken, { toastOnSuccess: false }, activeWorkspaceId);
        return transaction;
      } catch (error) {
        pushToast({
          title: "Unable to match payment",
          body: error.message || "Please try again."
        });
        return null;
      }
    }

    setFinanceBankTransactions((current) =>
      Object.fromEntries(
        Object.entries(current).map(([accountId, entries]) => [
          accountId,
          entries.map((entry) => (entry.id === transactionId ? { ...entry, matchedInvoicePaymentId: paymentId, updatedAt: new Date().toISOString() } : entry))
        ])
      )
    );
    return { id: transactionId, matchedInvoicePaymentId: paymentId };
  }, [activeWorkspaceId, authToken, loadRealFinanceState, pushToast, realFinanceEnabled]);

  const handleReconcileBankTransaction = useCallback(async (transactionId) => {
    if (!transactionId) {
      return null;
    }

    if (realFinanceEnabled && authToken && activeWorkspaceId) {
      try {
        const transaction = await api.reconcileTransaction(authToken, transactionId, activeWorkspaceId);
        await loadRealFinanceState(authToken, { toastOnSuccess: false }, activeWorkspaceId);
        return transaction;
      } catch (error) {
        pushToast({
          title: "Unable to reconcile transaction",
          body: error.message || "Please try again."
        });
        return null;
      }
    }

    setFinanceBankTransactions((current) =>
      Object.fromEntries(
        Object.entries(current).map(([accountId, entries]) => [
          accountId,
          entries.map((entry) =>
            entry.id === transactionId
              ? { ...entry, reconciled: true, reconciledAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
              : entry
          )
        ])
      )
    );
    return { id: transactionId, reconciled: true };
  }, [activeWorkspaceId, authToken, loadRealFinanceState, pushToast, realFinanceEnabled]);

  const handleReconcileMatchedBankTransactions = useCallback(async (accountId) => {
    if (!accountId) {
      return null;
    }

    if (realFinanceEnabled && authToken && activeWorkspaceId) {
      try {
        const result = await api.reconcileMatchedBankTransactions(authToken, accountId, activeWorkspaceId);
        await loadRealFinanceState(authToken, { toastOnSuccess: false }, activeWorkspaceId);
        pushToast({
          title: "Matched transactions reconciled",
          body: `${result.modifiedCount || result.reconciled || 0} matched transactions were marked reconciled.`
        });
        return result;
      } catch (error) {
        pushToast({
          title: "Unable to reconcile matched transactions",
          body: error.message || "Please try again."
        });
        return null;
      }
    }

    setFinanceBankTransactions((current) =>
      Object.fromEntries(
        Object.entries(current).map(([entryAccountId, entries]) => [
          entryAccountId,
          entryAccountId === accountId
            ? entries.map((entry) =>
                entry.matchedExpenseId || entry.matchedInvoicePaymentId
                  ? { ...entry, reconciled: true, reconciledAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
                  : entry
              )
            : entries
        ])
      )
    );
    return { reconciled: true };
  }, [activeWorkspaceId, authToken, loadRealFinanceState, pushToast, realFinanceEnabled]);

  return {
    loadPayrollRecords,
    handleCreatePayrollRecord,
    handleApprovePayrollRecord,
    handlePayPayrollRecord,
    handleCancelPayrollRecord,
    handleCreateBankAccount,
    handleConnectPlaidBankAccount,
    handleUpdateBankAccount,
    handleDeleteBankAccount,
    handleCreateBankTransaction,
    handleSyncBankTransactions,
    handleSyncPlaidAccount,
    handleRefreshPlaidBalance,
    handleAutoMatchBankTransactions,
    handleMatchBankTransactionExpense,
    handleMatchBankTransactionPayment,
    handleReconcileBankTransaction,
    handleReconcileMatchedBankTransactions
  };
}
