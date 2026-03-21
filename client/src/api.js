const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:5001/api" : "");
const API_ORIGIN = API_URL ? new URL(API_URL, window.location.origin).origin : "";

export function resolveApiAssetUrl(assetPath = "") {
  if (!assetPath) {
    return "";
  }

  if (/^https?:\/\//i.test(assetPath) || assetPath.startsWith("data:")) {
    return assetPath;
  }

  return `${API_ORIGIN}${assetPath}`;
}

async function request(path, options = {}) {
  const { token, body, headers, workspaceId, ...rest } = options;

  if (!API_URL) {
    throw new Error("API URL is not configured for this deployment.");
  }

  let response;

  try {
    response = await fetch(`${API_URL}${path}`, {
      ...rest,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
        ...headers
      },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (error) {
    throw new Error("Unable to reach the server. Refresh the page and check the live backend URL/CORS settings.");
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.message || "Request failed.");
  }

  return payload;
}

function parseDownloadFilename(contentDisposition = "", fallback = "download.bin") {
  const utfMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) {
    return decodeURIComponent(utfMatch[1]);
  }

  const quotedMatch = contentDisposition.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1];
  }

  const plainMatch = contentDisposition.match(/filename=([^;]+)/i);
  if (plainMatch?.[1]) {
    return plainMatch[1].trim();
  }

  return fallback;
}

