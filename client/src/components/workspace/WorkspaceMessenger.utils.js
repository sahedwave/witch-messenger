import { createContext, useContext } from "react";

import {
  STATIC_EXCHANGE_RATES,
  convertAmount,
  normalizeCurrencyCode
} from "../../utils/currency.js";
import {
  COMMAND_ITEMS,
  FINANCE_WORKSPACE_ROLES,
  ROLE_BOT_VISIBILITY
} from "./WorkspaceMessenger.constants.js";

export const ThreadListContext = createContext(null);
export const UnreadContext = createContext(null);
export const NotificationContext = createContext(null);

export function useThreadList() {
  return useContext(ThreadListContext);
}

export function useUnread() {
  return useContext(UnreadContext);
}

export function useNotifications() {
  return useContext(NotificationContext);
}

export function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to read the selected file."));
    reader.readAsDataURL(file);
  });
}

export function formatTime(isoString) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(isoString));
}

export function formatDate(isoString) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(isoString));
}

export function formatDateTime(isoString) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(isoString));
}

export function formatTimeAgo(isoString) {
  if (!isoString) {
    return "Just now";
  }

  const timestamp = new Date(isoString).getTime();
  if (Number.isNaN(timestamp)) {
    return "Just now";
  }

  const elapsedMs = Math.max(0, Date.now() - timestamp);
  const minute = 60000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (elapsedMs < minute) {
    return "Just now";
  }

  if (elapsedMs < hour) {
    const minutes = Math.max(1, Math.floor(elapsedMs / minute));
    return `${minutes}m ago`;
  }

  if (elapsedMs < day) {
    const hours = Math.max(1, Math.floor(elapsedMs / hour));
    return `${hours}h ago`;
  }

  const days = Math.max(1, Math.floor(elapsedMs / day));
  return `${days}d ago`;
}

export function todayDateInputValue() {
  return new Date().toISOString().slice(0, 10);
}

export function resolveWorkspaceDefaultCurrency(activeWorkspace = null, workspaceSettings = null) {
  return normalizeCurrencyCode(
    workspaceSettings?.summary?.capabilities?.defaultCurrency ||
      activeWorkspace?.defaultCurrency ||
      "USD"
  );
}

export function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

export function computeTaxPreview(amount, taxRate) {
  const subtotal = Number.parseFloat(amount || 0);
  const safeSubtotal = Number.isFinite(subtotal) ? subtotal : 0;
  const parsedTaxRate = Number.parseFloat(taxRate || 0);
  const safeTaxRate = Number.isFinite(parsedTaxRate) ? Math.max(0, parsedTaxRate) : 0;
  const taxAmount = roundMoney((safeSubtotal * safeTaxRate) / 100);
  const totalWithTax = roundMoney(safeSubtotal + taxAmount);

  return {
    subtotal: roundMoney(safeSubtotal),
    taxRate: roundMoney(safeTaxRate),
    taxAmount,
    totalWithTax
  };
}

export function sumCurrencyBucketInBaseCurrency(bucket = {}, baseCurrency = "USD") {
  const normalizedBase = normalizeCurrencyCode(baseCurrency || "USD");
  return roundMoney(
    Object.entries(bucket || {}).reduce(
      (sum, [currency, amount]) => sum + convertAmount(amount, currency, normalizedBase, STATIC_EXCHANGE_RATES),
      0
    )
  );
}

export function bucketEntries(value = {}) {
  return Object.entries(value || {})
    .filter(([currency, amount]) => currency && Number.isFinite(Number(amount)))
    .sort(([left], [right]) => left.localeCompare(right));
}

export function downloadCsvFile(filename, rowsOrColumns = [], maybeRows = null) {
  if (typeof window === "undefined") {
    return;
  }

  const content = Array.isArray(maybeRows)
    ? [
        rowsOrColumns.map((column) => escapeCsvValue(column.label)).join(","),
        ...maybeRows.map((row) =>
          rowsOrColumns.map((column) => escapeCsvValue(row[column.key])).join(",")
        )
      ].join("\n")
    : rowsOrColumns
        .map((row) =>
          row
            .map((cell) => {
              const text = String(cell ?? "");
              return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
            })
            .join(",")
        )
        .join("\n");

  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.URL.revokeObjectURL(url);
}

