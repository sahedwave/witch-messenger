import { AnimatePresence, motion } from "framer-motion";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../api";
import { normalizeCurrencyCode } from "../utils/currency.js";
import {
  FILTER_TABS,
  FINANCE_CURRENCY_OPTIONS,
  FINANCE_MEDIA_SECTIONS,
  SHIPMENT_STEPS,
  WAREHOUSE_SHIPMENT_STATUS_OPTIONS
} from "./workspace/WorkspaceMessenger.constants.js";
import {
  NotificationContext,
  ThreadListContext,
  UnreadContext,
  avatarForThread,
  bucketEntries,
  buildFinancePermissions,
  buildNotificationToneStyles,
  canAccessWorkspaceScope,
  canSeeBot,
  canSeeThread,
  computeTaxPreview,
  displayTabLabel,
  downloadCsvFile,
  financeCloseReadinessTone,
  financeGuardrailMessage,
  financeMetricMeta,
  financeStatusBadgeStyle,
  financeStatusToneFromState,
  financeThreadDescriptor,
  formatAccountingEntryStatusLabel,
  formatAccountingPeriodLabel,
  formatAccountingReportVariantLabel,
  formatDate,
  formatDateTime,
  formatFinanceCloseReadinessLabel,
  formatFinanceControlStatusLabel,
  formatMoney,
  formatMoneyDisplay,
  formatPaymentMethod,
  formatPeriodKeyLabel,
  formatTime,
  formatTimeAgo,
  getWorkspaceNotificationTone,
  isCoarsePointer,
  isFinanceMode,
  isWithinReportingWindow,
  isWorkspaceBotMode,
  loadPlaidLinkScript,
  messagePreview,
  metricTone,
  metricDescription,
  moveThreadToTop,
  normalizeWorkspaceRoles,
  parseBankCsv,
  parseFinanceHashRoute,
  readFileAsDataUrl,
  relativeTime,
  resolveFinanceAccountingState,
  resolveWorkspaceDefaultCurrency,
  roleBadgeStyle,
  roundMoney,
  sanitizeDownloadPart,
  sortThreads,
  sumCurrencyBucketInBaseCurrency,
  todayDateInputValue,
  uid,
  updateFinanceHashRoute,
  useNotifications,
  useThreadList,
  useUnread,
  visibleCommandItems,
  workspaceNotificationIcon
} from "./workspace/WorkspaceMessenger.utils.js";
import {
  applyRealFinanceRecords,
  buildFinanceMessagesFromRecords,
  buildFinancePayloadFromState,
  formatFinanceExpenseStatusLabel,
  isFinanceRecurringDue,
  mapFinanceExpenseRecord,
  mapFinanceInvoiceRecord,
  normalizeFinanceExpenseStatus,
  normalizeFinanceInvoiceStatus
} from "./workspace/finance/finance-record-mappers.js";
import {
  applyRealWarehouseRecords,
  formatPurchaseOrderStatusLabel,
  formatWarehouseQuantity,
  formatWarehouseQuantityDelta,
  getWarehouseReorderThreshold,
  isWarehouseLowStock,
  mapPurchaseOrderRecord,
  mapWarehouseAlertRecord,
  mapWarehouseOrderRecord,
  mapWarehouseProductRecord,
  normalizeWarehouseAlertStatus,
  normalizeWarehouseOrderStatus,
  serializeWarehouseOrderStateEntry,
  serializeWarehouseProductStateEntry,
  shipmentStepIsActive,
  warehouseMovementTypeLabel,
  warehouseProductStatusLabel,
  warehouseShipmentTypeLabel,
  warehouseStatusLabel,
  warehouseStockSignalLabel
} from "./workspace/warehouse/warehouse-record-mappers.js";
import Sidebar from "./workspace/layout/Sidebar.jsx";
import ThreadListPanel from "./workspace/layout/ThreadListPanel.jsx";
import WorkspaceNotificationMenu from "./workspace/menus/WorkspaceNotificationMenu.jsx";
import QuickActionMenu from "./workspace/menus/QuickActionMenu.jsx";
import ToolbarOverflowMenu from "./workspace/menus/ToolbarOverflowMenu.jsx";
import FinanceEntryModal from "./workspace/finance/FinanceEntryModal.jsx";
import InvoicePaymentModal from "./workspace/finance/InvoicePaymentModal.jsx";
import {
  FinanceActionLogList,
  FinanceActivityFeed,
  FinanceBalanceSheetPanel,
  FinanceCurrencyBreakdown,
  FinanceFilterToolbar,
  FinanceHeroStrip,
  FinanceOperationalInsights,
  FinanceQueueSummary,
  FinanceRecordDigest,
  FinanceRelationshipSummary,
  FinanceReportingSnapshot,
  buildFinanceApprovalSections,
  buildFinanceQueueSummary
} from "./workspace/finance/FinanceSummaryPanels.jsx";
import {
  FinanceExpenseDetailPanel,
  FinanceInvoiceDetailPanel
} from "./workspace/finance/FinanceDetailPanels.jsx";
import FinanceAdvancedReportsPanel from "./workspace/finance/FinanceAdvancedReportsPanel.jsx";
import FinanceContactManagerPanel from "./workspace/finance/FinanceContactManagerPanel.jsx";
import FinanceBankingPanel from "./workspace/finance/FinanceBankingPanel.jsx";
import WarehouseAnalyticsPanel from "./workspace/warehouse/WarehousePanels.jsx";
import { ExpenseMessageCard, InvoiceMessageCard, LinkedWorkMessageCard, ReportMessageCard } from "./workspace/messages/FinanceMessageCards.jsx";
import { MessageBubble, NotificationToasts, useMessageInteractionState } from "./workspace/messages/MessageInteraction.jsx";
import FinancePayrollPanel from "./workspace/finance/FinancePayrollPanel.jsx";
import FinanceAccountantPortalPanel from "./workspace/finance/FinanceAccountantPortalPanel.jsx";
import {
  PlatformOwnerProvisioningPanel,
  WorkspaceAdminOverviewPanel,
  WorkspaceMemberAccessPanel
} from "./workspace/admin/WorkspaceAdminPanels.jsx";
import WorkspaceOverviewPanel from "./workspace/overview/WorkspaceOverviewPanel.jsx";
import WorkspacePane from "./workspace/layout/WorkspacePane.jsx";
import useWorkspaceFinanceData from "./workspace/hooks/useWorkspaceFinanceData.js";
import useWorkspaceBankingAndPayroll from "./workspace/hooks/useWorkspaceBankingAndPayroll.js";
import useWorkspaceNavigationAndThreads, { useWorkspaceNavigationActions } from "./workspace/hooks/useWorkspaceNavigationAndThreads.js";
import { useWorkspaceAdminAndPlatformActions, useWorkspaceAdminAndPlatformLoaders } from "./workspace/hooks/useWorkspaceAdminAndPlatform.js";

const FinanceAccountingAnalytics = lazy(() => import("./finance/FinanceAccountingAnalytics.jsx"));
const WORKSPACE_TASK_EVENT_KEY = "messenger-mvp-workspace-task-event";

function buildMockWorkspaceState(userRole, currentUserOverride = null) {
  const now = Date.now();
  const financeMessages = [
    {
      id: uid("msg"),
      senderId: "financebot",
      senderName: "FinanceBot",
      createdAt: new Date(now - 1000 * 60 * 90).toISOString(),
      type: "invoice",
      content: "Invoice #INV-301 is waiting for approval.",
      metadata: {
        invoiceId: "invoice-301",
        invoiceNumber: "INV-301",
        companyName: "Northwind Labs",
        amount: 12400,
        currency: "USD",
        dueDate: "2026-03-12",
        status: "pending"
      }
    },
    {
      id: uid("msg"),
      senderId: "financebot",
      senderName: "FinanceBot",
      createdAt: new Date(now - 1000 * 60 * 40).toISOString(),
      type: "invoice",
      content: "Invoice #INV-302 is nearly overdue.",
      metadata: {
        invoiceId: "invoice-302",
        invoiceNumber: "INV-302",
        companyName: "Bluehaven Retail",
        amount: 8800,
        currency: "USD",
        dueDate: "2026-03-11",
        status: "pending"
      }
    },
    {
      id: uid("msg"),
      senderId: "financebot",
      senderName: "FinanceBot",
      createdAt: new Date(now - 1000 * 60 * 22).toISOString(),
      type: "invoice",
      content: "Invoice #INV-303 is already overdue.",
      metadata: {
        invoiceId: "invoice-303",
        invoiceNumber: "INV-303",
        companyName: "Elm Street Supply",
        amount: 16350,
        currency: "USD",
        dueDate: "2026-03-08",
        status: "overdue"
      }
    }
  ];

  const warehouseMessages = [
    {
      id: uid("msg"),
      senderId: "warebot",
      senderName: "WareBot",
      createdAt: new Date(now - 1000 * 60 * 65).toISOString(),
      type: "stock_alert",
      content: "Stock for Cardboard Boxes is running low.",
      metadata: {
        alertId: "alert-1",
        productId: "product-1",
        productName: "Cardboard Boxes",
        sku: "BX-001",
        currentStock: 12,
        minimumStock: 40,
        status: "active",
        reorderQuantity: 120
      }
    },
    {
      id: uid("msg"),
      senderId: "warebot",
      senderName: "WareBot",
      createdAt: new Date(now - 1000 * 60 * 32).toISOString(),
      type: "stock_alert",
      content: "Thermal Labels dropped below minimum stock.",
      metadata: {
        alertId: "alert-2",
        productId: "product-2",
        productName: "Thermal Labels",
        sku: "LB-204",
        currentStock: 18,
        minimumStock: 60,
        status: "active",
        reorderQuantity: 200
      }
    },
    {
      id: uid("msg"),
      senderId: "warebot",
      senderName: "WareBot",
      createdAt: new Date(now - 1000 * 60 * 12).toISOString(),
      type: "shipment",
      content: "Shipment ORD-9001 is in transit.",
      metadata: {
        orderId: "order-1",
        orderNumber: "ORD-9001",
        destination: "Dhaka Central Depot",
        steps: SHIPMENT_STEPS,
        currentStep: 2,
        statusLabel: "In Transit",
        estimatedDelivery: "2026-03-12"
      }
    }
  ];

  const directMessages = [
    {
      id: uid("msg"),
      senderId: "user-2",
      senderName: "Sarah Khan",
      createdAt: new Date(now - 1000 * 60 * 18).toISOString(),
      type: "text",
      content: "Can you review the finance summary before lunch?"
    },
    {
      id: uid("msg"),
      senderId: "me",
      senderName: "You",
      createdAt: new Date(now - 1000 * 60 * 14).toISOString(),
      type: "text",
      content: "Yes. I’ll check pending invoices and reply with notes."
    }
  ];

  const opsMessages = [
    {
      id: uid("msg"),
      senderId: "user-3",
      senderName: "Nayeem Ops",
      createdAt: new Date(now - 1000 * 60 * 55).toISOString(),
      type: "text",
      content: "Warehouse asked for an urgent reorder on packing sleeves."
    }
  ];

  return {
    currentUser: currentUserOverride
      ? {
          id: currentUserOverride.id || "me",
          name: currentUserOverride.name || "Workspace User",
          email: currentUserOverride.email || "workspace@witch.ai",
          role: currentUserOverride.role || userRole
        }
      : {
          id: "me",
          name: "Workspace Operator",
          email: "workspace@local.test",
          role: userRole
        },
    settings: {
      soundEnabled: true
    },
    invoices: [
      { id: "invoice-301", invoiceNumber: "INV-301", companyName: "Northwind Labs", amount: 12400, currency: "USD", dueDate: "2026-03-12", status: "pending" },
      { id: "invoice-302", invoiceNumber: "INV-302", companyName: "Bluehaven Retail", amount: 8800, currency: "USD", dueDate: "2026-03-11", status: "pending" },
      { id: "invoice-303", invoiceNumber: "INV-303", companyName: "Elm Street Supply", amount: 16350, currency: "USD", dueDate: "2026-03-08", status: "overdue" }
    ],
    expenses: [
      { id: "exp-1", amount: 450, currency: "USD", category: "supplies", note: "Packaging tape", createdAt: "2026-03-09" },
      { id: "exp-2", amount: 1280, currency: "USD", category: "travel", note: "Supplier visit", createdAt: "2026-03-07" },
      { id: "exp-3", amount: 920, currency: "USD", category: "marketing", note: "Trade fair collateral", createdAt: "2026-03-03" },
      { id: "exp-4", amount: 2400, currency: "USD", category: "utilities", note: "Warehouse electricity", createdAt: "2026-02-28" }
    ],
    budget: {
      department: "Operations",
      totalAmount: 50000,
      spentAmount: 41200,
      period: "monthly"
    },
    products: [
      { id: "product-1", name: "Cardboard Boxes", sku: "BX-001", currentStock: 12, minimumStock: 40, reorderThreshold: 40, reorderQuantity: 120 },
      { id: "product-2", name: "Thermal Labels", sku: "LB-204", currentStock: 18, minimumStock: 60, reorderThreshold: 60, reorderQuantity: 200 },
      { id: "product-3", name: "Packing Sleeves", sku: "PS-312", currentStock: 84, minimumStock: 40, reorderThreshold: 40, reorderQuantity: 80 }
    ],
    orders: [
      { id: "order-1", orderNumber: "ORD-9001", destination: "Dhaka Central Depot", status: "in_transit", currentStep: 2, estimatedDelivery: "2026-03-12" }
    ],
    threads: sortThreads([
      {
        id: "financebot",
        isBot: true,
        botType: "finance",
        online: true,
        name: "FinanceBot",
        preview: messagePreview(financeMessages[financeMessages.length - 1]),
        unread: 2,
        updatedAt: financeMessages[financeMessages.length - 1].createdAt,
        messages: financeMessages,
        archived: false,
        drafts: false
      },
      {
        id: "warebot",
        isBot: true,
        botType: "warehouse",
        online: true,
        name: "WareBot",
        preview: messagePreview(warehouseMessages[warehouseMessages.length - 1]),
        unread: 1,
        updatedAt: warehouseMessages[warehouseMessages.length - 1].createdAt,
        messages: warehouseMessages,
        archived: false,
        drafts: false
      },
      {
        id: "sarah",
        isBot: false,
        online: true,
        name: "Sarah Khan",
        preview: messagePreview(directMessages[directMessages.length - 1]),
        unread: 0,
        updatedAt: directMessages[directMessages.length - 1].createdAt,
        messages: directMessages,
        archived: false,
        drafts: false
      },
      {
        id: "ops",
        isBot: false,
        online: false,
        name: "Nayeem Ops",
        preview: messagePreview(opsMessages[opsMessages.length - 1]),
        unread: 1,
        updatedAt: opsMessages[opsMessages.length - 1].createdAt,
        messages: opsMessages,
        archived: true,
        drafts: false
      }
    ])
  };
}