export const api = {
  login(credentials) {
    return request("/auth/login", {
      method: "POST",
      body: credentials
    });
  },
  verifyTwoFactor(payload) {
    return request("/auth/verify-2fa", {
      method: "POST",
      body: payload
    });
  },
  register(credentials) {
    return request("/auth/register", {
      method: "POST",
      body: credentials
    });
  },
  getMe(token) {
    return request("/auth/me", { token });
  },
  forgotPassword(email) {
    return request("/auth/forgot-password", {
      method: "POST",
      body: { email }
    });
  },
  resetPassword(payload) {
    return request("/auth/reset-password", {
      method: "POST",
      body: payload
    });
  },
  logout(token) {
    return request("/auth/logout", {
      method: "POST",
      token
    });
  },
  logoutAll(token) {
    return request("/auth/logout-all", {
      method: "POST",
      token
    });
  },
  requestTwoFactorSetup(token) {
    return request("/auth/2fa/request-setup", {
      method: "POST",
      token
    });
  },
  enableTwoFactor(token, code) {
    return request("/auth/2fa/enable", {
      method: "POST",
      token,
      body: { code }
    });
  },
  disableTwoFactor(token) {
    return request("/auth/2fa/disable", {
      method: "POST",
      token
    });
  },
  getUsers(token) {
    return request("/users", { token });
  },
  updateProfile(token, body) {
    return request("/users/me/profile", {
      method: "PATCH",
      token,
      body
    });
  },
  getPushConfig(token) {
    return request("/users/me/push-config", { token });
  },
  savePushSubscription(token, subscription) {
    return request("/users/me/push-subscriptions", {
      method: "POST",
      token,
      body: { subscription }
    });
  },
  removePushSubscription(token, endpoint) {
    return request("/users/me/push-subscriptions", {
      method: "DELETE",
      token,
      body: { endpoint }
    });
  },
  updatePreferences(token, contactId, body) {
    return request(`/users/${contactId}/preferences`, {
      method: "PATCH",
      token,
      body
    });
  },
  getMessages(token, contactId, options = {}) {
    const params = new URLSearchParams();

    if (options.before) {
      params.set("before", options.before);
    }

    if (options.q) {
      params.set("q", options.q);
    }

    if (options.starred) {
      params.set("starred", "true");
    }

    if (options.limit) {
      params.set("limit", String(options.limit));
    }

    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request(`/messages/${contactId}${suffix}`, { token });
  },
  sendMessage(token, contactId, payload) {
    return request(`/messages/${contactId}`, {
      method: "POST",
      token,
      body: payload
    });
  },
  getPdfReviewSessions(token, contactId) {
    return request(`/pdf-reviews/${contactId}`, { token });
  },
  createPdfReviewSession(token, contactId, payload) {
    return request(`/pdf-reviews/${contactId}`, {
      method: "POST",
      token,
      body: payload
    });
  },
  getMemoryCapsules(token, contactId) {
    return request(`/memory-capsules/${contactId}`, { token });
  },
  getQuranSurah(surahNumber, translation = "en.asad") {
    const params = new URLSearchParams({ translation });
    return request(`/quran/surah/${surahNumber}?${params.toString()}`);
  },
  createMemoryCapsule(token, contactId, payload) {
    return request(`/memory-capsules/${contactId}`, {
      method: "POST",
      token,
      body: payload
    });
  },
  updateMemoryCapsule(token, capsuleId, payload) {
    return request(`/memory-capsules/${capsuleId}`, {
      method: "PATCH",
      token,
      body: payload
    });
  },
  respondPdfReviewSession(token, sessionId, decision) {
    return request(`/pdf-reviews/${sessionId}/respond`, {
      method: "POST",
      token,
      body: { decision }
    });
  },
  updatePdfReviewSession(token, sessionId, payload) {
    return request(`/pdf-reviews/${sessionId}`, {
      method: "PATCH",
      token,
      body: payload
    });
  },
  exportMessages(token, contactId) {
    return request(`/messages/${contactId}/export`, { token });
  },
  editMessage(token, messageId, text) {
    return request(`/messages/${messageId}`, {
      method: "PATCH",
      token,
      body: { text }
    });
  },
  deleteMessage(token, messageId) {
    return request(`/messages/${messageId}`, {
      method: "DELETE",
      token
    });
  },
  toggleReaction(token, messageId, emoji) {
    return request(`/messages/${messageId}/reactions`, {
      method: "POST",
      token,
      body: { emoji }
    });
  },
  toggleStar(token, messageId) {
    return request(`/messages/${messageId}/star`, {
      method: "POST",
      token
    });
  },
  togglePinnedMessage(token, messageId) {
    return request(`/messages/${messageId}/pin`, {
      method: "POST",
      token
    });
  },
  markConversationSeen(token, contactId) {
    return request(`/messages/${contactId}/seen`, {
      method: "POST",
      token
    });
  },
  openSnap(token, messageId) {
    return request(`/messages/${messageId}/open-snap`, {
      method: "POST",
      token
    });
  },
  getWorkspaces(token) {
    return request("/workspaces", { token });
  },
  getPlatformWorkspaces(token) {
    return request("/platform/workspaces", { token });
  },
  createPlatformWorkspace(token, payload) {
    return request("/platform/workspaces", {
      method: "POST",
      token,
      body: payload
    });
  },
  getPlatformWorkspace(token, workspaceId) {
    return request(`/platform/workspaces/${workspaceId}`, { token });
  },
  getPlatformWorkspaceMembers(token, workspaceId) {
    return request(`/platform/workspaces/${workspaceId}/members`, { token });
  },
  provisionPlatformWorkspaceMember(token, workspaceId, payload) {
    return request(`/platform/workspaces/${workspaceId}/members`, {
      method: "POST",
      token,
      body: payload
    });
  },
  updatePlatformWorkspaceMember(token, workspaceId, userId, payload) {
    return request(`/platform/workspaces/${workspaceId}/members/${userId}`, {
      method: "PATCH",
      token,
      body: payload
    });
  },
  updatePlatformWorkspaceMemberStatus(token, workspaceId, userId, status) {
    return request(`/platform/workspaces/${workspaceId}/members/${userId}/status`, {
      method: "PATCH",
      token,
      body: { status }
    });
  },
  getWorkspaceContext(token, workspaceId = null) {
    return request("/workspaces/context", { token, workspaceId });
  },
  getWorkspaceSettings(token, workspaceId = null) {
    return request("/workspaces/settings", { token, workspaceId });
  },
  updateWorkspaceDefaultCurrency(token, defaultCurrency, workspaceId = null) {
    return request("/workspaces/settings/default-currency", {
      method: "PATCH",
      token,
      workspaceId,
      body: { defaultCurrency }
    });
  },
  enableWorkspaceAccounting(token, workspaceId = null) {
    return request("/workspaces/settings/accounting/enable", {
      method: "POST",
      token,
      workspaceId
    });
  },
  getWorkspaceConversations(token, workspaceId = null) {
    return request("/workspaces/conversations", { token, workspaceId });
  },
  sendWorkspaceConversationMessage(token, conversationId, payload, workspaceId = null) {
    return request(`/workspaces/conversations/${conversationId}/messages`, {
      method: "POST",
      token,
      workspaceId,
      body: payload
    });
  },
  getWorkspaceMembers(token, workspaceId = null) {
    return request("/workspaces/members", { token, workspaceId });
  },
  updateWorkspaceMemberAccess(token, userId, payload, workspaceId = null) {
    return request(`/workspaces/members/${userId}/access`, {
      method: "PATCH",
      token,
      workspaceId,
      body: payload
    });
  },
  getWorkspaceTasks(token, options = {}, workspaceId = null) {
    const params = new URLSearchParams();
    if (options.mode && options.mode !== "all") {
      params.set("mode", options.mode);
    }

    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request(`/tasks${suffix}`, { token, workspaceId });
  },
  getWorkspaceMyTasks(token, workspaceId = null) {
    return request("/tasks/my-tasks", { token, workspaceId });
  },
  getWorkspaceOverdueTasks(token, workspaceId = null) {
    return request("/tasks/overdue", { token, workspaceId });
  },
  createWorkspaceTask(token, payload, workspaceId = null) {
    return request("/tasks", {
      method: "POST",
      token,
      workspaceId,
      body: payload
    });
  },
  updateWorkspaceTask(token, taskId, payload, workspaceId = null) {
    return request(`/tasks/${taskId}`, {
      method: "PATCH",
      token,
      workspaceId,
      body: payload
    });
  },
  deleteWorkspaceTask(token, taskId, workspaceId = null) {
    return request(`/tasks/${taskId}`, {
      method: "DELETE",
      token,
      workspaceId
    });
  },
  getWorkspaceProjects(token, workspaceId = null) {
    return request("/projects", { token, workspaceId });
  },
  getWorkspaceProjectTasks(token, projectId, workspaceId = null) {
    return request(`/projects/${projectId}/tasks`, { token, workspaceId });
  },
  getWorkspaceExecutionSummary(token, workspaceId = null) {
    return request("/projects/summary", { token, workspaceId });
  },
  getWorkspaceOverview(token, workspaceId = null) {
    return request("/workspaces/overview", { token, workspaceId });
  },
  createWorkspaceProject(token, payload, workspaceId = null) {
    return request("/projects", {
      method: "POST",
      token,
      workspaceId,
      body: payload
    });
  },
  attachWorkspaceProjectConversationLink(token, projectId, payload, workspaceId = null) {
    return request(`/projects/${projectId}/conversation-link`, {
      method: "POST",
      token,
      workspaceId,
      body: payload
    });
  },
  updateWorkspaceProject(token, projectId, payload, workspaceId = null) {
    return request(`/projects/${projectId}`, {
      method: "PATCH",
      token,
      workspaceId,
      body: payload
    });
  },
  updateWorkspaceProjectStatus(token, projectId, status, workspaceId = null) {
    return request(`/projects/${projectId}/status`, {
      method: "PATCH",
      token,
      workspaceId,
      body: { status }
    });
  },
  deleteWorkspaceProject(token, projectId, workspaceId = null) {
    return request(`/projects/${projectId}`, {
      method: "DELETE",
      token,
      workspaceId
    });
  },
  getWorkspaceNotifications(token, workspaceId = null) {
    return request("/notifications", { token, workspaceId });
  },
  getWorkspaceNotificationCount(token, workspaceId = null) {
    return request("/notifications/count", { token, workspaceId });
  },
  markWorkspaceNotificationRead(token, notificationId, workspaceId = null) {
    return request(`/notifications/${notificationId}/read`, {
      method: "PATCH",
      token,
      workspaceId
    });
  },
  markAllWorkspaceNotificationsRead(token, workspaceId = null) {
    return request("/notifications/read-all", {
      method: "PATCH",
      token,
      workspaceId
    });
  },
  getFinanceWorkspaces(token) {
    return request("/finance/workspaces", { token });
  },
  getFinanceContext(token, workspaceId = null) {
    return request("/finance/context", { token, workspaceId });
  },
  getFinanceCustomers(token, workspaceId = null, options = {}) {
    const params = new URLSearchParams();
    if (options.status) {
      params.set("status", options.status);
    }

    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request(`/finance/customers${suffix}`, { token, workspaceId });
  },
  createFinanceCustomer(token, payload, workspaceId = null) {
    return request("/finance/customers", {
      method: "POST",
      token,
      workspaceId,
      body: payload
    });
  },
  updateFinanceCustomer(token, customerId, payload, workspaceId = null) {
    return request(`/finance/customers/${customerId}`, {
      method: "PATCH",
      token,
      workspaceId,
      body: payload
    });
  },
  getFinanceVendors(token, workspaceId = null, options = {}) {
    const params = new URLSearchParams();
    if (options.status) {
      params.set("status", options.status);
    }

    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request(`/finance/vendors${suffix}`, { token, workspaceId });
  },
  createFinanceVendor(token, payload, workspaceId = null) {
    return request("/finance/vendors", {
      method: "POST",
      token,
      workspaceId,
      body: payload
    });
  },
  updateFinanceVendor(token, vendorId, payload, workspaceId = null) {
    return request(`/finance/vendors/${vendorId}`, {
      method: "PATCH",
      token,
      workspaceId,
      body: payload
    });
  },
  getFinanceSummary(token, workspaceId = null, options = {}) {
    const params = new URLSearchParams();
    if (options.accountingPeriod) {
      params.set("accountingPeriod", options.accountingPeriod);
    }
    if (options.baseCurrency) {
      params.set("baseCurrency", options.baseCurrency);
    }

    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request(`/finance/summary${suffix}`, { token, workspaceId });
  },
  getFinanceFxRates(token, workspaceId = null, options = {}) {
    const params = new URLSearchParams();
    if (options.baseCurrency) {
      params.set("baseCurrency", options.baseCurrency);
    }
    if (options.refresh) {
      params.set("refresh", "true");
    }

    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request(`/finance/fx-rates${suffix}`, { token, workspaceId });
  },
  getFinanceTaxSummary(token, workspaceId = null, options = {}) {
    const params = new URLSearchParams();
    if (options.startDate) {
      params.set("startDate", options.startDate);
    }
    if (options.endDate) {
      params.set("endDate", options.endDate);
    }
    if (options.baseCurrency) {
      params.set("baseCurrency", options.baseCurrency);
    }

    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request(`/finance/tax-summary${suffix}`, { token, workspaceId });
  },
  getFinanceProfitLossReport(token, workspaceId = null, options = {}) {
    const params = new URLSearchParams();
    if (options.period) {
      params.set("period", options.period);
    }
    if (options.startDate) {
      params.set("startDate", options.startDate);
    }
    if (options.endDate) {
      params.set("endDate", options.endDate);
    }
    if (options.baseCurrency) {
      params.set("baseCurrency", options.baseCurrency);
    }

    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request(`/finance/reports/profit-loss${suffix}`, { token, workspaceId });
  },
  getFinanceCashFlowReport(token, workspaceId = null, options = {}) {
    const params = new URLSearchParams();
    if (options.period) {
      params.set("period", options.period);
    }
    if (options.startDate) {
      params.set("startDate", options.startDate);
    }
    if (options.endDate) {
      params.set("endDate", options.endDate);
    }
    if (options.baseCurrency) {
      params.set("baseCurrency", options.baseCurrency);
    }

    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request(`/finance/reports/cash-flow${suffix}`, { token, workspaceId });
  },
  getFinanceAgedReceivablesReport(token, workspaceId = null, options = {}) {
    const params = new URLSearchParams();
    if (options.startDate) {
      params.set("startDate", options.startDate);
    }
    if (options.endDate) {
      params.set("endDate", options.endDate);
    }
    if (options.baseCurrency) {
      params.set("baseCurrency", options.baseCurrency);
    }

    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request(`/finance/reports/aged-receivables${suffix}`, { token, workspaceId });
  },
  getFinanceBalanceSheetReport(token, workspaceId = null, options = {}) {
    const params = new URLSearchParams();
    if (options.asOfDate) {
      params.set("asOfDate", options.asOfDate);
    }
    if (options.baseCurrency) {
      params.set("baseCurrency", options.baseCurrency);
    }

    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request(`/finance/reports/balance-sheet${suffix}`, { token, workspaceId });
  },
  getFinanceAccountantSummary(token, workspaceId = null, options = {}) {
    const params = new URLSearchParams();
    if (options.baseCurrency) {
      params.set("baseCurrency", options.baseCurrency);
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request(`/finance/accountant-summary${suffix}`, { token, workspaceId });
  },
  getFinanceAccountDrilldown(token, accountCode, options = {}, workspaceId = null) {
    const params = new URLSearchParams();
    if (options.accountingPeriod) {
      params.set("accountingPeriod", options.accountingPeriod);
    }
    if (options.limit) {
      params.set("limit", String(options.limit));
    }

    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request(`/finance/accounting/accounts/${encodeURIComponent(accountCode)}${suffix}`, {
      token,
      workspaceId
    });
  },
  getFinanceAccountingStatementExport(token, workspaceId = null, options = {}) {
    const params = new URLSearchParams();
    if (options.accountingPeriod) {
      params.set("accountingPeriod", options.accountingPeriod);
    }
    if (options.variant) {
      params.set("variant", options.variant);
    }

    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request(`/finance/accounting/exports/statement${suffix}`, {
      token,
      workspaceId
    });
  },
  getFinanceAccountingJournalExport(token, workspaceId = null, options = {}) {
    const params = new URLSearchParams();
    if (options.accountingPeriod) {
      params.set("accountingPeriod", options.accountingPeriod);
    }
    if (options.limit) {
      params.set("limit", String(options.limit));
    }

    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request(`/finance/accounting/exports/journals${suffix}`, {
      token,
      workspaceId
    });
  },
  lockFinancePeriod(token, payload, workspaceId = null) {
    return request("/finance/accounting/period-locks", {
      method: "POST",
      token,
      workspaceId,
      body: payload
    });
  },
  unlockFinancePeriod(token, periodKey, workspaceId = null) {
    return request(`/finance/accounting/period-locks/${encodeURIComponent(periodKey)}`, {
      method: "DELETE",
      token,
      workspaceId
    });
  },
  getFinanceInvoices(token, options = {}, workspaceId = null) {
    const params = new URLSearchParams();
    if (options.status) {
      params.set("status", options.status);
    }
    if (options.customerId) {
      params.set("customerId", options.customerId);
    }
    if (options.recurring) {
      params.set("recurring", options.recurring);
    }

    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request(`/finance/invoices${suffix}`, { token, workspaceId });
  },
  getFinanceInvoiceDetail(token, invoiceId, workspaceId = null) {
    return request(`/finance/invoices/${invoiceId}`, { token, workspaceId });
  },
  createFinanceInvoice(token, payload, workspaceId = null) {
    return request("/finance/invoices", {
      method: "POST",
      token,
      workspaceId,
      body: payload
    });
  },
  updateFinanceInvoice(token, invoiceId, payload, workspaceId = null) {
    return request(`/finance/invoices/${invoiceId}`, {
      method: "PATCH",
      token,
      workspaceId,
      body: payload
    });
  },
  approveFinanceInvoice(token, invoiceId, workspaceId = null) {
    return request(`/finance/invoices/${invoiceId}/approve`, {
      method: "PATCH",
      token,
      workspaceId
    });
  },
  rejectFinanceInvoice(token, invoiceId, rejectionReason, workspaceId = null) {
    return request(`/finance/invoices/${invoiceId}/reject`, {
      method: "PATCH",
      token,
      workspaceId,
      body: { rejectionReason }
    });
  },
  markFinanceInvoicePaid(token, invoiceId, payment = null, workspaceId = null) {
    const body =
      payment === null
        ? undefined
        : typeof payment === "object"
          ? payment
          : { paidAmount: payment };

    return request(`/finance/invoices/${invoiceId}/paid`, {
      method: "PATCH",
      token,
      workspaceId,
      body
    });
  },
  issueNextFinanceInvoice(token, invoiceId, workspaceId = null) {
    return request(`/finance/invoices/${invoiceId}/issue-next`, {
      method: "POST",
      token,
      workspaceId
    });
  },
  reconcileFinanceInvoice(token, invoiceId, workspaceId = null) {
    return request(`/finance/invoices/${invoiceId}/reconcile`, {
      method: "PATCH",
      token,
      workspaceId
    });
  },
  async downloadInvoicePdf(token, invoiceId, workspaceId = null) {
    if (!API_URL) {
      throw new Error("API URL is not configured for this deployment.");
    }

    let response;

    try {
      response = await fetch(`${API_URL}/finance/invoices/${invoiceId}/pdf`, {
        method: "GET",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {})
        }
      });
    } catch (_error) {
      throw new Error("Unable to reach the server. Refresh the page and check the live backend URL/CORS settings.");
    }

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.message || "Unable to download invoice PDF.");
    }

    const blob = await response.blob();
    const filename = parseDownloadFilename(response.headers.get("Content-Disposition") || "", `invoice-${invoiceId}.pdf`);
    return { blob, filename };
  },
  getFinanceExpenses(token, options = {}, workspaceId = null) {
    const params = new URLSearchParams();
    if (options.status) {
      params.set("status", options.status);
    }
    if (options.vendorId) {
      params.set("vendorId", options.vendorId);
    }
    if (options.category) {
      params.set("category", options.category);
    }

    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request(`/finance/expenses${suffix}`, { token, workspaceId });
  },
  getFinanceExpenseDetail(token, expenseId, workspaceId = null) {
    return request(`/finance/expenses/${expenseId}`, { token, workspaceId });
  },
  getPayrollRecords(token, workspaceId = null, options = {}) {
    const params = new URLSearchParams();
    if (options.status) {
      params.set("status", options.status);
    }
    if (options.payPeriodStart) {
      params.set("payPeriodStart", options.payPeriodStart);
    }
    if (options.payPeriodEnd) {
      params.set("payPeriodEnd", options.payPeriodEnd);
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request(`/finance/payroll${suffix}`, { token, workspaceId });
  },
  getPayrollRecord(token, payrollId, workspaceId = null) {
    return request(`/finance/payroll/${payrollId}`, { token, workspaceId });
  },
  createPayrollRecord(token, payload, workspaceId = null) {
    return request("/finance/payroll", {
      method: "POST",
      token,
      workspaceId,
      body: payload
    });
  },
  approvePayrollRecord(token, payrollId, workspaceId = null) {
    return request(`/finance/payroll/${payrollId}/approve`, {
      method: "PATCH",
      token,
      workspaceId
    });
  },
  payPayrollRecord(token, payrollId, payload, workspaceId = null) {
    return request(`/finance/payroll/${payrollId}/pay`, {
      method: "PATCH",
      token,
      workspaceId,
      body: payload
    });
  },
  cancelPayrollRecord(token, payrollId, workspaceId = null) {
    return request(`/finance/payroll/${payrollId}/cancel`, {
      method: "PATCH",
      token,
      workspaceId
    });
  },
  getFinanceMembers(token, workspaceId = null) {
    return request("/finance/members", { token, workspaceId });
  },
  updateFinanceMemberAccess(token, userId, payload, workspaceId = null) {
    return request(`/finance/members/${userId}/access`, {
      method: "PATCH",
      token,
      workspaceId,
      body: payload
    });
  },
  updateFinanceMemberRoles(token, userId, workspaceRoles, workspaceId = null) {
    return request(`/finance/members/${userId}/roles`, {
      method: "PATCH",
      token,
      workspaceId,
      body: { workspaceRoles }
    });
  },
  createFinanceExpense(token, payload, workspaceId = null) {
    return request("/finance/expenses", {
      method: "POST",
      token,
      workspaceId,
      body: payload
    });
  },
  updateFinanceExpense(token, expenseId, payload, workspaceId = null) {
    return request(`/finance/expenses/${expenseId}`, {
      method: "PATCH",
      token,
      workspaceId,
      body: payload
    });
  },
  approveExpense(token, expenseId, workspaceId = null) {
    return request(`/finance/expenses/${expenseId}/approve`, {
      method: "PATCH",
      token,
      workspaceId
    });
  },
  rejectExpense(token, expenseId, reason, workspaceId = null) {
    return request(`/finance/expenses/${expenseId}/reject`, {
      method: "PATCH",
      token,
      workspaceId,
      body: { reason }
    });
  },
  reimburseExpense(token, expenseId, data = {}, workspaceId = null) {
    return request(`/finance/expenses/${expenseId}/reimburse`, {
      method: "PATCH",
      token,
      workspaceId,
      body: data
    });
  },
  reconcileFinanceExpense(token, expenseId, workspaceId = null) {
    return request(`/finance/expenses/${expenseId}/reconcile`, {
      method: "PATCH",
      token,
      workspaceId
    });
  },
  getFinanceActivity(token, options = {}, workspaceId = null) {
    const params = new URLSearchParams();
    if (options.limit) {
      params.set("limit", String(options.limit));
    }

    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request(`/finance/activity${suffix}`, { token, workspaceId });
  },
  getWarehouseSummary(token, workspaceId = null) {
    return request("/warehouse/summary", { token, workspaceId });
  },
  getWarehouseAlerts(token, workspaceId = null) {
    return request("/warehouse/alerts", { token, workspaceId });
  },
  getWarehouseInventoryValueReport(token, workspaceId = null) {
    return request("/warehouse/reports/inventory-value", { token, workspaceId });
  },
  getWarehouseProducts(token, workspaceId = null) {
    return request("/warehouse/products", { token, workspaceId });
  },
  getWarehouseMovements(token, options = {}, workspaceId = null) {
    const params = new URLSearchParams();
    if (options.limit) {
      params.set("limit", String(options.limit));
    }
    if (options.productId) {
      params.set("productId", String(options.productId));
    }

    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request(`/warehouse/movements${suffix}`, { token, workspaceId });
  },
  getWarehouseProductMovements(token, productId, workspaceId = null) {
    return request(`/warehouse/products/${productId}/movements`, { token, workspaceId });
  },
  createWarehouseProduct(token, payload, workspaceId = null) {
    return request("/warehouse/products", {
      method: "POST",
      token,
      workspaceId,
      body: payload
    });
  },
  updateWarehouseProduct(token, productId, payload, workspaceId = null) {
    return request(`/warehouse/products/${productId}`, {
      method: "PATCH",
      token,
      workspaceId,
      body: payload
    });
  },
  adjustWarehouseProductStock(token, productId, payload, workspaceId = null) {
    return request(`/warehouse/products/${productId}/adjust-stock`, {
      method: "PATCH",
      token,
      workspaceId,
      body: payload
    });
  },
  reorderWarehouseProduct(token, productId, reorderQuantity, workspaceId = null) {
    return request(`/warehouse/products/${productId}/reorder`, {
      method: "PATCH",
      token,
      workspaceId,
      body: { reorderQuantity }
    });
  },
  dismissWarehouseProduct(token, productId, workspaceId = null) {
    return request(`/warehouse/products/${productId}/dismiss`, {
      method: "PATCH",
      token,
      workspaceId
    });
  },
  getWarehouseOrders(token, workspaceId = null) {
    return request("/warehouse/orders", { token, workspaceId });
  },
  getWarehouseOrderReview(token, orderId, workspaceId = null) {
    return request(`/warehouse/orders/${orderId}/review`, { token, workspaceId });
  },
  createWarehouseOrder(token, payload, workspaceId = null) {
    return request("/warehouse/orders", {
      method: "POST",
      token,
      workspaceId,
      body: payload
    });
  },
  updateWarehouseOrderStatus(token, orderId, payload, workspaceId = null) {
    return request(`/warehouse/orders/${orderId}/status`, {
      method: "PATCH",
      token,
      workspaceId,
      body: payload
    });
  },
  markWarehouseOrderDelivered(token, orderId, workspaceId = null) {
    return request(`/warehouse/orders/${orderId}/delivered`, {
      method: "PATCH",
      token,
      workspaceId
    });
  },
  getPurchaseOrders(token, workspaceId = null, filters = {}) {
    const params = new URLSearchParams();
    if (filters.status) {
      params.set("status", String(filters.status));
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request(`/purchase-orders${suffix}`, { token, workspaceId });
  },
  getPurchaseOrder(token, id, workspaceId = null) {
    return request(`/purchase-orders/${id}`, { token, workspaceId });
  },
  createPurchaseOrder(token, payload, workspaceId = null) {
    return request("/purchase-orders", {
      method: "POST",
      token,
      workspaceId,
      body: payload
    });
  },
  updatePurchaseOrder(token, id, payload, workspaceId = null) {
    return request(`/purchase-orders/${id}`, {
      method: "PATCH",
      token,
      workspaceId,
      body: payload
    });
  },
  sendPurchaseOrder(token, id, workspaceId = null) {
    return request(`/purchase-orders/${id}/send`, {
      method: "PATCH",
      token,
      workspaceId
    });
  },
  receivePurchaseOrder(token, id, payload, workspaceId = null) {
    return request(`/purchase-orders/${id}/receive`, {
      method: "PATCH",
      token,
      workspaceId,
      body: payload
    });
  },
  cancelPurchaseOrder(token, id, workspaceId = null) {
    return request(`/purchase-orders/${id}/cancel`, {
      method: "PATCH",
      token,
      workspaceId
    });
  },
  getBankAccounts(token, workspaceId = null) {
    return request("/finance/bank-accounts", { token, workspaceId });
  },
  createPlaidLinkToken(token, workspaceId = null) {
    return request("/finance/bank-accounts/plaid/create-link-token", {
      method: "POST",
      token,
      workspaceId
    });
  },
  exchangePlaidToken(token, data, workspaceId = null) {
    return request("/finance/bank-accounts/plaid/exchange-token", {
      method: "POST",
      token,
      workspaceId,
      body: data
    });
  },
  createBankAccount(token, payload, workspaceId = null) {
    return request("/finance/bank-accounts", {
      method: "POST",
      token,
      workspaceId,
      body: payload
    });
  },
  updateBankAccount(token, accountId, payload, workspaceId = null) {
    return request(`/finance/bank-accounts/${accountId}`, {
      method: "PATCH",
      token,
      workspaceId,
      body: payload
    });
  },
  deleteBankAccount(token, accountId, workspaceId = null) {
    return request(`/finance/bank-accounts/${accountId}`, {
      method: "DELETE",
      token,
      workspaceId
    });
  },
  getBankTransactions(token, accountId, options = {}, workspaceId = null) {
    const params = new URLSearchParams();
    if (options.startDate) {
      params.set("startDate", options.startDate);
    }
    if (options.endDate) {
      params.set("endDate", options.endDate);
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request(`/finance/bank-accounts/${accountId}/transactions${suffix}`, {
      token,
      workspaceId
    });
  },
  createBankTransaction(token, accountId, payload, workspaceId = null) {
    return request(`/finance/bank-accounts/${accountId}/transactions`, {
      method: "POST",
      token,
      workspaceId,
      body: payload
    });
  },
  syncBankTransactions(token, accountId, transactions, workspaceId = null) {
    return request(`/finance/bank-accounts/${accountId}/sync`, {
      method: "POST",
      token,
      workspaceId,
      body: { transactions }
    });
  },
  syncPlaidAccount(token, accountId, workspaceId = null) {
    return request(`/finance/bank-accounts/${accountId}/plaid/sync`, {
      method: "POST",
      token,
      workspaceId
    });
  },
  refreshPlaidBalance(token, accountId, workspaceId = null) {
    return request(`/finance/bank-accounts/${accountId}/plaid/refresh-balance`, {
      method: "POST",
      token,
      workspaceId
    });
  },
  autoMatchBankTransactions(token, accountId, workspaceId = null) {
    return request(`/finance/bank-accounts/${accountId}/auto-match`, {
      method: "POST",
      token,
      workspaceId
    });
  },
  reconcileMatchedBankTransactions(token, accountId, workspaceId = null) {
    return request(`/finance/bank-accounts/${accountId}/reconcile-matched`, {
      method: "POST",
      token,
      workspaceId
    });
  },
  matchTransactionExpense(token, transactionId, expenseId, workspaceId = null) {
    return request(`/finance/bank-transactions/${transactionId}/match-expense`, {
      method: "PATCH",
      token,
      workspaceId,
      body: { expenseId }
    });
  },
  matchTransactionPayment(token, transactionId, paymentId, workspaceId = null) {
    return request(`/finance/bank-transactions/${transactionId}/match-payment`, {
      method: "PATCH",
      token,
      workspaceId,
      body: { paymentId }
    });
  },
  reconcileTransaction(token, transactionId, workspaceId = null) {
    return request(`/finance/bank-transactions/${transactionId}/reconcile`, {
      method: "PATCH",
      token,
      workspaceId
    });
  },
  inviteWorkspaceAccountant(token, workspaceId, payload) {
    return request(`/workspaces/${workspaceId}/invite-accountant`, {
      method: "POST",
      token,
      workspaceId,
      body: payload
    });
  },
  uploadAvatar(token, imageData) {
    return request("/users/avatar", {
      method: "POST",
      token,
      body: { imageData }
    });
  }
};