export function parseBankCsv(csvText = "") {
  const rows = String(csvText || "")
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);

  if (!rows.length) {
    return [];
  }

  const parseRow = (row) => {
    const values = [];
    let current = "";
    let inQuotes = false;

    for (let index = 0; index < row.length; index += 1) {
      const char = row[index];
      const next = row[index + 1];
      if (char === "\"") {
        if (inQuotes && next === "\"") {
          current += "\"";
          index += 1;
          continue;
        }
        inQuotes = !inQuotes;
        continue;
      }
      if (char === "," && !inQuotes) {
        values.push(current.trim());
        current = "";
        continue;
      }
      current += char;
    }

    values.push(current.trim());
    return values;
  };

  const headers = parseRow(rows[0]).map((header) => String(header || "").trim().toLowerCase());

  return rows.slice(1).map((row) => {
    const values = parseRow(row);
    const entry = Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
    return {
      transactionDate: entry.date || entry.transactiondate || entry.posted || todayDateInputValue(),
      description: entry.description || entry.memo || entry.name || "",
      amount: entry.amount || entry.value || "0",
      currency: entry.currency || "USD",
      category: entry.category || "other",
      providerTransactionId: entry.providertransactionid || entry.id || ""
    };
  });
}

export function loadPlaidLinkScript() {
  if (typeof window === "undefined") {
    return Promise.resolve(null);
  }

  if (window.Plaid) {
    return Promise.resolve(window.Plaid);
  }

  const existing = document.querySelector('script[data-plaid-link="true"]');
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(window.Plaid || null), { once: true });
      existing.addEventListener("error", () => reject(new Error("Unable to load Plaid Link.")), { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    script.async = true;
    script.dataset.plaidLink = "true";
    script.onload = () => resolve(window.Plaid || null);
    script.onerror = () => reject(new Error("Unable to load Plaid Link."));
    document.head.appendChild(script);
  });
}

export function parseFinanceHashRoute() {
  const hash = typeof window !== "undefined" ? String(window.location.hash || "") : "";
  const match = hash.match(/^#\/finance\/(invoices|expenses)\/([^/?#]+)/i);
  if (!match) {
    return null;
  }

  return {
    section: match[1].toLowerCase(),
    recordId: decodeURIComponent(match[2])
  };
}

export function updateFinanceHashRoute(section, recordId) {
  if (typeof window === "undefined") {
    return;
  }

  if (!section || !recordId) {
    if (window.location.hash.startsWith("#/finance/")) {
      window.history.pushState(null, "", `${window.location.pathname}${window.location.search}`);
    }
    return;
  }

  window.history.pushState(null, "", `${window.location.pathname}${window.location.search}#/finance/${section}/${encodeURIComponent(recordId)}`);
}

export function formatPaymentMethod(method = "") {
  if (!method) {
    return "Manual entry";
  }

  return String(method)
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function isWithinReportingWindow(isoString, window = "all") {
  if (!isoString || window === "all") {
    return true;
  }

  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const now = Date.now();
  const ageMs = now - date.getTime();

  if (window === "30d") {
    return ageMs <= 30 * 86400000;
  }

  if (window === "90d") {
    return ageMs <= 90 * 86400000;
  }

  return true;
}

export function formatMoney(amount, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency
  }).format(Number.isFinite(Number(amount)) ? Number(amount) : 0);
}