function mapWorkspaceConversationThread(conversation) {
  const messages = Array.isArray(conversation.messages)
    ? conversation.messages.map((message) => ({
        id: message.id || uid("workspace-msg"),
        senderId: message.senderId || "workspace",
        senderName: message.senderName || "Workspace member",
        createdAt: message.createdAt,
        type: message.type || "text",
        content: message.content || "",
        metadata: message.metadata || null
      }))
    : [];
  const lastMessage = messages[messages.length - 1] || null;
  const botType = conversation.botType || null;
  const normalizedThreadId = conversation.kind === "bot"
    ? (botType === "finance"
        ? "financebot"
        : botType === "warehouse"
          ? "warebot"
          : conversation.id)
    : conversation.id;
  const defaultPreview = botType === "finance"
    ? "No finance records yet"
    : botType === "warehouse"
      ? "No warehouse records yet"
      : "Workspace thread ready";

  return {
    id: normalizedThreadId,
    conversationId: conversation.conversationId || null,
    conversationContext: conversation.conversationContext || "workspace",
    isWorkspaceConversation: true,
    isBot: Boolean(conversation.isBot),
    botType,
    online: true,
    name: conversation.title || (botType === "finance" ? "FinanceBot" : botType === "warehouse" ? "WareBot" : "Workspace"),
    linkedUserId: conversation.counterpartUser?.id || null,
    linkedUserName: conversation.counterpartUser?.name || conversation.title || "",
    linkedUserEmail: conversation.counterpartUser?.email || "",
    participantUserIds: Array.isArray(conversation.participantUserIds) ? conversation.participantUserIds : [],
    preview: lastMessage ? messagePreview(lastMessage) : conversation.preview || defaultPreview,
    unread: 0,
    updatedAt: conversation.updatedAt || lastMessage?.createdAt || new Date().toISOString(),
    messages,
    archived: Boolean(conversation.archived),
    drafts: false
  };
}

function buildLinkedWorkTitle(message, fallback = "Follow up") {
  const base = String(message?.content || "").trim().replace(/\s+/g, " ");
  if (!base) {
    return fallback;
  }

  return base.length > 72 ? `${base.slice(0, 69).trimEnd()}...` : base;
}

function buildLinkedWorkExcerpt(message) {
  return String(message?.content || "").trim().replace(/\s+/g, " ").slice(0, 400);
}

function buildTaskPayloadFromMessage(message, thread) {
  const excerpt = buildLinkedWorkExcerpt(message);
  const threadName = thread?.linkedUserName || thread?.name || "Workspace thread";

  return {
    title: buildLinkedWorkTitle(message, `Follow up with ${threadName}`),
    note: excerpt ? `Created from ${threadName}\n\n${excerpt}` : `Created from ${threadName}`,
    status: "todo",
    priority: "Medium",
    mode: "professional",
    sourceConversationId: thread?.conversationId || null,
    sourceThreadId: thread?.id || "",
    sourceMessageId: message?.id || "",
    sourceThreadName: threadName,
    sourceMessageExcerpt: excerpt
  };
}

function buildProjectPayloadFromMessage(message, thread) {
  const excerpt = buildLinkedWorkExcerpt(message);
  const threadName = thread?.linkedUserName || thread?.name || "Workspace thread";

  return {
    name: buildLinkedWorkTitle(message, `${threadName} workstream`),
    client: thread?.linkedUserName || thread?.name || "Internal",
    type: "Conversation",
    status: "planning",
    summary: excerpt ? `Created from ${threadName}\n\n${excerpt}` : `Created from ${threadName}`,
    sourceConversationId: thread?.conversationId || null,
    sourceThreadId: thread?.id || "",
    sourceMessageId: message?.id || "",
    sourceThreadName: threadName,
    sourceMessageExcerpt: excerpt
  };
}

function buildConversationSourcePayloadFromMessage(message, thread) {
  const excerpt = buildLinkedWorkExcerpt(message);
  const threadName = thread?.linkedUserName || thread?.name || "Workspace thread";

  return {
    sourceConversationId: thread?.conversationId || null,
    sourceThreadId: thread?.id || "",
    sourceMessageId: message?.id || "",
    sourceThreadName: threadName,
    sourceMessageExcerpt: excerpt
  };
}

function applyRealWorkspaceConversations(current, conversations) {
  const mappedThreads = conversations.map(mapWorkspaceConversationThread);
  const threadById = new Map(mappedThreads.map((thread) => [thread.id, thread]));

  current.threads.forEach((thread) => {
    if (!threadById.has(thread.id)) {
      return;
    }

    const nextThread = threadById.get(thread.id);
    if (nextThread.isBot) {
      const incomingMessages = Array.isArray(nextThread.messages) ? nextThread.messages : [];
      const existingMessages = Array.isArray(thread.messages) ? thread.messages : [];
      const hasIncomingMessages = incomingMessages.length > 0;
      const hasExistingMessages = existingMessages.length > 0;

      if (!hasIncomingMessages && hasExistingMessages) {
        nextThread.messages = existingMessages;
        nextThread.preview = messagePreview(existingMessages[existingMessages.length - 1]);
        nextThread.updatedAt = existingMessages[existingMessages.length - 1].createdAt || thread.updatedAt || nextThread.updatedAt;
      } else if (!hasIncomingMessages) {
        nextThread.messages = thread.messages || [];
        nextThread.preview = thread.preview || nextThread.preview;
        nextThread.updatedAt = thread.updatedAt || nextThread.updatedAt;
      }
    }
  });

  current.threads.forEach((thread) => {
    if (!thread.isBot || threadById.has(thread.id)) {
      return;
    }

    mappedThreads.push(thread);
  });

  return {
    ...current,
    threads: sortThreads(mappedThreads)
  };
}

function upsertWorkspaceConversationThread(current, conversation) {
  const nextThread = mapWorkspaceConversationThread(conversation);
  const nextThreads = current.threads.some((thread) => thread.id === nextThread.id)
    ? current.threads.map((thread) => (thread.id === nextThread.id ? nextThread : thread))
    : [...current.threads, nextThread];

  return {
    ...current,
    threads: sortThreads(nextThreads)
  };
}

export function WorkspaceMessenger({
  userRole = "manager",
  initialNav = "inbox",
  initialThreadId = null,
  embedded = false,
  hideSidebar = false,
  onCloseWorkspace = null,
  onUpgradeToRealWorkspace = null,
  onWorkspaceLogout = null,
  workspaceMode = "demo",
  workspaceScope = "both",
  authToken = null,
  currentUserOverride = null,
  preferredWorkspaceUserId = null,
  onOpenPersonalChat = null
}) {
  const [workspaceState, setWorkspaceState] = useState(() => buildMockWorkspaceState(userRole, currentUserOverride));
  const [activeNav, setActiveNav] = useState("inbox");
  const [filter, setFilter] = useState("inbox");
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("Chat");
  const [draft, setDraft] = useState("");
  const [detailMetric, setDetailMetric] = useState(null);
  const [activeWorkspace, setActiveWorkspace] = useState(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(null);
  const [activeWorkspaceMembership, setActiveWorkspaceMembership] = useState(null);
  const [workspaceSettings, setWorkspaceSettings] = useState(null);
  const [workspaceSettingsLoading, setWorkspaceSettingsLoading] = useState(false);
  const [workspaceAccountingEnabling, setWorkspaceAccountingEnabling] = useState(false);
  const [workspaceDefaultCurrencySaving, setWorkspaceDefaultCurrencySaving] = useState(false);
  const [invitingAccountant, setInvitingAccountant] = useState(false);
  const [financeWorkspaces, setFinanceWorkspaces] = useState([]);
  const [financeWorkspacesLoading, setFinanceWorkspacesLoading] = useState(false);
  const [financeSummary, setFinanceSummary] = useState(null);
  const [financeFxRates, setFinanceFxRates] = useState(null);
  const [financeTaxSummary, setFinanceTaxSummary] = useState(null);
  const [financeProfitLossReport, setFinanceProfitLossReport] = useState(null);
  const [financeCashFlowReport, setFinanceCashFlowReport] = useState(null);
  const [financeAgedReceivablesReport, setFinanceAgedReceivablesReport] = useState(null);
  const [financeBalanceSheetReport, setFinanceBalanceSheetReport] = useState(null);
  const [financePayrollRecords, setFinancePayrollRecords] = useState([]);
  const [financeAccountantSummary, setFinanceAccountantSummary] = useState(null);
  const [financeBankAccounts, setFinanceBankAccounts] = useState([]);
  const [financeBankTransactions, setFinanceBankTransactions] = useState({});
  const [financeAccountingState, setFinanceAccountingState] = useState({
    enabled: false,
    enabledAt: null
  });
  const financeAccountingPeriodRef = useRef("all");
  const financeWorkspacesRequestIdRef = useRef(0);
  const financeContextRequestIdRef = useRef(0);
  const financeStateRequestIdRef = useRef(0);
  const warehouseStateRequestIdRef = useRef(0);
  const [warehouseSummary, setWarehouseSummary] = useState(null);
  const [warehouseAlerts, setWarehouseAlerts] = useState([]);
  const [warehousePurchaseOrders, setWarehousePurchaseOrders] = useState([]);
  const [warehouseInventoryValueReport, setWarehouseInventoryValueReport] = useState(null);
  const [executionSummary, setExecutionSummary] = useState(null);
  const [overviewPressure, setOverviewPressure] = useState(null);
  const [workspaceNotifications, setWorkspaceNotifications] = useState([]);
  const [workspaceNotificationCount, setWorkspaceNotificationCount] = useState(0);
  const [workspaceNotificationsLoading, setWorkspaceNotificationsLoading] = useState(false);
  const [markingAllWorkspaceNotificationsRead, setMarkingAllWorkspaceNotificationsRead] = useState(false);
  const overviewRequestIdRef = useRef(0);
  const workspaceNotificationRequestIdRef = useRef(0);
  const [projectLinkTargetMessage, setProjectLinkTargetMessage] = useState(null);
  const [projectLinkSelectedProjectId, setProjectLinkSelectedProjectId] = useState("");
  const [projectLinkOptions, setProjectLinkOptions] = useState([]);
  const [projectLinkOptionsLoading, setProjectLinkOptionsLoading] = useState(false);
  const [projectLinkSubmitting, setProjectLinkSubmitting] = useState(false);
  const [financeCustomers, setFinanceCustomers] = useState([]);
  const [financeVendors, setFinanceVendors] = useState([]);
  const [platformWorkspaces, setPlatformWorkspaces] = useState([]);
  const [platformWorkspacesLoading, setPlatformWorkspacesLoading] = useState(false);
  const [selectedPlatformWorkspaceId, setSelectedPlatformWorkspaceId] = useState(null);
  const [platformWorkspaceMembers, setPlatformWorkspaceMembers] = useState([]);
  const [platformWorkspaceMembersLoading, setPlatformWorkspaceMembersLoading] = useState(false);
  const [platformCreatingWorkspace, setPlatformCreatingWorkspace] = useState(false);
  const [platformProvisioningMember, setPlatformProvisioningMember] = useState(false);
  const [platformSavingMemberId, setPlatformSavingMemberId] = useState(null);
  const [financeActivity, setFinanceActivity] = useState([]);
  const [financeMembers, setFinanceMembers] = useState([]);
  const [financeMembersLoading, setFinanceMembersLoading] = useState(false);
  const [savingFinanceMemberId, setSavingFinanceMemberId] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [reactions, setReactions] = useState({});
  const [activePicker, setActivePicker] = useState(null);
  const seededReactionsRef = useRef(false);
  const toastCooldownRef = useRef(new Map());
  const dismissToast = useCallback((toastId) => {
    setToasts((current) => current.filter((toast) => toast.id !== toastId));
  }, []);
  const pushToast = useCallback((toast) => {
    const dedupeKey = toast?.dedupeKey ? String(toast.dedupeKey) : "";
    const cooldownMs = Number.isFinite(Number(toast?.cooldownMs)) ? Math.max(0, Number(toast.cooldownMs)) : 0;
    if (dedupeKey && cooldownMs > 0) {
      const now = Date.now();
      const lastAt = Number(toastCooldownRef.current.get(dedupeKey) || 0);
      if (now - lastAt < cooldownMs) {
        return;
      }
      toastCooldownRef.current.set(dedupeKey, now);
    }

    const nextToast = { id: uid("toast"), ...toast };
    setToasts((current) => [nextToast, ...current].slice(0, 4));
    window.setTimeout(() => {
      dismissToast(nextToast.id);
    }, 4000);
  }, [dismissToast]);
  const realWorkspaceEnabled = workspaceMode === "real" && Boolean(authToken);
  const activeWorkspaceModules = useMemo(
    () => (Array.isArray(activeWorkspaceMembership?.modules) ? activeWorkspaceMembership.modules : []),
    [activeWorkspaceMembership?.modules]
  );
  const effectiveWorkspaceScope = useMemo(() => {
    if (!realWorkspaceEnabled || !activeWorkspaceModules.length) {
      return workspaceScope;
    }

    const hasFinance = activeWorkspaceModules.includes("finance");
    const hasWarehouse = activeWorkspaceModules.includes("warehouse");

    if (workspaceScope === "both") {
      if (hasFinance && hasWarehouse) {
        return "both";
      }
      if (hasFinance) {
        return "finance";
      }
      if (hasWarehouse) {
        return "warehouse";
      }
      return "none";
    }

    return activeWorkspaceModules.includes(workspaceScope) ? workspaceScope : "none";
  }, [activeWorkspaceModules, realWorkspaceEnabled, workspaceScope]);
  const financeModuleAvailable = realWorkspaceEnabled && activeWorkspaceModules.includes("finance");
  const realFinanceEnabled = realWorkspaceEnabled && canAccessWorkspaceScope("finance", effectiveWorkspaceScope);
  const realWarehouseEnabled = realWorkspaceEnabled && canAccessWorkspaceScope("warehouse", effectiveWorkspaceScope);
  const workspaceSelectionStorageKey = useMemo(() => {
    const userIdentity = currentUserOverride?.id || workspaceState.currentUser?.id || "workspace-user";
    return `messenger-mvp-active-workspace:${userIdentity}`;
  }, [currentUserOverride?.id, workspaceState.currentUser?.id]);
  const workspaceRoles = useMemo(
    () => {
      if (realWorkspaceEnabled) {
        return Array.isArray(activeWorkspaceMembership?.financeRoles)
          ? [...activeWorkspaceMembership.financeRoles]
          : [];
      }

      return normalizeWorkspaceRoles(currentUserOverride || workspaceState.currentUser, userRole);
    },
    [activeWorkspaceMembership?.financeRoles, currentUserOverride, realWorkspaceEnabled, workspaceState.currentUser, userRole]
  );
  const financePermissions = useMemo(
    () => buildFinancePermissions(workspaceRoles, effectiveWorkspaceScope),
    [workspaceRoles, effectiveWorkspaceScope]
  );
  const workspaceDefaultCurrency = useMemo(
    () => resolveWorkspaceDefaultCurrency(activeWorkspace, workspaceSettings),
    [activeWorkspace, workspaceSettings]
  );
  const canBootstrapManageFinanceMembers = useMemo(() => {
    const sourceUser = currentUserOverride || workspaceState.currentUser;
    return Boolean(sourceUser?.isAdmin);
  }, [currentUserOverride, workspaceState.currentUser]);
  const canManageFinanceMembers = useMemo(() => {
    if (realWorkspaceEnabled) {
      return (
        Boolean(currentUserOverride?.isAdmin || workspaceState.currentUser?.isAdmin) ||
        activeWorkspaceMembership?.workspaceRole === "owner" ||
        activeWorkspaceMembership?.workspaceRole === "manager"
      );
    }

    const sourceUser = currentUserOverride || workspaceState.currentUser;
    const legacyRole = sourceUser?.workspaceRole || sourceUser?.role || userRole;
    return Boolean(sourceUser?.isAdmin) || legacyRole === "owner" || legacyRole === "manager";
  }, [activeWorkspaceMembership, currentUserOverride, realWorkspaceEnabled, workspaceState.currentUser, userRole]);
  const sidebarCurrentUser = useMemo(() => {
    const baseUser = workspaceState.currentUser;

    if (!realWorkspaceEnabled) {
      return baseUser;
    }

    return {
      ...baseUser,
      role: activeWorkspaceMembership?.workspaceRole || baseUser.role,
      workspaceRole: activeWorkspaceMembership?.workspaceRole || baseUser.workspaceRole || baseUser.role,
      workspaceModules: Array.isArray(activeWorkspaceMembership?.modules)
        ? [...activeWorkspaceMembership.modules]
        : Array.isArray(baseUser.workspaceModules)
          ? [...baseUser.workspaceModules]
          : []
    };
  }, [activeWorkspaceMembership?.modules, activeWorkspaceMembership?.workspaceRole, realWorkspaceEnabled, workspaceState.currentUser]);
  const selectedPlatformWorkspace = useMemo(
    () => platformWorkspaces.find((entry) => entry.workspace?.id === selectedPlatformWorkspaceId) || null,
    [platformWorkspaces, selectedPlatformWorkspaceId]
  );
  const [activeThreadId, setActiveThreadId] = useState(() => {
    const initialState = buildMockWorkspaceState(userRole, currentUserOverride);
    const requestedThread = initialThreadId
      ? initialState.threads.find(
          (thread) => thread.id === initialThreadId && canSeeThread(thread, userRole, effectiveWorkspaceScope, workspaceMode)
        )
      : null;
    const fallback = initialState.threads.find((thread) => canSeeThread(thread, userRole, effectiveWorkspaceScope, workspaceMode));
    return requestedThread?.id || fallback?.id || "financebot";
  });
  const preferredWorkspaceUserAppliedRef = useRef(null);

  const readStoredWorkspaceSelection = useCallback(() => {
    if (typeof window === "undefined") {
      return null;
    }

    try {
      return window.localStorage.getItem(workspaceSelectionStorageKey);
    } catch {
      return null;
    }
  }, [workspaceSelectionStorageKey]);

  const loadFinanceWorkspaces = useCallback(async (tokenToUse = authToken, options = {}) => {
    if (!tokenToUse || !realWorkspaceEnabled) {
      setFinanceWorkspaces([]);
      return [];
    }

    const requestId = financeWorkspacesRequestIdRef.current + 1;
    financeWorkspacesRequestIdRef.current = requestId;
    setFinanceWorkspacesLoading(true);
    try {
      const payload = await api.getWorkspaces(tokenToUse);
      if (requestId !== financeWorkspacesRequestIdRef.current) {
        return [];
      }
      const rawWorkspaces = Array.isArray(payload?.workspaces) ? payload.workspaces : [];
      const nextWorkspaces = rawWorkspaces.filter((entry) => {
        const modules = Array.isArray(entry?.membership?.modules) ? entry.membership.modules : [];
        if (workspaceScope === "both") {
          return modules.length > 0;
        }

        return modules.includes(workspaceScope);
      });
      setFinanceWorkspaces(nextWorkspaces);

      const validWorkspaceIds = new Set(
        nextWorkspaces.map((entry) => entry.workspace?.id).filter(Boolean)
      );
      const storedWorkspaceId = readStoredWorkspaceSelection();
      setActiveWorkspaceId((current) => {
        if (current && validWorkspaceIds.has(current)) {
          return current;
        }

        if (storedWorkspaceId && validWorkspaceIds.has(storedWorkspaceId)) {
          return storedWorkspaceId;
        }

        return nextWorkspaces[0]?.workspace?.id || null;
      });

      return nextWorkspaces;
    } catch (error) {
      if (requestId !== financeWorkspacesRequestIdRef.current) {
        return [];
      }
      if (options.toastOnError) {
        pushToast({
          title: "Workspaces unavailable",
          body: error.message || "Unable to load your workspace list.",
          dedupeKey: "finance-workspaces-unavailable",
          cooldownMs: 20000
        });
      }
      return [];
    } finally {
      if (requestId === financeWorkspacesRequestIdRef.current) {
        setFinanceWorkspacesLoading(false);
      }
    }
  }, [authToken, readStoredWorkspaceSelection, realWorkspaceEnabled, workspaceScope]);

  const loadFinanceContext = useCallback(
    async (tokenToUse = authToken, workspaceIdToUse = activeWorkspaceId, options = {}) => {
      if (!tokenToUse || !realWorkspaceEnabled) {
        setActiveWorkspace(null);
        setActiveWorkspaceMembership(null);
        setWorkspaceSettings(null);
        return null;
      }

      if (!workspaceIdToUse) {
        return null;
      }

      const requestId = financeContextRequestIdRef.current + 1;
      financeContextRequestIdRef.current = requestId;
      try {
        const context = await api.getWorkspaceContext(tokenToUse, workspaceIdToUse);
        if (requestId !== financeContextRequestIdRef.current) {
          return null;
        }
        setActiveWorkspace(context.workspace || null);
        setActiveWorkspaceMembership(context.membership || null);
        if (context.workspace?.id) {
          setActiveWorkspaceId((current) => current || context.workspace.id);
        }
        return context;
      } catch (error) {
        if (requestId !== financeContextRequestIdRef.current) {
          return null;
        }
        if (options.toastOnError) {
          pushToast({
            title: "Workspace unavailable",
            body: error.message || "Unable to resolve the active workspace."
          });
        }
        return null;
      }
    },
    [activeWorkspaceId, authToken, realWorkspaceEnabled]
  );


  const {
    loadWorkspaceSettings,
    loadPlatformWorkspaces,
    loadPlatformWorkspaceMembers,
    loadWorkspaceConversations,
    loadRealFinanceActivity,
    loadFinanceMembers,
    handleCreatePlatformWorkspace,
    handleProvisionPlatformWorkspaceMember,
    handleUpdatePlatformMemberAccess,
    handleTogglePlatformFinanceRole
  } = useWorkspaceAdminAndPlatformLoaders({
    authToken,
    activeWorkspaceId,
    selectedPlatformWorkspaceId,
    realWorkspaceEnabled,
    canBootstrapManageFinanceMembers,
    canManageFinanceMembers,
    realFinanceEnabled,
    pushToast,
    normalizePlatformWorkspaceMember,
    applyRealWorkspaceConversations,
    setWorkspaceSettings,
    setWorkspaceSettingsLoading,
    setPlatformWorkspaces,
    setPlatformWorkspacesLoading,
    setSelectedPlatformWorkspaceId,
    setPlatformWorkspaceMembers,
    setPlatformWorkspaceMembersLoading,
    setPlatformCreatingWorkspace,
    setPlatformProvisioningMember,
    setPlatformSavingMemberId,
    setFinanceMembers,
    setFinanceMembersLoading,
    setWorkspaceState,
    setFinanceActivity
  });

  const loadRealFinanceState = useCallback(async (tokenToUse = authToken, options = {}, workspaceIdOverride = activeWorkspaceId) => {
    if (!tokenToUse || !realFinanceEnabled) {
      return false;
    }

    const requestId = financeStateRequestIdRef.current + 1;
    financeStateRequestIdRef.current = requestId;
    try {
      const accountingPeriod = options.accountingPeriod || financeAccountingPeriodRef.current || "all";
      financeAccountingPeriodRef.current = accountingPeriod;
      const availableWorkspaces = await loadFinanceWorkspaces(tokenToUse);
      if (requestId !== financeStateRequestIdRef.current) {
        return false;
      }
      const resolvedWorkspaceId =
        workspaceIdOverride ||
        activeWorkspaceId ||
        availableWorkspaces[0]?.workspace?.id ||
        null;

      if (!resolvedWorkspaceId) {
        setActiveWorkspace(null);
        setActiveWorkspaceMembership(null);
        setWorkspaceSettings(null);
        setFinanceSummary(null);
        setFinanceFxRates(null);
        setFinancePayrollRecords([]);
        setFinanceAccountantSummary(null);
        setWarehouseSummary(null);
        setFinanceCustomers([]);
        setFinanceVendors([]);
        setFinanceActivity([]);
        setFinanceMembers([]);
        return false;
      }

      const [context, settings] = await Promise.all([
        loadFinanceContext(tokenToUse, resolvedWorkspaceId),
        loadWorkspaceSettings(tokenToUse, resolvedWorkspaceId),
        loadWorkspaceConversations(tokenToUse, resolvedWorkspaceId)
      ]);
      if (requestId !== financeStateRequestIdRef.current) {
        return false;
      }
      const baseCurrency = resolveWorkspaceDefaultCurrency(context?.workspace, settings);
      const [
        invoices,
        expenses,
        actions,
        summary,
        fxRates,
        customers,
        vendors,
        taxSummary,
        profitLossReport,
        cashFlowReport,
        agedReceivablesReport,
        balanceSheetReport,
        bankAccounts,
        payrollRecords,
        accountantSummary
      ] = await Promise.all([
        api.getFinanceInvoices(tokenToUse, {}, resolvedWorkspaceId),
        api.getFinanceExpenses(tokenToUse, {}, resolvedWorkspaceId),
        api.getFinanceActivity(tokenToUse, { limit: 24 }, resolvedWorkspaceId),
        api.getFinanceSummary(tokenToUse, resolvedWorkspaceId, { accountingPeriod, baseCurrency }),
        api.getFinanceFxRates(tokenToUse, resolvedWorkspaceId, { baseCurrency }).catch(() => null),
        api.getFinanceCustomers(tokenToUse, resolvedWorkspaceId, { status: "all" }),
        api.getFinanceVendors(tokenToUse, resolvedWorkspaceId, { status: "all" }),
        api.getFinanceTaxSummary(tokenToUse, resolvedWorkspaceId, { baseCurrency }),
        api.getFinanceProfitLossReport(tokenToUse, resolvedWorkspaceId, { period: "month", baseCurrency }),
        api.getFinanceCashFlowReport(tokenToUse, resolvedWorkspaceId, { period: "month", baseCurrency }),
        api.getFinanceAgedReceivablesReport(tokenToUse, resolvedWorkspaceId, { baseCurrency }),
        api.getFinanceBalanceSheetReport(tokenToUse, resolvedWorkspaceId, { asOfDate: todayDateInputValue(), baseCurrency }),
        api.getBankAccounts(tokenToUse, resolvedWorkspaceId).catch(() => []),
        api.getPayrollRecords(tokenToUse, resolvedWorkspaceId).catch(() => []),
        financePermissions?.isAccountant
          ? api.getFinanceAccountantSummary(tokenToUse, resolvedWorkspaceId, { baseCurrency }).catch(() => null)
          : Promise.resolve(null)
      ]);
      if (requestId !== financeStateRequestIdRef.current) {
        return false;
      }
      const bankTransactionEntries = await Promise.all(
        (Array.isArray(bankAccounts) ? bankAccounts : []).map(async (account) => [
          account.id,
          await api.getBankTransactions(tokenToUse, account.id, {}, resolvedWorkspaceId).catch(() => [])
        ])
      );

      setWorkspaceState((current) =>
        applyRealFinanceRecords(current, {
          invoices,
          expenses
        })
      );
      setFinanceActivity(actions);
      setFinanceSummary(summary);
      setFinanceFxRates(fxRates || null);
      setFinanceTaxSummary(taxSummary);
      setFinanceProfitLossReport(profitLossReport);
      setFinanceCashFlowReport(cashFlowReport);
      setFinanceAgedReceivablesReport(agedReceivablesReport);
      setFinanceBalanceSheetReport(balanceSheetReport);
      setFinancePayrollRecords(Array.isArray(payrollRecords) ? payrollRecords : []);
      setFinanceAccountantSummary(accountantSummary || null);
      setFinanceBankAccounts(Array.isArray(bankAccounts) ? bankAccounts : []);
      setFinanceBankTransactions(Object.fromEntries(bankTransactionEntries));
      setFinanceCustomers(Array.isArray(customers) ? customers : []);
      setFinanceVendors(Array.isArray(vendors) ? vendors : []);
      void loadWorkspaceOverview(tokenToUse, resolvedWorkspaceId);

      if (options.toastOnSuccess) {
        pushToast({
          title: "Finance refreshed",
          body: "The latest finance records and activity are now loaded."
        });
      }

      return true;
    } catch (error) {
      if (options.toastOnSuccess || options.toastOnError) {
        pushToast({
          title: options.toastOnSuccess ? "Finance refresh failed" : "Finance sync failed",
          body: error.message || "Unable to load finance records.",
          dedupeKey: "finance-sync-failed",
          cooldownMs: 20000
        });
      }
      return false;
    }
  }, [activeWorkspaceId, authToken, financePermissions?.isAccountant, loadFinanceContext, loadFinanceWorkspaces, loadWorkspaceConversations, loadWorkspaceOverview, loadWorkspaceSettings, realFinanceEnabled]);

  const loadFinanceTaxSummary = useCallback(async (options = {}, tokenToUse = authToken, workspaceIdToUse = activeWorkspaceId) => {
    if (!tokenToUse || !realFinanceEnabled || !workspaceIdToUse) {
      return null;
    }

    const payload = await api.getFinanceTaxSummary(tokenToUse, workspaceIdToUse, {
      ...options,
      baseCurrency: options.baseCurrency || workspaceDefaultCurrency
    });
    setFinanceTaxSummary(payload);
    return payload;
  }, [activeWorkspaceId, authToken, realFinanceEnabled, workspaceDefaultCurrency]);

  const loadFinanceProfitLossReport = useCallback(async (options = {}, tokenToUse = authToken, workspaceIdToUse = activeWorkspaceId) => {
    if (!tokenToUse || !realFinanceEnabled || !workspaceIdToUse) {
      return null;
    }

    const payload = await api.getFinanceProfitLossReport(tokenToUse, workspaceIdToUse, {
      period: options.period || "month",
      ...options,
      baseCurrency: options.baseCurrency || workspaceDefaultCurrency
    });
    setFinanceProfitLossReport(payload);
    return payload;
  }, [activeWorkspaceId, authToken, realFinanceEnabled, workspaceDefaultCurrency]);

  const loadFinanceCashFlowReport = useCallback(async (options = {}, tokenToUse = authToken, workspaceIdToUse = activeWorkspaceId) => {
    if (!tokenToUse || !realFinanceEnabled || !workspaceIdToUse) {
      return null;
    }

    const payload = await api.getFinanceCashFlowReport(tokenToUse, workspaceIdToUse, {
      period: options.period || "month",
      ...options,
      baseCurrency: options.baseCurrency || workspaceDefaultCurrency
    });
    setFinanceCashFlowReport(payload);
    return payload;
  }, [activeWorkspaceId, authToken, realFinanceEnabled, workspaceDefaultCurrency]);

  const loadFinanceAgedReceivablesReport = useCallback(async (options = {}, tokenToUse = authToken, workspaceIdToUse = activeWorkspaceId) => {
    if (!tokenToUse || !realFinanceEnabled || !workspaceIdToUse) {
      return null;
    }

    const payload = await api.getFinanceAgedReceivablesReport(tokenToUse, workspaceIdToUse, {
      ...options,
      baseCurrency: options.baseCurrency || workspaceDefaultCurrency
    });
    setFinanceAgedReceivablesReport(payload);
    return payload;
  }, [activeWorkspaceId, authToken, realFinanceEnabled, workspaceDefaultCurrency]);

  const loadFinanceBalanceSheetReport = useCallback(async (options = {}, tokenToUse = authToken, workspaceIdToUse = activeWorkspaceId) => {
    if (!tokenToUse || !realFinanceEnabled || !workspaceIdToUse) {
      return null;
    }

    const payload = await api.getFinanceBalanceSheetReport(tokenToUse, workspaceIdToUse, {
      ...options,
      baseCurrency: options.baseCurrency || workspaceDefaultCurrency
    });
    setFinanceBalanceSheetReport(payload);
    return payload;
  }, [activeWorkspaceId, authToken, realFinanceEnabled, workspaceDefaultCurrency]);

  const loadFinanceFxRates = useCallback(async (options = {}, tokenToUse = authToken, workspaceIdToUse = activeWorkspaceId) => {
    if (!tokenToUse || !realFinanceEnabled || !workspaceIdToUse) {
      return null;
    }

    const payload = await api.getFinanceFxRates(tokenToUse, workspaceIdToUse, {
      ...options,
      baseCurrency: options.baseCurrency || workspaceDefaultCurrency
    });
    setFinanceFxRates(payload);
    return payload;
  }, [activeWorkspaceId, authToken, realFinanceEnabled, workspaceDefaultCurrency]);

  const loadFinanceAccountantSummary = useCallback(async (options = {}, tokenToUse = authToken, workspaceIdToUse = activeWorkspaceId) => {
    if (!tokenToUse || !realFinanceEnabled || !workspaceIdToUse || !financePermissions?.isAccountant) {
      setFinanceAccountantSummary(null);
      return null;
    }

    const payload = await api.getFinanceAccountantSummary(tokenToUse, workspaceIdToUse, {
      ...options,
      baseCurrency: options.baseCurrency || workspaceDefaultCurrency
    });
    setFinanceAccountantSummary(payload);
    return payload;
  }, [activeWorkspaceId, authToken, financePermissions?.isAccountant, realFinanceEnabled, workspaceDefaultCurrency]);

  const loadFinanceInvoiceDetail = useCallback(async (invoiceId, tokenToUse = authToken, workspaceIdToUse = activeWorkspaceId) => {
    if (!tokenToUse || !realFinanceEnabled || !workspaceIdToUse || !invoiceId) {
      return null;
    }

    return api.getFinanceInvoiceDetail(tokenToUse, invoiceId, workspaceIdToUse);
  }, [activeWorkspaceId, authToken, realFinanceEnabled]);

  const loadFinanceExpenseDetail = useCallback(async (expenseId, tokenToUse = authToken, workspaceIdToUse = activeWorkspaceId) => {
    if (!tokenToUse || !realFinanceEnabled || !workspaceIdToUse || !expenseId) {
      return null;
    }

    return api.getFinanceExpenseDetail(tokenToUse, expenseId, workspaceIdToUse);
  }, [activeWorkspaceId, authToken, realFinanceEnabled]);

  const loadFinanceAccountDrilldown = useCallback(async (accountCode, options = {}, tokenToUse = authToken, workspaceIdToUse = activeWorkspaceId) => {
    if (!tokenToUse || !realFinanceEnabled || !workspaceIdToUse || !accountCode) {
      return null;
    }

    const accountingPeriod = options.accountingPeriod || financeAccountingPeriodRef.current || "all";
    financeAccountingPeriodRef.current = accountingPeriod;

    return api.getFinanceAccountDrilldown(
      tokenToUse,
      accountCode,
      {
        accountingPeriod,
        limit: options.limit || 12
      },
      workspaceIdToUse
    );
  }, [activeWorkspaceId, authToken, realFinanceEnabled]);

  const loadFinanceStatementExport = useCallback(async (options = {}, tokenToUse = authToken, workspaceIdToUse = activeWorkspaceId) => {
    if (!tokenToUse || !realFinanceEnabled || !workspaceIdToUse) {
      return null;
    }

    const accountingPeriod = options.accountingPeriod || financeAccountingPeriodRef.current || "all";
    financeAccountingPeriodRef.current = accountingPeriod;

    return api.getFinanceAccountingStatementExport(
      tokenToUse,
      workspaceIdToUse,
      {
        accountingPeriod
      }
    );
  }, [activeWorkspaceId, authToken, realFinanceEnabled]);

  const loadFinanceJournalExport = useCallback(async (options = {}, tokenToUse = authToken, workspaceIdToUse = activeWorkspaceId) => {
    if (!tokenToUse || !realFinanceEnabled || !workspaceIdToUse) {
      return null;
    }

    const accountingPeriod = options.accountingPeriod || financeAccountingPeriodRef.current || "all";
    financeAccountingPeriodRef.current = accountingPeriod;

    return api.getFinanceAccountingJournalExport(
      tokenToUse,
      workspaceIdToUse,
      {
        accountingPeriod,
        limit: options.limit || 150
      }
    );
  }, [activeWorkspaceId, authToken, realFinanceEnabled]);

  const lockFinancePeriod = useCallback(async (lockRequest, tokenToUse = authToken, workspaceIdToUse = activeWorkspaceId) => {
    const periodKey = typeof lockRequest === "string" ? lockRequest : lockRequest?.periodKey;
    const note = typeof lockRequest === "string" ? "" : String(lockRequest?.note || "").trim();
    if (!tokenToUse || !realFinanceEnabled || !workspaceIdToUse || !periodKey) {
      return null;
    }

    const payload = await api.lockFinancePeriod(
      tokenToUse,
      {
        periodKey,
        note
      },
      workspaceIdToUse
    );
    await loadRealFinanceState(tokenToUse, { accountingPeriod: financeAccountingPeriodRef.current, toastOnSuccess: false }, workspaceIdToUse);
    return payload;
  }, [activeWorkspaceId, authToken, loadRealFinanceState, realFinanceEnabled]);

  const unlockFinancePeriod = useCallback(async (periodKey, tokenToUse = authToken, workspaceIdToUse = activeWorkspaceId) => {
    if (!tokenToUse || !realFinanceEnabled || !workspaceIdToUse || !periodKey) {
      return null;
    }

    const payload = await api.unlockFinancePeriod(tokenToUse, periodKey, workspaceIdToUse);
    await loadRealFinanceState(tokenToUse, { accountingPeriod: financeAccountingPeriodRef.current, toastOnSuccess: false }, workspaceIdToUse);
    return payload;
  }, [activeWorkspaceId, authToken, loadRealFinanceState, realFinanceEnabled]);

  const loadRealWarehouseState = useCallback(async (tokenToUse = authToken, options = {}, workspaceIdOverride = activeWorkspaceId) => {
    if (!tokenToUse || !realWarehouseEnabled) {
      return false;
    }

    const requestId = warehouseStateRequestIdRef.current + 1;
    warehouseStateRequestIdRef.current = requestId;
    try {
      const availableWorkspaces = await loadFinanceWorkspaces(tokenToUse);
      if (requestId !== warehouseStateRequestIdRef.current) {
        return false;
      }
      const resolvedWorkspaceId =
        workspaceIdOverride ||
        activeWorkspaceId ||
        availableWorkspaces[0]?.workspace?.id ||
        null;

      if (!resolvedWorkspaceId) {
        return false;
      }

      await Promise.all([
        loadFinanceContext(tokenToUse, resolvedWorkspaceId),
        loadWorkspaceSettings(tokenToUse, resolvedWorkspaceId),
        loadWorkspaceConversations(tokenToUse, resolvedWorkspaceId)
      ]);
      if (requestId !== warehouseStateRequestIdRef.current) {
        return false;
      }
      const [products, orders, summary, alerts, purchaseOrders, vendors, inventoryValueReport] = await Promise.all([
        api.getWarehouseProducts(tokenToUse, resolvedWorkspaceId),
        api.getWarehouseOrders(tokenToUse, resolvedWorkspaceId),
        api.getWarehouseSummary(tokenToUse, resolvedWorkspaceId),
        api.getWarehouseAlerts(tokenToUse, resolvedWorkspaceId),
        api.getPurchaseOrders(tokenToUse, resolvedWorkspaceId),
        financeModuleAvailable
          ? api.getFinanceVendors(tokenToUse, resolvedWorkspaceId, { status: "all" }).catch(() => [])
          : Promise.resolve(null),
        api.getWarehouseInventoryValueReport(tokenToUse, resolvedWorkspaceId).catch(() => null)
      ]);
      if (requestId !== warehouseStateRequestIdRef.current) {
        return false;
      }

      setWorkspaceState((current) =>
        applyRealWarehouseRecords(current, {
          products,
          orders
        })
      );
      setWarehouseSummary(summary);
      setWarehouseAlerts(Array.isArray(alerts) ? alerts.map(mapWarehouseAlertRecord) : []);
      setWarehousePurchaseOrders(Array.isArray(purchaseOrders) ? purchaseOrders.map(mapPurchaseOrderRecord) : []);
      setWarehouseInventoryValueReport(inventoryValueReport || null);
      if (Array.isArray(vendors)) {
        setFinanceVendors(vendors);
      }
      void loadWorkspaceOverview(tokenToUse, resolvedWorkspaceId);

      if (options.toastOnSuccess) {
        pushToast({
          title: "Warehouse refreshed",
          body: "The latest warehouse products and shipments are now loaded."
        });
      }

      return true;
    } catch (error) {
      if (options.toastOnSuccess || options.toastOnError) {
        pushToast({
          title: options.toastOnSuccess ? "Warehouse refresh failed" : "Warehouse sync failed",
          body: error.message || "Unable to load warehouse records.",
          dedupeKey: "warehouse-sync-failed",
          cooldownMs: 20000
        });
      }
      return false;
    }
  }, [activeWorkspaceId, authToken, financeModuleAvailable, loadFinanceContext, loadFinanceWorkspaces, loadWorkspaceConversations, loadWorkspaceOverview, loadWorkspaceSettings, realWarehouseEnabled]);

  const loadWarehouseProductMovementReview = useCallback(async (productId, tokenToUse = authToken, workspaceIdToUse = activeWorkspaceId) => {
    if (!tokenToUse || !workspaceIdToUse || !productId || !realWarehouseEnabled) {
      throw new Error("Warehouse product history is not available right now.");
    }

    return api.getWarehouseProductMovements(tokenToUse, productId, workspaceIdToUse);
  }, [activeWorkspaceId, authToken, realWarehouseEnabled]);

  const loadWarehouseOrderReview = useCallback(async (orderId, tokenToUse = authToken, workspaceIdToUse = activeWorkspaceId) => {
    if (!tokenToUse || !workspaceIdToUse || !orderId || !realWarehouseEnabled) {
      throw new Error("Warehouse shipment review is not available right now.");
    }

    return api.getWarehouseOrderReview(tokenToUse, orderId, workspaceIdToUse);
  }, [activeWorkspaceId, authToken, realWarehouseEnabled]);

  const loadExecutionSummary = useCallback(async (tokenToUse = authToken, workspaceIdToUse = activeWorkspaceId, options = {}) => {
    if (!tokenToUse || !realWorkspaceEnabled || !workspaceIdToUse) {
      setExecutionSummary(null);
      return null;
    }

    try {
      const summary = await api.getWorkspaceExecutionSummary(tokenToUse, workspaceIdToUse);
      setExecutionSummary(summary);
      void loadWorkspaceOverview(tokenToUse, workspaceIdToUse);
      return summary;
    } catch (error) {
      if (options.toastOnError) {
        pushToast({
          title: "Execution summary unavailable",
          body: error.message || "Unable to load task and project pressure right now.",
          dedupeKey: "execution-summary-unavailable",
          cooldownMs: 20000
        });
      }
      return null;
    }
  }, [activeWorkspaceId, authToken, loadWorkspaceOverview, pushToast, realWorkspaceEnabled]);

  const loadWorkspaceOverview = useCallback(async (tokenToUse = authToken, workspaceIdToUse = activeWorkspaceId, options = {}) => {
    if (!tokenToUse || !realWorkspaceEnabled || !workspaceIdToUse) {
      setOverviewPressure(null);
      return null;
    }

    const requestId = overviewRequestIdRef.current + 1;
    overviewRequestIdRef.current = requestId;

    try {
      const overview = await api.getWorkspaceOverview(tokenToUse, workspaceIdToUse);
      if (requestId !== overviewRequestIdRef.current) {
        return null;
      }
      setOverviewPressure(overview);
      return overview;
    } catch (error) {
      if (options.toastOnError) {
        pushToast({
          title: "Overview unavailable",
          body: error.message || "Unable to load workspace pressure right now.",
          dedupeKey: "workspace-overview-unavailable",
          cooldownMs: 20000
        });
      }
      return null;
    }
  }, [activeWorkspaceId, authToken, pushToast, realWorkspaceEnabled]);

  const loadWorkspaceNotifications = useCallback(async (tokenToUse = authToken, workspaceIdToUse = activeWorkspaceId, options = {}) => {
    if (!tokenToUse || !realWorkspaceEnabled || !workspaceIdToUse) {
      setWorkspaceNotifications([]);
      setWorkspaceNotificationCount(0);
      return null;
    }

    const requestId = workspaceNotificationRequestIdRef.current + 1;
    workspaceNotificationRequestIdRef.current = requestId;
    setWorkspaceNotificationsLoading(true);

    try {
      const [countPayload, listPayload] = await Promise.all([
        api.getWorkspaceNotificationCount(tokenToUse, workspaceIdToUse),
        api.getWorkspaceNotifications(tokenToUse, workspaceIdToUse)
      ]);

      if (requestId !== workspaceNotificationRequestIdRef.current) {
        return null;
      }

      setWorkspaceNotificationCount(Number(countPayload?.unread || 0));
      setWorkspaceNotifications(Array.isArray(listPayload?.notifications) ? listPayload.notifications : []);
      return listPayload;
    } catch (error) {
      if (options.toastOnError) {
        pushToast({
          title: "Notifications unavailable",
          body: error.message || "Unable to load workspace notifications right now.",
          dedupeKey: "workspace-notifications-unavailable",
          cooldownMs: 20000
        });
      }
      return null;
    } finally {
      if (requestId === workspaceNotificationRequestIdRef.current) {
        setWorkspaceNotificationsLoading(false);
      }
    }
  }, [activeWorkspaceId, authToken, pushToast, realWorkspaceEnabled]);


  const {
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
  } = useWorkspaceBankingAndPayroll({
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
  });


  const {
    enableWorkspaceAccounting,
    updateWorkspaceDefaultCurrency,
    handleInviteAccountant,
    handleToggleFinanceMemberRole,
    handleUpdateFinanceMemberAccess
  } = useWorkspaceAdminAndPlatformActions({
    authToken,
    activeWorkspaceId,
    realWorkspaceEnabled,
    workspaceAccountingEnabling,
    workspaceDefaultCurrencySaving,
    canManageFinanceMembers,
    canBootstrapManageFinanceMembers,
    pushToast,
    loadFinanceContext,
    loadRealFinanceState,
    loadRealWarehouseState,
    loadWorkspaceSettings,
    loadFinanceMembers,
    setWorkspaceAccountingEnabling,
    setWorkspaceDefaultCurrencySaving,
    setInvitingAccountant,
    setSavingFinanceMemberId,
    setFinanceMembers
  });

  useEffect(() => {
    setActiveNav(initialNav);
  }, [initialNav]);

  const visibleThreads = useMemo(
    () => workspaceState.threads.filter((thread) => canSeeThread(thread, userRole, effectiveWorkspaceScope, workspaceMode)),
    [effectiveWorkspaceScope, userRole, workspaceMode, workspaceState.threads]
  );
  const activeThread = useMemo(
    () => visibleThreads.find((thread) => thread.id === activeThreadId) || visibleThreads[0],
    [activeThreadId, visibleThreads]
  );
  const totalUnread = useMemo(
    () => visibleThreads.reduce((sum, thread) => sum + thread.unread, 0),
    [visibleThreads]
  );

  useEffect(() => {
    if (!activeThread && visibleThreads[0]) {
      setActiveThreadId(visibleThreads[0].id);
    }
  }, [activeThread, visibleThreads]);

  useEffect(() => {
    const financeRoute = parseFinanceHashRoute();
    if (!financeRoute || !canAccessWorkspaceScope("finance", effectiveWorkspaceScope)) {
      return;
    }

    if (activeNav !== "finances") {
      setActiveNav("finances");
    }

    if (visibleThreads.some((thread) => thread.id === "financebot") && activeThreadId !== "financebot") {
      setActiveThreadId("financebot");
    }

    if (activeTab !== "Media") {
      setActiveTab("Media");
    }
  }, [activeNav, activeTab, activeThreadId, effectiveWorkspaceScope, visibleThreads]);

  useEffect(() => {
    setProjectLinkTargetMessage(null);
    setProjectLinkSelectedProjectId("");
  }, [activeThread?.id]);

  useEffect(() => {
    preferredWorkspaceUserAppliedRef.current = null;
  }, [preferredWorkspaceUserId]);

  useEffect(() => {
    if (!realWorkspaceEnabled || !preferredWorkspaceUserId) {
      return;
    }

    if (preferredWorkspaceUserAppliedRef.current === preferredWorkspaceUserId) {
      return;
    }

    const matchingThread = visibleThreads.find(
      (thread) => !thread.isBot && thread.linkedUserId === preferredWorkspaceUserId
    );

    if (!matchingThread) {
      return;
    }

    preferredWorkspaceUserAppliedRef.current = preferredWorkspaceUserId;
    setActiveThreadId(matchingThread.id);
    setActiveTab("Chat");
  }, [preferredWorkspaceUserId, realWorkspaceEnabled, visibleThreads]);

  useEffect(() => {
    if (!realWorkspaceEnabled) {
      setFinanceActivity([]);
      setFinanceWorkspaces([]);
      setFinanceSummary(null);
      setWarehouseSummary(null);
      setWarehouseAlerts([]);
      setWarehousePurchaseOrders([]);
      setExecutionSummary(null);
      setWorkspaceNotifications([]);
      setWorkspaceNotificationCount(0);
      setFinanceCustomers([]);
      setFinanceVendors([]);
      setPlatformWorkspaces([]);
      setSelectedPlatformWorkspaceId(null);
      setPlatformWorkspaceMembers([]);
      setOverviewPressure(null);
      setActiveWorkspace(null);
      setActiveWorkspaceId(null);
      setActiveWorkspaceMembership(null);
      setWorkspaceSettings(null);
      return undefined;
    }

    loadFinanceWorkspaces(authToken);
    if (activeWorkspaceId) {
      loadFinanceContext(authToken, activeWorkspaceId);
      loadWorkspaceSettings(authToken, activeWorkspaceId);
      loadWorkspaceConversations(authToken, activeWorkspaceId);
      loadExecutionSummary(authToken, activeWorkspaceId, { toastOnError: false });
      loadWorkspaceOverview(authToken, activeWorkspaceId, { toastOnError: false });
      loadWorkspaceNotifications(authToken, activeWorkspaceId, { toastOnError: false });
    }

    if (realFinanceEnabled) {
      loadRealFinanceState(authToken, {}, activeWorkspaceId || undefined);
    }
    if (realWarehouseEnabled) {
      loadRealWarehouseState(authToken, {}, activeWorkspaceId || undefined);
    }
    return undefined;
  }, [activeWorkspaceId, authToken, loadExecutionSummary, loadFinanceContext, loadFinanceWorkspaces, loadRealFinanceState, loadRealWarehouseState, loadWorkspaceConversations, loadWorkspaceNotifications, loadWorkspaceOverview, loadWorkspaceSettings, realFinanceEnabled, realWarehouseEnabled, realWorkspaceEnabled]);

  useEffect(() => {
    if (!realWorkspaceEnabled || !activeWorkspaceId) {
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(workspaceSelectionStorageKey, activeWorkspaceId);
    } catch {
      // Ignore localStorage persistence failures and keep the in-memory selection.
    }
  }, [activeWorkspaceId, realWorkspaceEnabled, workspaceSelectionStorageKey]);

  useEffect(() => {
    if (!realWorkspaceEnabled || !canManageFinanceMembers) {
      setFinanceMembers([]);
      return undefined;
    }

    loadFinanceMembers(authToken);
    return undefined;
  }, [authToken, canManageFinanceMembers, loadFinanceMembers, realWorkspaceEnabled]);

  useEffect(() => {
    if (!realWorkspaceEnabled || !canBootstrapManageFinanceMembers) {
      setPlatformWorkspaces([]);
      setSelectedPlatformWorkspaceId(null);
      setPlatformWorkspaceMembers([]);
      return undefined;
    }

    loadPlatformWorkspaces(authToken);
    return undefined;
  }, [authToken, canBootstrapManageFinanceMembers, loadPlatformWorkspaces, realWorkspaceEnabled]);

  useEffect(() => {
    if (typeof window === "undefined" || !realWorkspaceEnabled || !authToken || !activeWorkspaceId) {
      return undefined;
    }

    function handleStorage(event) {
      if (event.key !== WORKSPACE_TASK_EVENT_KEY || !event.newValue) {
        return;
      }

      try {
        const payload = JSON.parse(event.newValue);
        if (payload?.workspaceId && payload.workspaceId !== activeWorkspaceId) {
          return;
        }
      } catch {
        return;
      }

      void Promise.all([
        loadWorkspaceNotifications(authToken, activeWorkspaceId, { toastOnError: false }),
        loadExecutionSummary(authToken, activeWorkspaceId, { toastOnError: false }),
        loadWorkspaceOverview(authToken, activeWorkspaceId, { toastOnError: false })
      ]);
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [activeWorkspaceId, authToken, loadExecutionSummary, loadWorkspaceNotifications, loadWorkspaceOverview, realWorkspaceEnabled]);

  useEffect(() => {
    if (!realWorkspaceEnabled || !canBootstrapManageFinanceMembers || !selectedPlatformWorkspaceId) {
      setPlatformWorkspaceMembers([]);
      return undefined;
    }

    loadPlatformWorkspaceMembers(authToken, selectedPlatformWorkspaceId);
    return undefined;
  }, [authToken, canBootstrapManageFinanceMembers, loadPlatformWorkspaceMembers, realWorkspaceEnabled, selectedPlatformWorkspaceId]);

  const workspaceNotificationTone = useMemo(
    () => getWorkspaceNotificationTone(workspaceNotifications, workspaceNotificationCount),
    [workspaceNotificationCount, workspaceNotifications]
  );
  const {
    handleSelectWorkspace,
    updateThread,
    appendMessage,
    appendBotAlert,
    openThread,
    decrementThreadUnread,
    updateMessage,
    handleSendText,
    handleCreateTaskFromMessage,
    handleCreateProjectFromMessage,
    handleOpenProjectLinkPicker,
    handleCancelProjectLink,
    handleConfirmProjectLink
  } = useWorkspaceNavigationAndThreads({
    authToken,
    activeWorkspaceId,
    markingAllWorkspaceNotificationsRead,
    workspaceNotificationCount,
    pushToast,
    setMarkingAllWorkspaceNotificationsRead,
    setWorkspaceNotifications,
    setWorkspaceNotificationCount,
    setWorkspaceState,
    setActiveWorkspaceId,
    setActiveThreadId,
    setActiveTab,
    setDetailMetric,
    setDraft,
    activeThreadId,
    workspaceState,
    activeThread,
    draft,
    realWorkspaceEnabled,
    loadWorkspaceConversations,
    loadExecutionSummary,
    loadWorkspaceNotifications,
    projectLinkTargetMessage,
    projectLinkSelectedProjectId,
    setProjectLinkTargetMessage,
    setProjectLinkSelectedProjectId,
    setProjectLinkOptions,
    setProjectLinkOptionsLoading,
    setProjectLinkSubmitting,
    buildTaskPayloadFromMessage,
    buildProjectPayloadFromMessage,
    buildConversationSourcePayloadFromMessage,
    upsertWorkspaceConversationThread
  });

  useEffect(() => {
    const alertQueue = [
      {
        threadId: "financebot",
        title: "FinanceBot",
        body: "Budget reached 82% for Operations.",
        message: {
          type: "system",
          content: "Budget reached 82% for Operations. Review pending expense approvals."
        }
      },
      {
        threadId: "warebot",
        title: "WareBot",
        body: "New low stock alert for Packing Sleeves.",
        message: {
          type: "stock_alert",
          content: "Packing Sleeves dropped below the reorder threshold.",
          metadata: {
            alertId: uid("alert"),
            productId: "product-3",
            productName: "Packing Sleeves",
            sku: "PS-312",
            currentStock: 28,
            minimumStock: 40,
            status: "active",
            reorderQuantity: 80
          }
        }
      }
    ].filter((entry) => {
      if (entry.threadId === "financebot") {
        return canAccessWorkspaceScope("finance", effectiveWorkspaceScope);
      }

      if (entry.threadId === "warebot") {
        return canAccessWorkspaceScope("warehouse", effectiveWorkspaceScope);
      }

      return true;
    });

    if (!alertQueue.length) {
      return undefined;
    }

    let index = 0;
    const interval = window.setInterval(() => {
      const next = alertQueue[index % alertQueue.length];
      index += 1;
      appendBotAlert(next.threadId, next.title, next.body, next.message);
    }, 22000);

    return () => window.clearInterval(interval);
  }, [activeThreadId, effectiveWorkspaceScope]);

  const {
    handleSaveFinanceCustomer,
    handleSaveFinanceVendor,
    handleApproveInvoice,
    handleStartRejectInvoice,
    handleRejectReasonChange,
    handleConfirmRejectInvoice,
    handleMarkInvoicePaid,
    handleIssueRecurringInvoice,
    handleReconcileInvoice,
    handleExpenseNoteChange,
    handleLogExpense,
    handleApproveExpense,
    handleStartRejectExpense,
    handleRejectExpenseChange,
    handleConfirmRejectExpense,
    handleStartReimburseExpense,
    handleReimburseExpenseChange,
    handleConfirmReimburseExpense,
    handleReconcileExpense,
    createInvoiceEntry,
    createExpenseEntry,
    handleDownloadInvoicePdf
  } = useWorkspaceFinanceData({
    authToken,
    activeWorkspaceId,
    realFinanceEnabled,
    financePermissions,
    workspaceDefaultCurrency,
    workspaceState,
    activeThread,
    pushToast,
    setWorkspaceState,
    loadRealFinanceState,
    loadRealFinanceActivity,
    updateMessage,
    decrementThreadUnread,
    appendBotAlert,
    setDraft,
    setDownloadingInvoicePdfId
  });

  function handleReorderStart(message) {
    updateMessage("warebot", message.id, (currentMessage) => ({
      ...currentMessage,
      metadata: {
        ...currentMessage.metadata,
        showQuantityInput: true
      }
    }));
  }

  function handleReorderChange(message, value) {
    updateMessage("warebot", message.id, (currentMessage) => ({
      ...currentMessage,
      metadata: {
        ...currentMessage.metadata,
        reorderAmount: value
      }
    }));
  }

  function handleReorderConfirm(message) {
    if (realWarehouseEnabled && message.metadata.productId) {
      const reorderQuantity = Number.parseFloat(message.metadata.reorderAmount || message.metadata.reorderQuantity);
      if (!Number.isFinite(reorderQuantity) || reorderQuantity <= 0) {
        pushToast({
          title: "Reorder quantity required",
          body: "Enter a reorder quantity greater than zero."
        });
        return;
      }

      api.reorderWarehouseProduct(authToken, message.metadata.productId, reorderQuantity, activeWorkspaceId)
        .then((product) => {
          setWorkspaceState((current) =>
            applyRealWarehouseRecords(current, {
              products: current.products
                .filter((entry) => entry.id !== product.id)
                .map(serializeWarehouseProductStateEntry)
                .concat(product),
              orders: current.orders.map(serializeWarehouseOrderStateEntry)
            })
          );
          pushToast({
            title: "Reorder recorded",
            body: `${product.name} was queued for reorder.`
          });
          void loadRealWarehouseState(authToken, {}, activeWorkspaceId);
        })
        .catch((error) => {
          pushToast({
            title: "Unable to confirm reorder",
            body: error.message || "Please try again."
          });
        });
      return;
    }

    updateMessage("warebot", message.id, (currentMessage) => ({
      ...currentMessage,
      metadata: {
        ...currentMessage.metadata,
        showQuantityInput: false,
        status: "resolved"
      }
    }));
    appendBotAlert("warebot", "WareBot", `Reorder placed for ${message.metadata.productName}.`, {
      type: "system",
      content: `Order placed for ${message.metadata.reorderAmount || message.metadata.reorderQuantity} units of ${message.metadata.productName}.`
    });
  }

  function handleDismissStockAlert(message) {
    if (realWarehouseEnabled && message.metadata.productId) {
      api.dismissWarehouseProduct(authToken, message.metadata.productId, activeWorkspaceId)
        .then((product) => {
          setWorkspaceState((current) =>
            applyRealWarehouseRecords(current, {
              products: current.products
                .filter((entry) => entry.id !== product.id)
                .map(serializeWarehouseProductStateEntry)
                .concat(product),
              orders: current.orders.map(serializeWarehouseOrderStateEntry)
            })
          );
          pushToast({
            title: "Alert dismissed",
            body: `${product.name} was dismissed from the active warehouse queue.`
          });
          void loadRealWarehouseState(authToken, {}, activeWorkspaceId);
        })
        .catch((error) => {
          pushToast({
            title: "Unable to dismiss alert",
            body: error.message || "Please try again."
          });
        });
      return;
    }

    updateMessage("warebot", message.id, (currentMessage) => ({
      ...currentMessage,
      metadata: {
        ...currentMessage.metadata,
        status: "dismissed"
      }
    }));
  }

  function handleMarkDelivered(message) {
    if (realWarehouseEnabled && message.metadata.orderId) {
      api.markWarehouseOrderDelivered(authToken, message.metadata.orderId, activeWorkspaceId)
        .then((order) => {
          setWorkspaceState((current) =>
            applyRealWarehouseRecords(current, {
              products: current.products.map(serializeWarehouseProductStateEntry),
              orders: current.orders
                .filter((entry) => entry.id !== order.id)
                .map(serializeWarehouseOrderStateEntry)
                .concat(order)
            })
          );
          pushToast({
            title: "Shipment delivered",
            body: `${order.orderNumber} was marked delivered.`
          });
          void loadRealWarehouseState(authToken, {}, activeWorkspaceId);
        })
        .catch((error) => {
          pushToast({
            title: "Unable to mark shipment delivered",
            body: error.message || "Please try again."
          });
        });
      return;
    }

    updateMessage("warebot", message.id, (currentMessage) => ({
      ...currentMessage,
      metadata: {
        ...currentMessage.metadata,
        currentStep: SHIPMENT_STEPS.length - 1,
        statusLabel: "Delivered"
      }
    }));
    appendBotAlert("warebot", "WareBot", `Shipment ${message.metadata.orderNumber} marked delivered.`, {
      type: "system",
      content: `Order ${message.metadata.orderNumber} delivered to ${message.metadata.destination}.`
    });
    setWorkspaceState((current) => ({
      ...current,
      orders: current.orders.map((order) =>
        order.id === message.metadata.orderId ? { ...order, currentStep: SHIPMENT_STEPS.length - 1, status: "delivered" } : order
      )
    }));
  }

  async function handleUpdateWarehouseOrderStatus(orderOrMessage, nextStatus) {
    const orderId = orderOrMessage?.id || orderOrMessage?.metadata?.orderId;
    const orderNumber = orderOrMessage?.orderNumber || orderOrMessage?.metadata?.orderNumber || "Shipment";
    if (!orderId || !nextStatus) {
      return false;
    }

    if (nextStatus === "delivered" && orderOrMessage?.metadata?.orderId) {
      handleMarkDelivered(orderOrMessage);
      return true;
    }

    if (realWarehouseEnabled) {
      try {
        const order = await api.updateWarehouseOrderStatus(authToken, orderId, { status: nextStatus }, activeWorkspaceId);
        setWorkspaceState((current) =>
          applyRealWarehouseRecords(current, {
            products: current.products.map(serializeWarehouseProductStateEntry),
            orders: current.orders
              .filter((entry) => entry.id !== order.id)
              .map(serializeWarehouseOrderStateEntry)
              .concat(order)
          })
        );
        pushToast({
          title: "Shipment updated",
          body: `${order.orderNumber} is now ${warehouseStatusLabel(order.status).toLowerCase()}.`
        });
        void loadRealWarehouseState(authToken, {}, activeWorkspaceId);
        return true;
      } catch (error) {
        pushToast({
          title: "Unable to update shipment",
          body: error.message || "Please try again."
        });
        return false;
      }
    }

    appendBotAlert("warebot", "WareBot", `${orderNumber} updated.`, {
      type: "system",
      content: `${orderNumber} is now ${warehouseStatusLabel(nextStatus).toLowerCase()}.`
    });
    setWorkspaceState((current) => ({
      ...current,
      orders: current.orders.map((entry) =>
        entry.id === orderId
          ? {
              ...entry,
              status: nextStatus,
              updatedAt: new Date().toISOString()
            }
          : entry
      )
    }));
    return true;
  }

  async function handleAdjustWarehouseStock(product, payload) {
    const quantityDelta = Number.parseFloat(payload?.quantityDelta);
    if (!product?.id || !Number.isFinite(quantityDelta) || quantityDelta === 0) {
      pushToast({
        title: "Stock change required",
        body: "Enter a stock change greater than zero or less than zero."
      });
      return false;
    }

    if (realWarehouseEnabled) {
      try {
        const response = await api.adjustWarehouseProductStock(authToken, product.id, {
          quantityDelta,
          movementType: payload?.movementType || "adjustment",
          note: payload?.note || ""
        }, activeWorkspaceId);
        const updatedProduct = response?.product || response;
        setWorkspaceState((current) =>
          applyRealWarehouseRecords(current, {
            products: current.products
              .filter((entry) => entry.id !== updatedProduct.id)
              .map(serializeWarehouseProductStateEntry)
              .concat(updatedProduct),
            orders: current.orders.map(serializeWarehouseOrderStateEntry)
          })
        );
        pushToast({
          title: "Stock updated",
          body: `${updatedProduct.name} moved by ${formatWarehouseQuantityDelta(quantityDelta, updatedProduct.unit || product.unit || "units")}.`
        });
        void loadRealWarehouseState(authToken, {}, activeWorkspaceId);
        return true;
      } catch (error) {
        pushToast({
          title: "Unable to update stock",
          body: error.message || "Please try again."
        });
        return false;
      }
    }

    const resultingStock = Math.max(0, Number(product.currentStock || 0) + quantityDelta);
    setWorkspaceState((current) => ({
      ...current,
      products: current.products.map((entry) =>
        entry.id === product.id
          ? {
              ...entry,
              currentStock: resultingStock,
              stockGap: Math.max(0, Number(entry.minimumStock || 0) - resultingStock),
              stockSignal: resultingStock < Number(entry.minimumStock || 0) ? "low_stock" : "healthy",
              updatedAt: new Date().toISOString()
            }
          : entry
      )
    }));
    appendBotAlert("warebot", "WareBot", `${product.name} stock changed.`, {
      type: "system",
      content: `${product.name} moved by ${formatWarehouseQuantityDelta(quantityDelta, product.unit || "units")}.`
    });
    return true;
  }

  async function createWarehouseProductEntry({ id = null, name, sku, unitCost, currency, currentStock, minimumStock, reorderThreshold, reorderQuantity }) {
    const resolvedName = String(name || "").trim() || "Unknown item";
    const resolvedSku = String(sku || "").trim().toUpperCase();
    const parsedUnitCost = Number.parseFloat(unitCost ?? 0);
    const resolvedCurrency = normalizeCurrencyCode(currency || workspaceDefaultCurrency || "USD");
    const parsedCurrentStock = Number.parseFloat(currentStock);
    const parsedThreshold = Number.parseFloat(reorderThreshold ?? minimumStock);
    const parsedMinimumStock = Number.parseFloat(minimumStock ?? reorderThreshold);
    const parsedReorderQuantity = Number.parseFloat(reorderQuantity);

    if (!resolvedSku) {
      pushToast({
        title: "SKU required",
        body: "Add a SKU before saving the warehouse alert."
      });
      return false;
    }

    if (!Number.isFinite(parsedCurrentStock) || !Number.isFinite(parsedMinimumStock) || !Number.isFinite(parsedThreshold) || !Number.isFinite(parsedReorderQuantity) || !Number.isFinite(parsedUnitCost)) {
      pushToast({
        title: "Warehouse values required",
        body: "Unit cost, stock, reorder threshold, and reorder quantity must all be valid numbers."
      });
      return false;
    }

    if (!realWarehouseEnabled) {
      appendBotAlert("warebot", "WareBot", `${resolvedName} stock status requested.`, {
        type: "stock_alert",
        content: `${resolvedName} stock status card created.`,
        metadata: {
          alertId: uid("alert"),
          productId: uid("product"),
          productName: resolvedName,
          sku: resolvedSku,
          itemType: "inventory",
          unit: "units",
          currentStock: parsedCurrentStock,
          minimumStock: parsedMinimumStock,
          reorderThreshold: parsedThreshold,
          status: "active",
          productStatus: "active",
          stockSignal: parsedCurrentStock <= parsedThreshold ? "low_stock" : "healthy",
          stockGap: Math.max(0, parsedThreshold - parsedCurrentStock),
          reorderQuantity: parsedReorderQuantity,
          unitCost: parsedUnitCost,
          currency: resolvedCurrency
        }
      });
      setDraft("");
      return true;
    }

    try {
      const payload = {
        name: resolvedName,
        sku: resolvedSku,
        unitCost: parsedUnitCost,
        currency: resolvedCurrency,
        currentStock: parsedCurrentStock,
        minimumStock: parsedMinimumStock,
        reorderThreshold: parsedThreshold,
        reorderQuantity: parsedReorderQuantity
      };
      const product = id
        ? await api.updateWarehouseProduct(authToken, id, payload, activeWorkspaceId)
        : await api.createWarehouseProduct(authToken, payload, activeWorkspaceId);

      setWorkspaceState((current) =>
        applyRealWarehouseRecords(current, {
          products: current.products
            .filter((entry) => entry.id !== product.id)
            .map(serializeWarehouseProductStateEntry)
            .concat(product),
          orders: current.orders.map(serializeWarehouseOrderStateEntry)
        })
      );
      pushToast({
        title: id ? "Warehouse item updated" : "Warehouse alert created",
        body: id ? `${product.name} was updated.` : `${product.name} is now tracked in the warehouse queue.`
      });
      void loadRealWarehouseState(authToken, {}, activeWorkspaceId);
      setDraft("");
      return true;
    } catch (error) {
      pushToast({
        title: "Unable to create warehouse alert",
        body: error.message || "Please try again."
      });
      return false;
    }
  }

  async function createWarehouseOrderEntry({ orderNumber, destination, estimatedDelivery, status = "dispatched", currentStep = 1 }) {
    const resolvedOrderNumber = String(orderNumber || "").replace(/^#/, "").trim().toUpperCase();
    const resolvedDestination = String(destination || "").trim() || "Regional Delivery Hub";
    const resolvedEstimatedDelivery = estimatedDelivery || new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10);

    if (!resolvedOrderNumber) {
      pushToast({
        title: "Order number required",
        body: "Add a shipment number before saving."
      });
      return false;
    }

    if (!realWarehouseEnabled) {
      appendBotAlert("warebot", "WareBot", `Shipment tracking created for ${resolvedOrderNumber}.`, {
        type: "shipment",
        content: `Shipment ${resolvedOrderNumber} created from command.`,
        metadata: {
          orderId: uid("order"),
          orderNumber: resolvedOrderNumber,
          destination: resolvedDestination,
          shipmentType: "outgoing",
          itemsCount: 1,
          steps: SHIPMENT_STEPS,
          currentStep,
          statusLabel: warehouseStatusLabel(status),
          estimatedDelivery: resolvedEstimatedDelivery
        }
      });
      setDraft("");
      return true;
    }

    try {
      const order = await api.createWarehouseOrder(authToken, {
        orderNumber: resolvedOrderNumber,
        destination: resolvedDestination,
        estimatedDelivery: resolvedEstimatedDelivery,
        status,
        currentStep
      }, activeWorkspaceId);

      setWorkspaceState((current) =>
        applyRealWarehouseRecords(current, {
          products: current.products.map(serializeWarehouseProductStateEntry),
          orders: current.orders
            .filter((entry) => entry.id !== order.id)
            .map(serializeWarehouseOrderStateEntry)
            .concat(order)
        })
      );
      pushToast({
        title: "Shipment created",
        body: `${order.orderNumber} is now tracked in WareBot.`
      });
      void loadRealWarehouseState(authToken, {}, activeWorkspaceId);
      setDraft("");
      return true;
    } catch (error) {
      pushToast({
        title: "Unable to create shipment",
        body: error.message || "Please try again."
      });
      return false;
    }
  }

  async function handleSavePurchaseOrder(payload) {
    const normalizedLineItems = Array.isArray(payload?.lineItems)
      ? payload.lineItems
          .map((lineItem) => ({
            itemId: lineItem.itemId || null,
            itemName: String(lineItem.itemName || "").trim(),
            sku: String(lineItem.sku || "").trim().toUpperCase(),
            quantity: Number.parseFloat(lineItem.quantity),
            unitCost: Number.parseFloat(lineItem.unitCost),
            currency: normalizeCurrencyCode(lineItem.currency || payload.currency || workspaceDefaultCurrency || "USD")
          }))
          .filter((lineItem) => lineItem.itemName && Number.isFinite(lineItem.quantity) && lineItem.quantity > 0)
      : [];

    if (!normalizedLineItems.length) {
      pushToast({
        title: "Line items required",
        body: "Add at least one purchase order line item."
      });
      return null;
    }

    const requestPayload = {
      vendorId: payload.vendorId || null,
      vendorName: String(payload.vendorName || "").trim(),
      currency: normalizeCurrencyCode(payload.currency || workspaceDefaultCurrency || "USD"),
      expectedDeliveryDate: payload.expectedDeliveryDate || null,
      notes: String(payload.notes || "").trim(),
      lineItems: normalizedLineItems
    };

    if (realWarehouseEnabled) {
      try {
        const order = payload.id
          ? await api.updatePurchaseOrder(authToken, payload.id, requestPayload, activeWorkspaceId)
          : await api.createPurchaseOrder(authToken, requestPayload, activeWorkspaceId);
        await loadRealWarehouseState(authToken, {}, activeWorkspaceId);
        pushToast({
          title: payload.id ? "Purchase order updated" : "Purchase order created",
          body: `${order.orderNumber} is ready in Warehouse.`
        });
        return order;
      } catch (error) {
        pushToast({
          title: "Unable to save purchase order",
          body: error.message || "Please try again."
        });
        return null;
      }
    }

    const nextOrder = {
      id: payload.id || uid("po"),
      orderNumber: payload.orderNumber || `PO-${new Date().toISOString().slice(0, 7).replace("-", "")}-${Math.floor(Math.random() * 9000 + 1000)}`,
      vendorId: requestPayload.vendorId,
      vendorName: requestPayload.vendorName || "Warehouse vendor",
      status: "draft",
      lineItems: normalizedLineItems.map((lineItem) => ({
        ...lineItem,
        id: uid("po-line"),
        receivedQuantity: 0,
        lineTotal: Number((lineItem.quantity * lineItem.unitCost).toFixed(2))
      })),
      totalAmount: Number(normalizedLineItems.reduce((sum, lineItem) => sum + (lineItem.quantity * lineItem.unitCost), 0).toFixed(2)),
      currency: requestPayload.currency,
      expectedDeliveryDate: requestPayload.expectedDeliveryDate,
      notes: requestPayload.notes,
      sentAt: null,
      receivedAt: null,
      financeExpenseId: null,
      financeExpense: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    setWarehousePurchaseOrders((current) => {
      const remaining = current.filter((entry) => entry.id !== nextOrder.id);
      return [nextOrder, ...remaining];
    });
    pushToast({
      title: payload.id ? "Purchase order updated" : "Purchase order created",
      body: `${nextOrder.orderNumber} is ready in Warehouse.`
    });
    return nextOrder;
  }

  async function handleSendPurchaseOrder(order) {
    if (!order?.id) {
      return null;
    }

    if (realWarehouseEnabled) {
      try {
        const updated = await api.sendPurchaseOrder(authToken, order.id, activeWorkspaceId);
        await loadRealWarehouseState(authToken, {}, activeWorkspaceId);
        pushToast({
          title: "Purchase order sent",
          body: `${updated.orderNumber} is now marked as sent.`
        });
        return updated;
      } catch (error) {
        pushToast({
          title: "Unable to send purchase order",
          body: error.message || "Please try again."
        });
        return null;
      }
    }

    const updated = { ...order, status: "sent", sentAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    setWarehousePurchaseOrders((current) => current.map((entry) => (entry.id === order.id ? updated : entry)));
    return updated;
  }

  async function handleReceivePurchaseOrder(order, lineItems) {
    if (!order?.id) {
      return null;
    }

    const payload = {
      lineItems: (Array.isArray(lineItems) ? lineItems : [])
        .map((entry) => ({
          lineItemId: entry.lineItemId || entry.id,
          receivedQuantity: Number.parseFloat(entry.receivedQuantity)
        }))
        .filter((entry) => Number.isFinite(entry.receivedQuantity) && entry.receivedQuantity > 0)
    };

    if (!payload.lineItems.length) {
      pushToast({
        title: "Receive quantities required",
        body: "Enter at least one received quantity greater than zero."
      });
      return null;
    }

    if (realWarehouseEnabled) {
      try {
        const updated = await api.receivePurchaseOrder(authToken, order.id, payload, activeWorkspaceId);
        await loadRealWarehouseState(authToken, {}, activeWorkspaceId);
        pushToast({
          title: "Purchase order received",
          body: `${updated.orderNumber} is now ${formatPurchaseOrderStatusLabel(updated.status).toLowerCase()}.`
        });
        return updated;
      } catch (error) {
        pushToast({
          title: "Unable to receive purchase order",
          body: error.message || "Please try again."
        });
        return null;
      }
    }

    const lineItemsById = new Map(payload.lineItems.map((entry) => [entry.lineItemId, entry.receivedQuantity]));
    const updatedLineItems = order.lineItems.map((lineItem) => ({
      ...lineItem,
      receivedQuantity: Number(
        (
          Number(lineItem.receivedQuantity || 0) +
          Number(lineItemsById.get(lineItem.id) || 0)
        ).toFixed(2)
      )
    }));
    const allReceived = updatedLineItems.every((lineItem) => Number(lineItem.receivedQuantity || 0) >= Number(lineItem.quantity || 0));
    const updated = {
      ...order,
      lineItems: updatedLineItems,
      status: allReceived ? "received" : "partially_received",
      receivedAt: allReceived ? new Date().toISOString() : null,
      updatedAt: new Date().toISOString()
    };
    setWarehousePurchaseOrders((current) => current.map((entry) => (entry.id === order.id ? updated : entry)));
    return updated;
  }

  async function handleCancelPurchaseOrder(order) {
    if (!order?.id) {
      return null;
    }

    if (realWarehouseEnabled) {
      try {
        const updated = await api.cancelPurchaseOrder(authToken, order.id, activeWorkspaceId);
        await loadRealWarehouseState(authToken, {}, activeWorkspaceId);
        pushToast({
          title: "Purchase order cancelled",
          body: `${updated.orderNumber} was cancelled.`
        });
        return updated;
      } catch (error) {
        pushToast({
          title: "Unable to cancel purchase order",
          body: error.message || "Please try again."
        });
        return null;
      }
    }

    const updated = { ...order, status: "cancelled", updatedAt: new Date().toISOString() };
    setWarehousePurchaseOrders((current) => current.map((entry) => (entry.id === order.id ? updated : entry)));
    return updated;
  }

  const metricCards = useMemo(() => {
    const overdueInvoices = workspaceState.invoices.filter((invoice) => invoice.status === "overdue");
    const approvedOrPaid = workspaceState.invoices.filter((invoice) => ["approved", "partial", "paid"].includes(invoice.status));
    const monthlyExpenses = workspaceState.expenses.reduce((sum, entry) => sum + entry.amount, 0);
    const lowStock = workspaceState.products.filter(isWarehouseLowStock);
    const inTransit = workspaceState.orders.filter((order) => order.status === "in_transit");
    const deliveredToday = workspaceState.orders.filter((order) => order.status === "delivered").length;
    const delayedOrders = workspaceState.orders.filter((order) => order.status === "delayed").length;
    const summary = financeSummary || null;
    const execution = executionSummary || null;
    const outstandingInvoiceCount = summary?.outstandingInvoices ?? approvedOrPaid.length;
    const outstandingAmount = summary?.outstandingAmount ?? approvedOrPaid.reduce((sum, invoice) => sum + (invoice.outstandingAmount ?? invoice.amount), 0);
    const paidInvoiceCount = summary?.paidInvoices ?? workspaceState.invoices.filter((invoice) => invoice.status === "paid").length;
    const paidAmount = summary?.paidAmount ?? workspaceState.invoices
      .filter((invoice) => invoice.status === "paid")
      .reduce((sum, invoice) => sum + (invoice.paidAmount || invoice.amount), 0);
    const overdueCount = summary?.overdueInvoices ?? overdueInvoices.length;
    const overdueAmount = summary?.overdueAmount ?? overdueInvoices.reduce((sum, invoice) => sum + (invoice.outstandingAmount ?? invoice.amount), 0);
    const recurringCount = summary?.recurringInvoices ?? workspaceState.invoices.filter((invoice) => invoice.recurring?.enabled).length;
    const normalizedBaseCurrency = workspaceDefaultCurrency || summary?.workspaceDefaultCurrency || "USD";
    const grossProfitApprox = Number(financeProfitLossReport?.normalizedTotals?.grossProfit || 0);
    const netCashFlowApprox = Number(financeCashFlowReport?.normalizedTotals?.netCashFlow || 0);
    const cashPositionApprox = Number(sumCurrencyBucketInBaseCurrency(summary?.cashPosition?.totals || {}, normalizedBaseCurrency));
    const inventoryValueApprox = Number(sumCurrencyBucketInBaseCurrency(warehouseInventoryValueReport?.totals || {}, normalizedBaseCurrency));

    const financeMetrics = [
      { id: "finance-outstanding", label: "Outstanding Invoices", value: `${outstandingInvoiceCount}`, subvalue: `${formatMoneyDisplay(outstandingAmount)} still open` },
      { id: "finance-paid", label: "Paid Invoices", value: `${paidInvoiceCount}`, subvalue: `${formatMoneyDisplay(paidAmount)} collected` },
      { id: "finance-overdue", label: "Overdue Invoices", value: `${overdueCount}`, subvalue: `${formatMoneyDisplay(overdueAmount)} needs attention` },
      { id: "finance-expenses", label: "Expenses Logged", value: formatMoney(monthlyExpenses), subvalue: recurringCount ? `${recurringCount} recurring invoice${recurringCount === 1 ? "" : "s"} active` : workspaceState.budget.department },
      { id: "finance-gross-profit", label: "Gross Profit", value: `approx. ${formatMoney(grossProfitApprox, normalizedBaseCurrency)}`, subvalue: `${financeProfitLossReport?.period || "month"} view in ${normalizedBaseCurrency}` },
      { id: "finance-cash-flow", label: "Net Cash Flow", value: `approx. ${formatMoney(netCashFlowApprox, normalizedBaseCurrency)}`, subvalue: `${financeCashFlowReport?.period || "month"} cash movement` },
      { id: "finance-cash-position", label: "Cash Position", value: `approx. ${formatMoney(cashPositionApprox, normalizedBaseCurrency)}`, subvalue: summary?.cashPosition?.lastSyncedAt ? `Last synced ${formatDateTime(summary.cashPosition.lastSyncedAt)}` : `${summary?.cashPosition?.accountsCount || financeBankAccounts.length} bank account${Number(summary?.cashPosition?.accountsCount || financeBankAccounts.length) === 1 ? "" : "s"}` }
    ];

    const warehouseMetrics = [
      {
        id: "warehouse-skus",
        label: "Total SKUs Tracked",
        value: `${warehouseSummary?.trackedProducts ?? workspaceState.products.length}`,
        subvalue: warehouseSummary?.productStatusBreakdown
          ? `${warehouseSummary.productStatusBreakdown.active || 0} active products`
          : "Active product catalog"
      },
      {
        id: "warehouse-low-stock",
        label: "Low Stock Items",
        value: `${warehouseSummary?.lowStockItems ?? lowStock.length}`,
        subvalue: warehouseSummary
          ? `${warehouseSummary.reorderAttention ?? lowStock.length} need replenishment · ${warehouseSummary.pendingPurchaseOrders || 0} open PO`
          : `${lowStock.length} need replenishment`
      },
      {
        id: "warehouse-in-transit",
        label: "Orders In Transit",
        value: `${warehouseSummary?.inTransitOrders ?? inTransit.length}`,
        subvalue: warehouseSummary
          ? `${warehouseSummary.incomingShipments || 0} incoming · ${warehouseSummary.outgoingShipments || 0} outgoing`
          : "Currently on the road"
      },
      {
        id: "warehouse-delivered",
        label: "Delivered Today",
        value: `${warehouseSummary?.deliveredOrders ?? deliveredToday}`,
        subvalue: warehouseSummary?.delayedOrders
          ? `${warehouseSummary.delayedOrders} delayed shipment${warehouseSummary.delayedOrders === 1 ? "" : "s"}`
          : "Completed handoffs"
      },
      {
        id: "warehouse-inventory-value",
        label: "Inventory Value",
        value: `approx. ${formatMoney(inventoryValueApprox, normalizedBaseCurrency)}`,
        subvalue: warehouseInventoryValueReport?.totals ? formatMoneyDisplay(warehouseInventoryValueReport.totals) : "Waiting for unit costs"
      }
    ];
    const executionMetrics = [
      {
        id: "execution-overdue",
        label: "Overdue Tasks",
        value: `${execution?.overdueTasks ?? 0}`,
        subvalue: `${execution?.inProgressTasks ?? 0} in progress`
      },
      {
        id: "execution-projects",
        label: "Projects Needing Review",
        value: `${execution?.projectsNeedingAttention ?? 0}`,
        subvalue: `${execution?.activeProjects ?? 0} active project${Number(execution?.activeProjects ?? 0) === 1 ? "" : "s"} tracked`
      }
    ];
    const operationsMetrics = [
      {
        id: "ops-attention",
        label: "Shared Attention",
        value: `${(summary?.dueAttention ?? overdueCount) + (warehouseSummary?.reorderAttention ?? lowStock.length) + (warehouseSummary?.delayedOrders ?? delayedOrders) + (warehouseSummary?.pendingPurchaseOrders ?? 0) + (execution?.executionAttention ?? 0)}`,
        subvalue: `${summary?.outstandingInvoices ?? outstandingInvoiceCount} finance open · ${(warehouseSummary?.reorderAttention ?? lowStock.length) + (warehouseSummary?.pendingPurchaseOrders ?? 0)} warehouse needs · ${execution?.executionAttention ?? 0} execution`
      }
    ];

    if (effectiveWorkspaceScope === "finance") {
      return financeMetrics;
    }

    if (effectiveWorkspaceScope === "warehouse") {
      return warehouseMetrics;
    }

    if (userRole === "owner" || userRole === "manager") {
      return effectiveWorkspaceScope === "both"
        ? [...operationsMetrics, ...financeMetrics, ...warehouseMetrics, ...executionMetrics]
        : [...financeMetrics, ...warehouseMetrics, ...executionMetrics];
    }

    if (activeThread?.botType === "warehouse") {
      return warehouseMetrics;
    }

    return financeMetrics;
  }, [activeThread?.botType, effectiveWorkspaceScope, executionSummary, financeBankAccounts.length, financeCashFlowReport, financeProfitLossReport, financeSummary, userRole, warehouseInventoryValueReport, warehouseSummary, workspaceDefaultCurrency, workspaceState]);

  const {
    handleMarkAllWorkspaceNotificationsRead,
    handleOverviewNavigate,
    handleOpenWorkspaceNotification,
    runCommand
  } = useWorkspaceNavigationActions({
    authToken,
    activeWorkspaceId,
    markingAllWorkspaceNotificationsRead,
    workspaceNotificationCount,
    pushToast,
    setMarkingAllWorkspaceNotificationsRead,
    setWorkspaceNotifications,
    setWorkspaceNotificationCount,
    setDetailMetric,
    setActiveNav,
    setActiveTab,
    setDraft,
    effectiveWorkspaceScope,
    financePermissions,
    workspaceState,
    financeSummary,
    financeProfitLossReport,
    financeCashFlowReport,
    warehouseInventoryValueReport,
    workspaceDefaultCurrency,
    warehouseSummary,
    executionSummary,
    userRole,
    financeBankAccounts,
    activeThread,
    openThread,
    metricCards,
    appendMessage,
    createInvoiceEntry,
    createExpenseEntry,
    createWarehouseProductEntry,
    createWarehouseOrderEntry
  });

  const financeCustomerSuggestions = useMemo(() => {
    const values = [
      ...financeCustomers.filter((customer) => customer.status !== "inactive").map((customer) => customer.name || ""),
      ...workspaceState.invoices.map((invoice) => invoice.companyName || "")
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean);

    return [...new Set(values)].slice(0, 6);
  }, [financeCustomers, workspaceState.invoices]);

  const financeVendorSuggestions = useMemo(() => {
    const values = [
      ...financeVendors.filter((vendor) => vendor.status !== "inactive").map((vendor) => vendor.name || ""),
      ...workspaceState.expenses.map((expense) => expense.vendorName || "")
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean);

    return [...new Set(values)].slice(0, 6);
  }, [financeVendors, workspaceState.expenses]);

  const financeCategorySuggestions = useMemo(() => {
    const values = workspaceState.expenses
      .map((expense) => String(expense.category || "").trim().toLowerCase())
      .filter(Boolean);

    const defaults = ["supplies", "travel", "utilities", "marketing", "other"];
    return [...new Set([...values, ...defaults])].slice(0, 6);
  }, [workspaceState.expenses]);

  const threadContextValue = useMemo(
    () => ({
      threads: workspaceState.threads,
      currentUser: workspaceState.currentUser
    }),
    [workspaceState.currentUser, workspaceState.threads]
  );

  const unreadValue = useMemo(() => ({ totalUnread }), [totalUnread]);
  const notificationValue = useMemo(
    () => ({ toasts, dismissToast, pushToast }),
    [dismissToast, pushToast, toasts]
  );
  const { resolveReactionUserName, handleReact } = useMessageInteractionState({
    workspaceState,
    workspaceMode,
    activePicker,
    setActivePicker,
    setReactions,
    seededReactionsRef
  });

  const financeMode = isFinanceMode(activeThread, activeNav);

  return (
    <ThreadListContext.Provider value={threadContextValue}>
      <UnreadContext.Provider value={unreadValue}>
        <NotificationContext.Provider value={notificationValue}>
          <div
            className={embedded ? "h-full min-h-0 w-full min-w-0 text-slate-900" : "min-h-screen p-5 text-slate-900"}
            style={{
              fontFamily: '"Manrope","DM Sans","Outfit","Segoe UI",sans-serif',
              background: financeMode
                ? "radial-gradient(circle at top,#10221d 0%, #080d16 28%, #0a0f1a 100%)"
                : "#EEF3FA"
            }}
          >
            <NotificationToasts onOpenThread={openThread} />
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className={
                embedded
                  ? "flex h-full min-h-0 w-full min-w-0 overflow-hidden"
                  : "mx-auto flex min-h-[calc(100vh-40px)] max-w-[1520px] overflow-hidden"
              }
              style={
                financeMode
                  ? {
                      borderRadius: embedded ? 0 : 28,
                      border: embedded ? "none" : "1px solid rgba(255,255,255,0.06)",
                      background: "#0a0f1a",
                      boxShadow: embedded ? "none" : "0 30px 90px rgba(0,0,0,0.45)"
                    }
                  : {
                      borderRadius: embedded ? 0 : 24,
                      border: embedded ? "none" : "1px solid #e2e8f0",
                      background: "#fff",
                      boxShadow: embedded ? "none" : "0 30px 80px rgba(15,23,42,0.08)"
                    }
              }
            >
              {hideSidebar ? null : (
                <Sidebar
                  activeNav={activeNav}
                  onNavChange={(nav) => {
                    setActiveNav(nav);
                    if (nav === "finances" && canSeeBot("finance", userRole) && canAccessWorkspaceScope("finance", effectiveWorkspaceScope)) {
                      openThread("financebot");
                    }
                    if (nav === "warehouse" && canSeeBot("warehouse", userRole) && canAccessWorkspaceScope("warehouse", effectiveWorkspaceScope)) {
                      openThread("warebot");
                    }
                    if (nav === "inbox" && visibleThreads[0]) {
                  openThread(visibleThreads[0].id);
                    }
                  }}
                  currentUser={sidebarCurrentUser}
                  settings={workspaceState.settings}
                  financeMode={financeMode}
                  workspaceScope={effectiveWorkspaceScope}
                  onToggleSound={() =>
                    setWorkspaceState((current) => ({
                      ...current,
                      settings: { ...current.settings, soundEnabled: !current.settings.soundEnabled }
                    }))
                  }
                />
              )}

              <ThreadListPanel
                role={userRole}
                activeNav={activeNav}
                activeThreadId={activeThread?.id}
                onOpenThread={openThread}
                filter={filter}
                onFilterChange={setFilter}
                search={search}
                onSearchChange={setSearch}
                financeMode={financeMode}
                workspaceScope={effectiveWorkspaceScope}
                workspaceMode={workspaceMode}
              />

              {activeThread ? (
                <WorkspacePane
                  role={userRole}
                  activeNav={activeNav}
                  activeThread={activeThread}
                  activeTab={activeTab}
                  setActiveTab={setActiveTab}
                  draft={draft}
                  setDraft={setDraft}
                  reactions={reactions}
                  activePicker={activePicker}
                  setActivePicker={setActivePicker}
                  onReact={handleReact}
                  resolveReactionUserName={resolveReactionUserName}
                  onSendText={handleSendText}
                  onRunCommand={runCommand}
                  onSelectMetric={setDetailMetric}
                  metricCards={metricCards}
                  financeActivity={financeActivity}
                  detailMetric={detailMetric}
                  setDetailMetric={setDetailMetric}
                  financeMode={financeMode}
                  onCloseWorkspace={onCloseWorkspace}
                  onUpgradeToRealWorkspace={onUpgradeToRealWorkspace}
                  onWorkspaceLogout={onWorkspaceLogout}
                  onRefreshFinanceData={(options = {}) =>
                    loadRealFinanceState(authToken, { ...options, toastOnSuccess: options.toastOnSuccess ?? true })
                  }
                  onLoadAccountingAccountDrilldown={loadFinanceAccountDrilldown}
                  onExportAccountingStatement={loadFinanceStatementExport}
                  onExportAccountingJournals={loadFinanceJournalExport}
                  onLockFinancePeriod={lockFinancePeriod}
                  onUnlockFinancePeriod={unlockFinancePeriod}
                  onCreateInvoice={createInvoiceEntry}
                  onCreateExpense={createExpenseEntry}
                  onLoadWarehouseProductMovementReview={realWarehouseEnabled ? loadWarehouseProductMovementReview : null}
                  onLoadWarehouseOrderReview={realWarehouseEnabled ? loadWarehouseOrderReview : null}
                  financeCustomers={financeCustomers}
                  financeVendors={financeVendors}
                  customerSuggestions={financeCustomerSuggestions}
                  vendorSuggestions={financeVendorSuggestions}
                  categorySuggestions={financeCategorySuggestions}
                  onSaveFinanceCustomer={handleSaveFinanceCustomer}
                  onSaveFinanceVendor={handleSaveFinanceVendor}
                  workspaceAccessMode={workspaceMode}
                  workspaceScope={effectiveWorkspaceScope}
                  activeWorkspace={activeWorkspace}
                  financeWorkspaces={financeWorkspaces}
                  financeWorkspacesLoading={financeWorkspacesLoading}
                  financeSummary={financeSummary}
                  financeFxRates={financeFxRates}
                  financeTaxSummary={financeTaxSummary}
                  financeProfitLossReport={financeProfitLossReport}
                  financeCashFlowReport={financeCashFlowReport}
                  financeAgedReceivablesReport={financeAgedReceivablesReport}
                  financeBalanceSheetReport={financeBalanceSheetReport}
                  financePayrollRecords={financePayrollRecords}
                  financeAccountantSummary={financeAccountantSummary}
                  financeBankAccounts={financeBankAccounts}
                  financeBankTransactions={financeBankTransactions}
                  warehouseSummary={warehouseSummary}
                  warehouseInventoryValueReport={warehouseInventoryValueReport}
                  executionSummary={executionSummary}
                  overviewPressure={overviewPressure}
                  warehouseProducts={workspaceState.products}
                  warehouseOrders={workspaceState.orders}
                  activeWorkspaceMembership={activeWorkspaceMembership}
                  workspaceSettings={workspaceSettings}
                  workspaceSettingsLoading={workspaceSettingsLoading}
                  onSelectWorkspace={handleSelectWorkspace}
                  platformWorkspaces={platformWorkspaces}
                  platformWorkspacesLoading={platformWorkspacesLoading}
                  selectedPlatformWorkspace={selectedPlatformWorkspace}
                  selectedPlatformWorkspaceId={selectedPlatformWorkspaceId}
                  platformWorkspaceMembers={platformWorkspaceMembers}
                  platformWorkspaceMembersLoading={platformWorkspaceMembersLoading}
                  platformCreatingWorkspace={platformCreatingWorkspace}
                  platformProvisioningMember={platformProvisioningMember}
                  platformSavingMemberId={platformSavingMemberId}
                  onSelectPlatformWorkspace={setSelectedPlatformWorkspaceId}
                  onRefreshPlatformWorkspaces={() => loadPlatformWorkspaces(authToken)}
                  onRefreshPlatformWorkspaceMembers={() => loadPlatformWorkspaceMembers(authToken, selectedPlatformWorkspaceId || undefined)}
                  onCreatePlatformWorkspace={handleCreatePlatformWorkspace}
                  onProvisionPlatformMember={handleProvisionPlatformWorkspaceMember}
                  financePermissions={financePermissions}
                  financeMembers={financeMembers}
                  financeMembersLoading={financeMembersLoading}
                  savingFinanceMemberId={savingFinanceMemberId}
                  canManageFinanceMembers={canManageFinanceMembers}
                  canBootstrapManageFinanceMembers={canBootstrapManageFinanceMembers}
                  onToggleFinanceMemberRole={handleToggleFinanceMemberRole}
                  onUpdateFinanceMemberAccess={handleUpdateFinanceMemberAccess}
                  onRefreshFinanceMembers={() => loadFinanceMembers(authToken)}
                  onRefreshWorkspaceSettings={() => loadWorkspaceSettings(authToken, activeWorkspaceId || undefined, { toastOnSuccess: true })}
                  onEnableWorkspaceAccounting={() => enableWorkspaceAccounting(authToken, activeWorkspaceId || undefined)}
                  workspaceAccountingEnabling={workspaceAccountingEnabling}
                  onUpdateWorkspaceDefaultCurrency={(currency) => updateWorkspaceDefaultCurrency(currency, authToken, activeWorkspaceId || undefined)}
                  workspaceDefaultCurrencySaving={workspaceDefaultCurrencySaving}
                  workspaceDefaultCurrency={workspaceDefaultCurrency}
                  onTogglePlatformFinanceRole={handleTogglePlatformFinanceRole}
                  onUpdatePlatformMemberAccess={handleUpdatePlatformMemberAccess}
                  onOpenPersonalChat={onOpenPersonalChat}
                  onLoadFinanceTaxSummary={loadFinanceTaxSummary}
                  onLoadFinanceProfitLossReport={loadFinanceProfitLossReport}
                  onLoadFinanceCashFlowReport={loadFinanceCashFlowReport}
                  onLoadFinanceAgedReceivablesReport={loadFinanceAgedReceivablesReport}
                  onLoadFinanceBalanceSheetReport={loadFinanceBalanceSheetReport}
                  onLoadFinanceFxRates={loadFinanceFxRates}
                  onLoadFinanceInvoiceDetail={loadFinanceInvoiceDetail}
                  onLoadFinanceExpenseDetail={loadFinanceExpenseDetail}
                  onCreateBankAccount={handleCreateBankAccount}
                  onCreatePlaidBankAccount={handleConnectPlaidBankAccount}
                  onUpdateBankAccount={handleUpdateBankAccount}
                  onDeleteBankAccount={handleDeleteBankAccount}
                  onCreateBankTransaction={handleCreateBankTransaction}
                  onSyncBankTransactions={handleSyncBankTransactions}
                  onSyncPlaidAccount={handleSyncPlaidAccount}
                  onRefreshPlaidBalance={handleRefreshPlaidBalance}
                  onAutoMatchBankTransactions={handleAutoMatchBankTransactions}
                  onMatchBankTransactionExpense={handleMatchBankTransactionExpense}
                  onMatchBankTransactionPayment={handleMatchBankTransactionPayment}
                  onReconcileBankTransaction={handleReconcileBankTransaction}
                  onReconcileMatchedBankTransactions={handleReconcileMatchedBankTransactions}
                  onCreatePayrollRecord={handleCreatePayrollRecord}
                  onApprovePayrollRecord={handleApprovePayrollRecord}
                  onPayPayrollRecord={handlePayPayrollRecord}
                  onCancelPayrollRecord={handleCancelPayrollRecord}
                  onNavigateOverview={handleOverviewNavigate}
                  onCreateTaskFromMessage={handleCreateTaskFromMessage}
                  onCreateProjectFromMessage={handleCreateProjectFromMessage}
                  projectLinkTargetMessage={projectLinkTargetMessage}
                  projectLinkSelectedProjectId={projectLinkSelectedProjectId}
                  projectLinkOptions={projectLinkOptions}
                  projectLinkOptionsLoading={projectLinkOptionsLoading}
                  projectLinkSubmitting={projectLinkSubmitting}
                  onSelectProjectLink={setProjectLinkSelectedProjectId}
                  onAttachProjectMessage={handleOpenProjectLinkPicker}
                  onConfirmProjectLink={handleConfirmProjectLink}
                  onCancelProjectLink={handleCancelProjectLink}
                  workspaceNotifications={workspaceNotifications}
                  workspaceNotificationCount={workspaceNotificationCount}
                  workspaceNotificationsLoading={workspaceNotificationsLoading}
                  notificationTone={workspaceNotificationTone}
                  onRefreshWorkspaceNotifications={() => loadWorkspaceNotifications(authToken, activeWorkspaceId || undefined, { toastOnError: false })}
                  onOpenWorkspaceNotification={handleOpenWorkspaceNotification}
                  onMarkAllWorkspaceNotificationsRead={handleMarkAllWorkspaceNotificationsRead}
                  markingAllWorkspaceNotificationsRead={markingAllWorkspaceNotificationsRead}
                  onInviteAccountant={handleInviteAccountant}
                  invitingAccountant={invitingAccountant}
                  handlers={{
                    onApproveInvoice: handleApproveInvoice,
                    onStartRejectInvoice: handleStartRejectInvoice,
                    onRejectReasonChange: handleRejectReasonChange,
                    onConfirmRejectInvoice: handleConfirmRejectInvoice,
                    onMarkPaidInvoice: handleMarkInvoicePaid,
                    onDownloadInvoicePdf: handleDownloadInvoicePdf,
                    downloadingInvoicePdfId,
                    onIssueRecurringInvoice: handleIssueRecurringInvoice,
                    onReconcileInvoice: handleReconcileInvoice,
                    onReorderStart: handleReorderStart,
                    onReorderChange: handleReorderChange,
                    onReorderConfirm: handleReorderConfirm,
                    onDismissStockAlert: handleDismissStockAlert,
                    onMarkDelivered: handleMarkDelivered,
                    onUpdateWarehouseOrderStatus: handleUpdateWarehouseOrderStatus,
                    onAdjustWarehouseStock: handleAdjustWarehouseStock,
                    onExpenseNoteChange: handleExpenseNoteChange,
                    onLogExpense: handleLogExpense,
                    onApproveExpense: handleApproveExpense,
                    onStartRejectExpense: handleStartRejectExpense,
                    onRejectExpenseChange: handleRejectExpenseChange,
                    onConfirmRejectExpense: handleConfirmRejectExpense,
                    onStartReimburseExpense: handleStartReimburseExpense,
                    onReimburseExpenseChange: handleReimburseExpenseChange,
                    onConfirmReimburseExpense: handleConfirmReimburseExpense,
                    onReconcileExpense: handleReconcileExpense
                  }}
                />
              ) : null}
            </motion.div>
          </div>
        </NotificationContext.Provider>
      </UnreadContext.Provider>
    </ThreadListContext.Provider>
  );
}