export function isCurrencyBucket(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function formatMoneyDisplay(value, currency = "USD") {
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

export function getWorkspaceNotificationTone(notifications = [], unreadCount = 0) {
  if (!unreadCount) {
    return "neutral";
  }

  if (notifications.some((notification) => notification?.type === "task_overdue")) {
    return "danger";
  }

  if (notifications.some((notification) => notification?.type === "task_due_soon")) {
    return "warning";
  }

  return "info";
}

export function workspaceNotificationIcon(type = "") {
  switch (type) {
    case "task_overdue":
      return "⚠";
    case "task_due_soon":
      return "◔";
    case "project_assigned":
      return "▣";
    case "task_assigned":
    default:
      return "☑";
  }
}

export function buildNotificationToneStyles(tone = "neutral", financeMode = false) {
  if (tone === "danger") {
    return financeMode
      ? { background: "rgba(239,68,68,0.18)", color: "#fca5a5", borderColor: "rgba(239,68,68,0.28)" }
      : { background: "#fee2e2", color: "#b91c1c", borderColor: "#fecaca" };
  }

  if (tone === "warning") {
    return financeMode
      ? { background: "rgba(245,158,11,0.18)", color: "#fbbf24", borderColor: "rgba(245,158,11,0.28)" }
      : { background: "#fef3c7", color: "#b45309", borderColor: "#fde68a" };
  }

  if (tone === "info") {
    return financeMode
      ? { background: "rgba(59,130,246,0.18)", color: "#93c5fd", borderColor: "rgba(59,130,246,0.28)" }
      : { background: "#dbeafe", color: "#1d4ed8", borderColor: "#bfdbfe" };
  }

  return financeMode
    ? { background: "rgba(255,255,255,0.08)", color: "#cbd5e1", borderColor: "rgba(255,255,255,0.08)" }
    : { background: "#f8fafc", color: "#475569", borderColor: "#e2e8f0" };
}

export function resolveFinanceAccountingState(summary = null, workspace = null, settings = null) {
  const capabilities = settings?.summary?.capabilities || null;
  return {
    enabled: Boolean(
      summary?.accountingEnabled ??
        capabilities?.accountingEnabled ??
        workspace?.accountingEnabled
    ),
    enabledAt:
      summary?.accountingEnabledAt ||
      capabilities?.accountingEnabledAt ||
      workspace?.accountingEnabledAt ||
      null
  };
}

export function formatAccountingPeriodLabel(period = "all") {
  if (period === "30d") {
    return "Last 30 days";
  }

  if (period === "90d") {
    return "Last 90 days";
  }

  return "All time";
}

export function formatAccountingReportVariantLabel(variant = "pack") {
  if (variant === "profit_and_loss") {
    return "P&L";
  }

  if (variant === "balance_snapshot") {
    return "Balance";
  }

  return "Statement pack";
}

export function formatPeriodKeyLabel(periodKey = "") {
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

export function financeGuardrailMessage(error, fallback = "Please try again.") {
  const details = error?.details || null;
  const lockedPeriodLabel = details?.periodLock?.periodLabel || details?.lockedPeriodLabel || details?.lockedPeriodKey || "";
  const attemptedAction = String(details?.attemptedAction || "").replace(/_/g, " ");

  if (lockedPeriodLabel) {
    return `${lockedPeriodLabel} is locked${attemptedAction ? `, so ${attemptedAction}` : ""} is blocked.`;
  }

  return error?.message || fallback;
}

export function formatAccountingEntryStatusLabel(status = "unposted") {
  if (status === "posted") {
    return "Posted";
  }

  if (status === "voided") {
    return "Voided";
  }

  if (status === "blocked") {
    return "Blocked";
  }

  if (status === "pending") {
    return "Pending";
  }

  return "Unposted";
}

export function formatFinanceControlStatusLabel(status = "clear") {
  if (status === "blocked") {
    return "Blocked";
  }

  if (status === "pending") {
    return "Pending review";
  }

  if (status === "voided") {
    return "Voided";
  }

  return "Clear";
}

export function financeStatusBadgeStyle(tone = "neutral") {
  if (tone === "good") {
    return {
      border: "1px solid rgba(16,185,129,0.22)",
      background: "rgba(16,185,129,0.12)",
      color: "#86efac"
    };
  }

  if (tone === "danger") {
    return {
      border: "1px solid rgba(239,68,68,0.22)",
      background: "rgba(239,68,68,0.12)",
      color: "#fda4af"
    };
  }

  if (tone === "warning") {
    return {
      border: "1px solid rgba(245,158,11,0.22)",
      background: "rgba(245,158,11,0.12)",
      color: "#fcd34d"
    };
  }

  return {
    border: "1px solid rgba(148,163,184,0.22)",
    background: "rgba(148,163,184,0.10)",
    color: "#cbd5e1"
  };
}

export function financeStatusToneFromState(status = "unposted") {
  if (status === "posted" || status === "clear") {
    return "good";
  }

  if (status === "blocked") {
    return "danger";
  }

  if (status === "voided") {
    return "warning";
  }

  return "neutral";
}

export function financeCloseReadinessTone(status = "attention") {
  if (status === "ready") {
    return "good";
  }

  if (status === "blocked") {
    return "danger";
  }

  return "warning";
}

export function formatFinanceCloseReadinessLabel(status = "attention") {
  if (status === "ready") {
    return "Ready to lock";
  }

  if (status === "blocked") {
    return "Blocked items";
  }

  return "Needs review";
}

export function sanitizeDownloadPart(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "workspace";
}

export function downloadJsonFile(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function escapeCsvValue(value) {
  const normalized = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

export function relativeTime(isoString) {
  const value = new Date(isoString).getTime();
  const diffMinutes = Math.max(Math.round((Date.now() - value) / 60000), 0);

  if (diffMinutes < 1) {
    return "just now";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h`;
  }

  return formatDate(isoString);
}

export function moveThreadToTop(list, threadId) {
  const thread = list.find((entry) => entry.id === threadId);
  if (!thread) {
    return list;
  }

  return [thread, ...list.filter((entry) => entry.id !== threadId)];
}

export function sortThreads(list) {
  return [...list].sort((first, second) => {
    const firstTime = new Date(first.updatedAt).getTime();
    const secondTime = new Date(second.updatedAt).getTime();
    return secondTime - firstTime;
  });
}

export function canSeeBot(botType, role) {
  return (ROLE_BOT_VISIBILITY[role] || []).includes(botType);
}

export function canAccessWorkspaceScope(scope, requestedScope) {
  if (requestedScope === "both") {
    return true;
  }

  return scope === requestedScope;
}

export function normalizeWorkspaceRoles(userLike, fallbackRole = "manager") {
  const explicitRoles = Array.isArray(userLike?.workspaceRoles)
    ? userLike.workspaceRoles.filter((role) => FINANCE_WORKSPACE_ROLES.includes(role))
    : [];

  if (explicitRoles.length) {
    return [...new Set(explicitRoles)];
  }

  const legacyRole = userLike?.workspaceRole || userLike?.role || fallbackRole;
  if (legacyRole === "finance" || legacyRole === "finance_staff") {
    return ["finance_staff"];
  }

  if (legacyRole === "owner" || legacyRole === "manager") {
    return ["approver", "finance_staff"];
  }

  if (legacyRole === "viewer" || legacyRole === "staff") {
    return ["viewer"];
  }

  return [];
}

export function buildFinancePermissions(workspaceRoles = [], workspaceScope = "both") {
  const hasFinanceScope = canAccessWorkspaceScope("finance", workspaceScope);
  const normalizedRoles = [...new Set(workspaceRoles)].filter((role) => FINANCE_WORKSPACE_ROLES.includes(role));
  const canView = hasFinanceScope && normalizedRoles.length > 0;
  const canApprove = canView && normalizedRoles.includes("approver");
  const canOperate = canView && normalizedRoles.includes("finance_staff");
  const isAccountant = canView && normalizedRoles.includes("accountant");

  return {
    roles: normalizedRoles,
    canView,
    canApprove,
    canCreate: canOperate,
    canEdit: canOperate,
    canMarkPaid: canOperate,
    canReconcile: canOperate,
    isAccountant
  };
}

export function canSeeNavItem(itemId, workspaceScope) {
  if (itemId === "finances") {
    return canAccessWorkspaceScope("finance", workspaceScope);
  }

  if (itemId === "warehouse") {
    return canAccessWorkspaceScope("warehouse", workspaceScope);
  }

  return true;
}

export function canSeeThread(thread, role, workspaceScope = "both", workspaceMode = "demo") {
  if (workspaceMode === "real" && !thread.isBot) {
    return Boolean(thread.isWorkspaceConversation);
  }

  if (!thread.isBot) {
    return true;
  }

  return canSeeBot(thread.botType, role) && canAccessWorkspaceScope(thread.botType, workspaceScope);
}

export function visibleCommandItems(role, draft, workspaceScope = "both", financePermissions = null) {
  const query = draft.trim().toLowerCase().split(/\s+/)[0];
  return COMMAND_ITEMS.filter((item) => {
    if (!item.roles.includes(role)) {
      return false;
    }
    if (!canAccessWorkspaceScope(item.scope, workspaceScope)) {
      return false;
    }
    if (!query || query === "/") {
      if (item.scope !== "finance" || !financePermissions) {
        return true;
      }

      if (item.command.startsWith("/report")) {
        return financePermissions.canView;
      }

      return financePermissions.canCreate;
    }

    if (!item.command.split(" ")[0].toLowerCase().startsWith(query)) {
      return false;
    }

    if (item.scope !== "finance" || !financePermissions) {
      return true;
    }

    if (item.command.startsWith("/report")) {
      return financePermissions.canView;
    }

    return financePermissions.canCreate;
  });
}

export function isCoarsePointer() {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}

export function messagePreview(message) {
  if (!message) {
    return "No messages yet";
  }

  if (message.type === "invoice") {
    const status = String(message.metadata.recordStatus || message.metadata.status || "pending").replaceAll("_", " ");
    return `Invoice #${message.metadata.invoiceNumber} is ${status}`;
  }
  if (message.type === "stock_alert") {
    return `${message.metadata.productName} is below stock minimum`;
  }
  if (message.type === "shipment") {
    return `Shipment ${message.metadata.orderNumber} is ${message.metadata.statusLabel}`;
  }
  if (message.type === "expense") {
    return `Expense logged: ${formatMoney(message.metadata.amount, message.metadata.currency)}`;
  }
  if (message.type === "report") {
    return "Business report generated";
  }

  return message.content;
}

export function avatarForThread(thread) {
  if (thread.id === "financebot") {
    return { label: "💰", bg: "bg-slate-900", fg: "text-amber-300" };
  }
  if (thread.id === "warebot") {
    return { label: "📦", bg: "bg-slate-900", fg: "text-orange-300" };
  }

  return {
    label: thread.name.charAt(0).toUpperCase(),
    bg: "bg-[#2D8EFF]",
    fg: "text-white"
  };
}

export function metricTone(id) {
  if (id.includes("paid") || id.includes("revenue")) return "from-emerald-50 to-emerald-100 text-emerald-700";
  if (id.includes("pending") || id.includes("outstanding")) return "from-orange-50 to-orange-100 text-orange-700";
  if (id.includes("overdue") || id.includes("low-stock")) return "from-rose-50 to-rose-100 text-rose-700";
  if (id.includes("due-today") || id.includes("reconcile")) return "from-amber-50 to-amber-100 text-amber-700";
  if (id.includes("unassigned") || id.includes("attention")) return "from-slate-100 to-slate-200 text-slate-700";
  return "from-blue-50 to-blue-100 text-blue-700";
}

export function metricDescription(metric) {
  switch (metric.id) {
    case "ops-attention":
      return "Combined finance, warehouse, and execution items that need coordination inside this workspace.";
    case "execution-overdue":
      return "Workspace tasks that are already past due and need follow-up.";
    case "execution-projects":
      return "Active projects that are drifting close to due dates or showing low completion progress.";
    case "finance-outstanding":
      return "Invoices still carrying an unpaid balance across this workspace.";
    case "finance-paid":
      return "Invoices that have been fully settled and recorded as paid.";
    case "finance-overdue":
      return "Invoices whose due date has passed without payment.";
    case "finance-expenses":
      return "Expense volume logged in this workspace, with recurring invoice context.";
    case "finance-gross-profit":
      return "Approximate gross profit for the current reporting period using the workspace base currency.";
    case "finance-cash-flow":
      return "Approximate net cash flow for the current reporting period using the workspace base currency.";
    case "finance-cash-position":
      return "Cash across connected manual bank accounts, grouped by currency and normalized for overview.";
    case "warehouse-skus":
      return "Tracked products currently in the warehouse catalog.";
    case "warehouse-low-stock":
      return "Products currently below their minimum stock threshold.";
    case "warehouse-inventory-value":
      return "Estimated inventory value across tracked warehouse products.";
    case "warehouse-in-transit":
      return "Orders that have left the warehouse but are not delivered yet.";
    case "warehouse-delivered":
      return "Orders marked delivered today.";
    default:
      return "Live business metric generated from the current thread data.";
  }
}

export function isFinanceMode(activeThread, activeNav) {
  if (activeNav === "home" || activeNav === "users") {
    return false;
  }
  return activeThread?.id === "financebot" || activeNav === "finances";
}

export function isWorkspaceBotMode(activeThread, activeNav) {
  return (
    activeThread?.id === "financebot" ||
    activeThread?.id === "warebot" ||
    activeNav === "finances" ||
    activeNav === "warehouse"
  );
}

export function roleBadgeStyle(role) {
  if (role === "warehouse") {
    return {
      bg: "rgba(245,158,11,0.16)",
      border: "1px solid rgba(245,158,11,0.26)",
      color: "#f59e0b"
    };
  }

  if (role === "finance") {
    return {
      bg: "rgba(59,130,246,0.16)",
      border: "1px solid rgba(59,130,246,0.26)",
      color: "#60a5fa"
    };
  }

  return {
    bg: "rgba(16,185,129,0.16)",
    border: "1px solid rgba(16,185,129,0.26)",
    color: "#10b981"
  };
}

export function financeMetricMeta(metric) {
  switch (metric.id) {
    case "finance-paid":
      return {
        icon: "💰",
        label: "PAID",
        accent: "#10b981",
        subColor: "#10b981"
      };
    case "finance-outstanding":
      return {
        icon: "📄",
        label: "OUTSTANDING",
        accent: "#f59e0b",
        subColor: "#f59e0b"
      };
    case "finance-overdue":
      return {
        icon: "●",
        label: "OVERDUE",
        accent: "#ef4444",
        subColor: "#ef4444"
      };
    case "finance-expenses":
      return {
        icon: "📊",
        label: "EXPENSES",
        accent: "#60a5fa",
        subColor: "#94a3b8"
      };
    case "finance-gross-profit":
      return {
        icon: "↗",
        label: "GROSS PROFIT",
        accent: "#34d399",
        subColor: "#34d399"
      };
    case "finance-cash-flow":
      return {
        icon: "≈",
        label: "CASH FLOW",
        accent: "#f59e0b",
        subColor: "#f59e0b"
      };
    case "finance-cash-position":
      return {
        icon: "🏦",
        label: "CASH",
        accent: "#38bdf8",
        subColor: "#38bdf8"
      };
    case "warehouse-inventory-value":
      return {
        icon: "▣",
        label: "INVENTORY VALUE",
        accent: "#a78bfa",
        subColor: "#a78bfa"
      };
    default:
      return {
        icon: "•",
        label: metric.label.toUpperCase(),
        accent: "#10b981",
        subColor: "#94a3b8"
      };
  }
}

export function displayTabLabel(tab, financeMode) {
  if (!financeMode) {
    return tab;
  }

  if (tab === "Media") return "Analytics";
  if (tab === "Links") return "Approvals";
  return tab;
}

export function financeThreadDescriptor(thread) {
  if (thread?.id === "financebot") {
    return { label: "Finance Cockpit", accent: "#10b981", ring: "rgba(16,185,129,0.28)", bg: "rgba(16,185,129,0.12)" };
  }
  if (thread?.id === "warebot") {
    return { label: "Warehouse Ops", accent: "#f59e0b", ring: "rgba(245,158,11,0.28)", bg: "rgba(245,158,11,0.1)" };
  }
  return { label: thread?.online ? "Live conversation" : "Team thread", accent: "#64748b", ring: "rgba(148,163,184,0.14)", bg: "rgba(148,163,184,0.14)" };
}
