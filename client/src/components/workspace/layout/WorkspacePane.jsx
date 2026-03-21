import { AnimatePresence } from "framer-motion";
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";

import { FILTER_TABS, FINANCE_MEDIA_SECTIONS } from "../WorkspaceMessenger.constants.js";
import { avatarForThread, buildNotificationToneStyles, displayTabLabel, downloadCsvFile, financeGuardrailMessage, formatAccountingPeriodLabel, formatAccountingReportVariantLabel, formatDate, formatMoney, formatPaymentMethod, formatPeriodKeyLabel, isWithinReportingWindow, isWorkspaceBotMode, metricDescription, parseFinanceHashRoute, readFileAsDataUrl, resolveFinanceAccountingState, sanitizeDownloadPart, todayDateInputValue, updateFinanceHashRoute, useNotifications, useThreadList, visibleCommandItems } from "../WorkspaceMessenger.utils.js";
import Sidebar from "./Sidebar.jsx";
import ThreadListPanel from "./ThreadListPanel.jsx";
import WorkspaceNotificationMenu from "../menus/WorkspaceNotificationMenu.jsx";
import QuickActionMenu from "../menus/QuickActionMenu.jsx";
import ToolbarOverflowMenu from "../menus/ToolbarOverflowMenu.jsx";
import FinanceEntryModal from "../finance/FinanceEntryModal.jsx";
import InvoicePaymentModal from "../finance/InvoicePaymentModal.jsx";
import FinanceBankingPanel from "../finance/FinanceBankingPanel.jsx";
import { FinanceActivityFeed, FinanceFilterToolbar, FinanceHeroStrip, FinanceOperationalInsights, FinanceQueueSummary, FinanceRecordDigest, FinanceRelationshipSummary, FinanceReportingSnapshot, buildFinanceApprovalSections, buildFinanceQueueSummary } from "../finance/FinanceSummaryPanels.jsx";
import { FinanceExpenseDetailPanel, FinanceInvoiceDetailPanel } from "../finance/FinanceDetailPanels.jsx";
import FinanceAdvancedReportsPanel from "../finance/FinanceAdvancedReportsPanel.jsx";
import FinanceContactManagerPanel from "../finance/FinanceContactManagerPanel.jsx";
import FinancePayrollPanel from "../finance/FinancePayrollPanel.jsx";
import FinanceAccountantPortalPanel from "../finance/FinanceAccountantPortalPanel.jsx";
import WarehouseAnalyticsPanel from "../warehouse/WarehousePanels.jsx";
import { MessageBubble, NotificationToasts } from "../messages/MessageInteraction.jsx";
import { PlatformOwnerProvisioningPanel, WorkspaceAdminOverviewPanel, WorkspaceMemberAccessPanel } from "../admin/WorkspaceAdminPanels.jsx";
import WorkspaceOverviewPanel from "../overview/WorkspaceOverviewPanel.jsx";

const FinanceAccountingAnalytics = lazy(() => import("../../finance/FinanceAccountingAnalytics.jsx"));

function CommandMenu({ items, activeIndex, onHoverItem, onInsertCommand }) {
  return (
    <div className="absolute bottom-full left-0 mb-3 w-full rounded-2xl border border-white/10 bg-[rgba(20,12,35,0.97)] p-2 shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-xl">
      {items.map((item, index) => (
        <button
          key={item.command}
          type="button"
          onMouseEnter={() => onHoverItem(index)}
          onClick={() => onInsertCommand(item.command)}
          className={`flex w-full flex-col items-start rounded-xl px-3 py-3 text-left transition ${
            activeIndex === index ? "bg-white/10" : "hover:bg-white/8"
          }`}
        >
          <p className="text-sm font-bold text-white">{item.command}</p>
          <p className="mt-1 text-xs text-slate-300">{item.description}</p>
          <p className="mt-2 text-[11px] text-slate-400">{item.example}</p>
        </button>
      ))}
    </div>
  );
}

function HeaderAction({ children, onClick, financeMode = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border px-3 py-1.5 text-xs font-semibold transition hover:-translate-y-0.5"
      style={{
        borderColor: financeMode ? "rgba(255,255,255,0.12)" : "rgba(15,23,42,0.08)",
        background: financeMode ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.72)",
        color: financeMode ? "#e2e8f0" : "#0f172a"
      }}
    >
      {children}
    </button>
  );
}

function WorkspaceEmptyThreadState({ activeThread, financeMode }) {
  const isBot = Boolean(activeThread?.isBot);
  const isFinanceBot = activeThread?.botType === "finance" || activeThread?.id === "financebot";
  const isWarehouseBot = activeThread?.botType === "warehouse" || activeThread?.id === "warebot";

  let title = "Conversation ready";
  let body = "This thread is ready for the first message.";

  if (isFinanceBot) {
    title = "No finance records yet";
    body = "Create an invoice or log an expense to start the FinanceBot workflow in this workspace.";
  } else if (isWarehouseBot) {
    title = "No warehouse records yet";
    body = "Create a stock alert or shipment to start the WareBot workflow in this workspace.";
  } else if (!isBot) {
    title = `No messages with ${activeThread?.name || "this member"} yet`;
    body = "Send the first workspace message here. Personal chat stays separate from this workspace thread.";
  }

  return (
    <div
      className="grid min-h-[320px] place-items-center rounded-[24px] px-6 py-12 text-center"
      style={
        financeMode
          ? {
              border: "1px solid rgba(255,255,255,0.08)",
              background: "linear-gradient(180deg,#111827 0%,#10192a 100%)"
            }
          : {
              border: "1px solid #e2e8f0",
              background: "#ffffff",
              boxShadow: "0 8px 30px rgba(15,23,42,0.06)"
            }
      }
    >
      <div className="max-w-[460px]">
        <div
          className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl text-2xl ${
            financeMode ? "bg-white/5 text-slate-100" : "bg-slate-100 text-slate-600"
          }`}
        >
          {isFinanceBot ? "💰" : isWarehouseBot ? "📦" : "💬"}
        </div>
        <h4 className={`mt-5 text-xl font-bold ${financeMode ? "text-white" : "text-slate-900"}`}>{title}</h4>
        <p className={`mt-2 text-sm leading-6 ${financeMode ? "text-slate-400" : "text-slate-500"}`}>{body}</p>
      </div>
    </div>
  );
}

export default function WorkspacePane({
  role,
  activeNav,
  activeThread,
  activeTab,
  setActiveTab,
  draft,
  setDraft,
  reactions,
  activePicker,
  setActivePicker,
  onReact,
  resolveReactionUserName,
  onSendText,
  onRunCommand,
  onSelectMetric,
  metricCards,
  financeActivity,
  detailMetric,
  setDetailMetric,
  handlers,
  financeMode,
  onCloseWorkspace,
  onUpgradeToRealWorkspace,
  onWorkspaceLogout,
  onRefreshFinanceData,
  onLoadAccountingAccountDrilldown = null,
  onExportAccountingStatement = null,
  onExportAccountingJournals = null,
  onLockFinancePeriod = null,
  onUnlockFinancePeriod = null,
  onCreateInvoice,
  onCreateExpense,
  onLoadWarehouseProductMovementReview = null,
  onLoadWarehouseOrderReview = null,
  financeCustomers = [],
  financeVendors = [],
  customerSuggestions = [],
  vendorSuggestions = [],
  categorySuggestions = [],
  onSaveFinanceCustomer = null,
  onSaveFinanceVendor = null,
  workspaceAccessMode = "demo",
  workspaceScope = "both",
  activeWorkspace = null,
  financeWorkspaces = [],
  financeWorkspacesLoading = false,
  financeSummary = null,
  financeFxRates = null,
  financeTaxSummary = null,
  financeProfitLossReport = null,
  financeCashFlowReport = null,
  financeAgedReceivablesReport = null,
  financeBalanceSheetReport = null,
  financePayrollRecords = [],
  financeAccountantSummary = null,
  financeBankAccounts = [],
  financeBankTransactions = {},
  warehouseSummary = null,
  warehouseInventoryValueReport = null,
  executionSummary = null,
  overviewPressure = null,
  warehouseProducts = [],
  warehouseOrders = [],
  activeWorkspaceMembership = null,
  workspaceSettings = null,
  workspaceSettingsLoading = false,
  onSelectWorkspace = null,
  platformWorkspaces = [],
  platformWorkspacesLoading = false,
  selectedPlatformWorkspace = null,
  selectedPlatformWorkspaceId = null,
  platformWorkspaceMembers = [],
  platformWorkspaceMembersLoading = false,
  platformCreatingWorkspace = false,
  platformProvisioningMember = false,
  platformSavingMemberId = null,
  onSelectPlatformWorkspace = null,
  onRefreshPlatformWorkspaces = null,
  onRefreshPlatformWorkspaceMembers = null,
  onCreatePlatformWorkspace = null,
  onProvisionPlatformMember = null,
  financePermissions,
  financeMembers = [],
  financeMembersLoading = false,
  savingFinanceMemberId = null,
  canManageFinanceMembers = false,
  canBootstrapManageFinanceMembers = false,
  onToggleFinanceMemberRole,
  onUpdateFinanceMemberAccess,
  onRefreshFinanceMembers,
  onRefreshWorkspaceSettings,
  onEnableWorkspaceAccounting = null,
  workspaceAccountingEnabling = false,
  onUpdateWorkspaceDefaultCurrency = null,
  workspaceDefaultCurrencySaving = false,
  workspaceDefaultCurrency = "USD",
  onTogglePlatformFinanceRole = null,
  onUpdatePlatformMemberAccess = null,
  onOpenPersonalChat = null,
  onLoadFinanceTaxSummary = null,
  onLoadFinanceProfitLossReport = null,
  onLoadFinanceCashFlowReport = null,
  onLoadFinanceAgedReceivablesReport = null,
  onLoadFinanceBalanceSheetReport = null,
  onLoadFinanceFxRates = null,
  onLoadFinanceInvoiceDetail = null,
  onLoadFinanceExpenseDetail = null,
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
  onReconcileMatchedBankTransactions = null,
  onCreatePayrollRecord = null,
  onApprovePayrollRecord = null,
  onPayPayrollRecord = null,
  onCancelPayrollRecord = null,
  onNavigateOverview = null,
  onCreateTaskFromMessage = null,
  onCreateProjectFromMessage = null,
  projectLinkTargetMessage = null,
  projectLinkSelectedProjectId = "",
  projectLinkOptions = [],
  projectLinkOptionsLoading = false,
  projectLinkSubmitting = false,
  onSelectProjectLink = null,
  onAttachProjectMessage = null,
  onConfirmProjectLink = null,
  onCancelProjectLink = null,
  workspaceNotifications = [],
  workspaceNotificationCount = 0,
  workspaceNotificationsLoading = false,
  notificationTone = "neutral",
  onRefreshWorkspaceNotifications = null,
  onOpenWorkspaceNotification = null,
  onMarkAllWorkspaceNotificationsRead = null,
  markingAllWorkspaceNotificationsRead = false,
  onInviteAccountant = null,
  invitingAccountant = false
}) {
  const currentUser = useThreadList().currentUser;
  const notifications = useNotifications();
  const pushToast = notifications?.pushToast || (() => {});
  const inputRef = useRef(null);
  const quickActionMenuRef = useRef(null);
  const toolbarOverflowMenuRef = useRef(null);
  const notificationMenuRef = useRef(null);
  const [commandMenuDismissed, setCommandMenuDismissed] = useState(false);
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const [showRealWorkspaceConfirm, setShowRealWorkspaceConfirm] = useState(false);
  const [showQuickActionMenu, setShowQuickActionMenu] = useState(false);
  const [showToolbarOverflowMenu, setShowToolbarOverflowMenu] = useState(false);
  const [showNotificationMenu, setShowNotificationMenu] = useState(false);
  const [financeEntryModal, setFinanceEntryModal] = useState(null);
  const [financeEntryValues, setFinanceEntryValues] = useState({});
  const [isFinanceEntrySubmitting, setIsFinanceEntrySubmitting] = useState(false);
  const [financeEntryContext, setFinanceEntryContext] = useState(null);
  const [financeContactSavingKind, setFinanceContactSavingKind] = useState(null);
  const [paymentEntry, setPaymentEntry] = useState(null);
  const [paymentEntryValues, setPaymentEntryValues] = useState({ amount: "", method: "bank_transfer", reference: "", note: "" });
  const [isPaymentSubmitting, setIsPaymentSubmitting] = useState(false);
  const [invoiceFilter, setInvoiceFilter] = useState({ customerId: "", status: "" });
  const [expenseFilter, setExpenseFilter] = useState({ vendorId: "", status: "" });
  const [reportingWindow, setReportingWindow] = useState("all");
  const [issuingRecurringInvoiceId, setIssuingRecurringInvoiceId] = useState(null);
  const [downloadingInvoicePdfId, setDownloadingInvoicePdfId] = useState(null);
  const [selectedAccountingAccountCode, setSelectedAccountingAccountCode] = useState("");
  const [accountDrilldown, setAccountDrilldown] = useState(null);
  const [accountDrilldownLoading, setAccountDrilldownLoading] = useState(false);
  const [accountingExporting, setAccountingExporting] = useState("");
  const [selectedLockPeriodKey, setSelectedLockPeriodKey] = useState("");
  const [financeControlAction, setFinanceControlAction] = useState("");
  const [financeSection, setFinanceSection] = useState("reports");
  const [selectedFinanceRecord, setSelectedFinanceRecord] = useState(null);
  const [selectedFinanceRecordDetail, setSelectedFinanceRecordDetail] = useState(null);
  const [selectedFinanceRecordLoading, setSelectedFinanceRecordLoading] = useState(false);
  const [financeHashRoute, setFinanceHashRoute] = useState(() => parseFinanceHashRoute());
  const accountingPeriodSyncRef = useRef("all");
  const commandItems = useMemo(
    () => visibleCommandItems(role, draft, workspaceScope, financePermissions),
    [role, draft, workspaceScope, financePermissions]
  );
  const showCommandMenu = draft.startsWith("/") && !commandMenuDismissed && commandItems.length > 0;
  const warehouseMetricCards = useMemo(
    () => metricCards.filter((metric) => metric.id.startsWith("warehouse-")),
    [metricCards]
  );
  const financeMetricCards = useMemo(
    () => metricCards.filter((metric) => metric.id.startsWith("finance-") || metric.id.startsWith("ops-")),
    [metricCards]
  );
  const financeApprovalSections = useMemo(
    () => (financeMode ? buildFinanceApprovalSections(activeThread.messages) : []),
    [activeThread.messages, financeMode]
  );
  const financeQueueSummary = useMemo(
    () => (financeMode ? buildFinanceQueueSummary(activeThread.messages) : null),
    [activeThread.messages, financeMode]
  );
  const financeApprovalCount = useMemo(
    () => financeApprovalSections.reduce((total, section) => total + section.items.length, 0),
    [financeApprovalSections]
  );
  const canCreateLinkedWorkFromThread = Boolean(
    workspaceAccessMode === "real" &&
      activeThread?.isWorkspaceConversation &&
      !activeThread?.isBot &&
      activeThread?.conversationId &&
      onCreateTaskFromMessage &&
      onCreateProjectFromMessage
  );
  const linkedWorkMessages = useMemo(
    () =>
      (Array.isArray(activeThread?.messages) ? activeThread.messages : [])
        .filter((message) => message.type === "system" && message.metadata?.linkedWork)
        .map((message) => ({
          id: message.id,
          createdAt: message.createdAt,
          ...message.metadata.linkedWork
        })),
    [activeThread?.messages]
  );
  const linkedWorkSummary = useMemo(() => {
    const taskCount = linkedWorkMessages.filter((entry) => entry.kind === "task").length;
    const projectCount = linkedWorkMessages.filter((entry) => entry.kind === "project").length;

    return {
      taskCount,
      projectCount,
      recent: linkedWorkMessages.slice(-3).reverse()
    };
  }, [linkedWorkMessages]);
  const projectLinkTargetExcerpt = useMemo(
    () => buildLinkedWorkExcerpt(projectLinkTargetMessage),
    [projectLinkTargetMessage]
  );
  const financeInvoiceMessages = useMemo(
    () => (financeMode ? activeThread.messages.filter((message) => message.type === "invoice") : []),
    [activeThread.messages, financeMode]
  );
  const financeExpenseMessages = useMemo(
    () => (financeMode ? activeThread.messages.filter((message) => message.type === "expense") : []),
    [activeThread.messages, financeMode]
  );
  const filteredInvoiceMessages = useMemo(
    () =>
      financeInvoiceMessages.filter((message) => {
        if (!isWithinReportingWindow(message.createdAt || message.metadata.dueDate, reportingWindow)) {
          return false;
        }
        const customerId = message.metadata.customer?.id || "";
        const status = message.metadata.status || "";
        if (invoiceFilter.customerId && customerId !== invoiceFilter.customerId) {
          return false;
        }
        if (invoiceFilter.status && status !== invoiceFilter.status) {
          return false;
        }
        return true;
      }),
    [financeInvoiceMessages, invoiceFilter, reportingWindow]
  );
  const filteredExpenseMessages = useMemo(
    () =>
      financeExpenseMessages.filter((message) => {
        if (!isWithinReportingWindow(message.metadata.expenseDate || message.createdAt, reportingWindow)) {
          return false;
        }
        const vendorId = message.metadata.vendor?.id || "";
        const status = message.metadata.status || "";
        if (expenseFilter.vendorId && vendorId !== expenseFilter.vendorId) {
          return false;
        }
        if (expenseFilter.status && status !== expenseFilter.status) {
          return false;
        }
        return true;
      }),
    [expenseFilter, financeExpenseMessages, reportingWindow]
  );
  const recurringDueInvoices = useMemo(
    () => filteredInvoiceMessages.filter((message) => Boolean(message.metadata.recurringDue)),
    [filteredInvoiceMessages]
  );
  const partialPaymentInvoices = useMemo(
    () => filteredInvoiceMessages.filter((message) => Array.isArray(message.metadata.payments) && message.metadata.payments.length > 0 && Number(message.metadata.outstandingAmount || 0) > 0),
    [filteredInvoiceMessages]
  );
  const overdueInvoiceMessages = useMemo(
    () => filteredInvoiceMessages.filter((message) => message.metadata.status === "overdue"),
    [filteredInvoiceMessages]
  );
  const customerBalanceRows = useMemo(() => {
    const rows = new Map();

    filteredInvoiceMessages.forEach((message) => {
      const outstandingAmount = Number(message.metadata.outstandingAmount || 0);
      if (outstandingAmount <= 0) {
        return;
      }

      const customerName = String(message.metadata.companyName || "Unassigned customer").trim();
      const current = rows.get(customerName) || { name: customerName, outstandingAmount: 0, invoiceCount: 0 };
      current.outstandingAmount += outstandingAmount;
      current.invoiceCount += 1;
      rows.set(customerName, current);
    });

    return [...rows.values()].sort((left, right) => right.outstandingAmount - left.outstandingAmount).slice(0, 5);
  }, [filteredInvoiceMessages]);
  const vendorUsageRows = useMemo(() => {
    const rows = new Map();

    filteredExpenseMessages.forEach((message) => {
      const vendorName = String(message.metadata.vendorName || "Unassigned vendor").trim();
      const current = rows.get(vendorName) || { name: vendorName, totalAmount: 0, expenseCount: 0 };
      current.totalAmount += Number(message.metadata.amount || 0);
      current.expenseCount += 1;
      rows.set(vendorName, current);
    });

    return [...rows.values()].sort((left, right) => right.totalAmount - left.totalAmount).slice(0, 5);
  }, [filteredExpenseMessages]);
  const recurringLifecycleSummary = useMemo(() => ({
    templates: filteredInvoiceMessages.filter((message) => message.metadata.recurring?.enabled && !message.metadata.recurringSourceInvoiceId).length,
    generated: filteredInvoiceMessages.filter((message) => message.metadata.recurringSourceInvoiceId).length,
    due: filteredInvoiceMessages.filter((message) => message.metadata.recurringDue).length
  }), [filteredInvoiceMessages]);
  const invoiceStatusBreakdown = useMemo(() => {
    const breakdown = {
      pending: 0,
      approved: 0,
      partial: 0,
      paid: 0,
      overdue: 0,
      reconciled: 0,
      rejected: 0
    };

    filteredInvoiceMessages.forEach((message) => {
      const status = message.metadata.status || "pending";
      if (Object.prototype.hasOwnProperty.call(breakdown, status)) {
        breakdown[status] += 1;
      }
    });

    return breakdown;
  }, [filteredInvoiceMessages]);
  const recentPaymentActivity = useMemo(
    () =>
      filteredInvoiceMessages
        .flatMap((message) =>
          (message.metadata.payments || []).map((payment) => ({
            id: payment.id || `${message.metadata.invoiceId}-${payment.recordedAt || "payment"}`,
            invoiceId: message.metadata.invoiceId,
            invoiceNumber: message.metadata.invoiceNumber,
            customerName: message.metadata.companyName,
            amount: payment.amount,
            currency: message.metadata.currency,
            recordedAt: payment.recordedAt,
            remainingBalance: payment.remainingBalance,
            method: payment.method || "",
            reference: payment.reference || "",
            note: payment.note || "",
            recordedBy: payment.recordedBy || null
          }))
        )
        .sort((left, right) => new Date(right.recordedAt).getTime() - new Date(left.recordedAt).getTime())
        .slice(0, 8),
    [filteredInvoiceMessages]
  );
  const selectedInvoiceMessage = selectedFinanceRecord?.kind === "invoice"
    ? financeInvoiceMessages.find((message) => message.id === selectedFinanceRecord.messageId || (message.metadata.invoiceId || message.metadata.id) === selectedFinanceRecord.recordId) || null
    : null;
  const selectedExpenseMessage = selectedFinanceRecord?.kind === "expense"
    ? financeExpenseMessages.find((message) => message.id === selectedFinanceRecord.messageId || (message.metadata.expenseId || message.metadata.id) === selectedFinanceRecord.recordId) || null
    : null;
  const financeRouteDetailKind = financeHashRoute?.section === "expenses" ? "expense" : financeHashRoute?.section === "invoices" ? "invoice" : "";
  const recentShipmentEvents = useMemo(
    () =>
      (warehouseSummary?.recentShipmentActivity?.length
        ? warehouseSummary.recentShipmentActivity
        : warehouseOrders
      )
        .filter((order) => Boolean(order.updatedAt || order.createdAt || order.estimatedDelivery))
        .sort((left, right) => new Date(right.updatedAt || right.createdAt || right.estimatedDelivery).getTime() - new Date(left.updatedAt || left.createdAt || left.estimatedDelivery).getTime())
        .slice(0, 6),
    [warehouseOrders, warehouseSummary]
  );
  const recurringTemplateHistory = useMemo(() => {
    const generatedRunsBySource = new Map();
    financeInvoiceMessages.forEach((message) => {
      const sourceId = message.metadata.recurringSourceInvoiceId;
      if (!sourceId) {
        return;
      }

      const currentRuns = generatedRunsBySource.get(sourceId) || [];
      currentRuns.push({
        id: message.metadata.invoiceId,
        invoiceNumber: message.metadata.invoiceNumber,
        recurringSequence: Number(message.metadata.recurringSequence || 0),
        amount: Number(message.metadata.amount || 0),
        currency: message.metadata.currency || "USD",
        createdAt: message.createdAt,
        dueDate: message.metadata.dueDate,
        statusLabel: normalizeFinanceInvoiceStatus(message.metadata.status || "pending")
      });
      generatedRunsBySource.set(sourceId, currentRuns);
    });

    return financeInvoiceMessages
      .filter((message) => message.metadata.recurring?.enabled && !message.metadata.recurringSourceInvoiceId)
      .map((message) => {
        const allRuns = (generatedRunsBySource.get(message.metadata.invoiceId) || [])
          .sort((left, right) => Number(right.recurringSequence || 0) - Number(left.recurringSequence || 0));
        const visibleRuns = allRuns
          .filter((run) => isWithinReportingWindow(run.createdAt || run.dueDate, reportingWindow));
        const latestRun = allRuns[0] || null;

        return {
          id: message.metadata.invoiceId,
          invoiceNumber: message.metadata.invoiceNumber,
          customerName: message.metadata.customer?.name || message.metadata.companyName || "Unassigned customer",
          nextIssueDate: message.metadata.recurring?.nextIssueDate || null,
          lastIssuedAt: message.metadata.recurring?.lastIssuedAt || null,
          dueNow: Boolean(message.metadata.recurringDue),
          frequency: message.metadata.recurring?.frequency || "monthly",
          interval: Number(message.metadata.recurring?.interval || 1),
          amount: Number(message.metadata.amount || 0),
          currency: message.metadata.currency || "USD",
          generatedCount: allRuns.length,
          latestRun,
          generatedRuns: visibleRuns.slice(0, 3)
        };
      })
      .filter((template) => reportingWindow === "all" || template.generatedRuns.length > 0 || isWithinReportingWindow(template.nextIssueDate, reportingWindow))
      .sort((left, right) => {
        if (left.dueNow !== right.dueNow) {
          return left.dueNow ? -1 : 1;
        }

        return right.generatedCount - left.generatedCount;
      })
      .slice(0, 6);
  }, [financeInvoiceMessages, reportingWindow]);

  useEffect(() => {
    if (!["invoices", "expenses"].includes(financeSection)) {
      setSelectedFinanceRecord(null);
      setSelectedFinanceRecordDetail(null);
      setSelectedFinanceRecordLoading(false);
    }
  }, [financeSection]);

  useEffect(() => {
    function handleHashRouteChange() {
      setFinanceHashRoute(parseFinanceHashRoute());
    }

    window.addEventListener("hashchange", handleHashRouteChange);
    return () => {
      window.removeEventListener("hashchange", handleHashRouteChange);
    };
  }, []);

  useEffect(() => {
    if (!selectedFinanceRecord) {
      return;
    }
    if (selectedFinanceRecord.kind === "invoice" && !selectedInvoiceMessage) {
      setSelectedFinanceRecord(null);
      setSelectedFinanceRecordDetail(null);
    }
    if (selectedFinanceRecord.kind === "expense" && !selectedExpenseMessage) {
      setSelectedFinanceRecord(null);
      setSelectedFinanceRecordDetail(null);
    }
  }, [selectedExpenseMessage, selectedFinanceRecord, selectedInvoiceMessage]);

  async function handleSelectFinanceRecord(kind, message) {
    if (!message?.metadata) {
      return;
    }

    const recordId = kind === "invoice" ? (message.metadata.invoiceId || message.metadata.id) : (message.metadata.expenseId || message.metadata.id);
    setSelectedFinanceRecord({
      kind,
      messageId: message.id,
      recordId
    });
    setSelectedFinanceRecordDetail(null);
    updateFinanceHashRoute(kind === "invoice" ? "invoices" : "expenses", recordId);
    if (!recordId) {
      return;
    }

    const loader = kind === "invoice" ? onLoadFinanceInvoiceDetail : onLoadFinanceExpenseDetail;
    if (!loader) {
      return;
    }

    setSelectedFinanceRecordLoading(true);
    try {
      const detail = await loader(recordId);
      setSelectedFinanceRecordDetail(detail);
    } finally {
      setSelectedFinanceRecordLoading(false);
    }
  }

  useEffect(() => {
    if (!financeHashRoute?.recordId) {
      return;
    }

    const kind = financeHashRoute.section === "expenses" ? "expense" : "invoice";
    const sourceMessages = kind === "invoice" ? financeInvoiceMessages : financeExpenseMessages;
    const matchedMessage = sourceMessages.find(
      (message) => (kind === "invoice" ? (message.metadata.invoiceId || message.metadata.id) : (message.metadata.expenseId || message.metadata.id)) === financeHashRoute.recordId
    );

    setActiveTab("Media");
    setFinanceSection(financeHashRoute.section);

    if (matchedMessage && selectedFinanceRecord?.recordId !== financeHashRoute.recordId) {
      void handleSelectFinanceRecord(kind, matchedMessage);
      return;
    }

    if (!matchedMessage && selectedFinanceRecord?.recordId !== financeHashRoute.recordId) {
      setSelectedFinanceRecord({
        kind,
        messageId: "",
        recordId: financeHashRoute.recordId
      });
      setSelectedFinanceRecordLoading(true);
      setSelectedFinanceRecordDetail(null);
      const loader = kind === "invoice" ? onLoadFinanceInvoiceDetail : onLoadFinanceExpenseDetail;
      Promise.resolve(loader?.(financeHashRoute.recordId))
        .then((detail) => {
          setSelectedFinanceRecordDetail(detail || null);
        })
        .finally(() => {
          setSelectedFinanceRecordLoading(false);
        });
    }
  }, [financeHashRoute, financeInvoiceMessages, financeExpenseMessages, onLoadFinanceExpenseDetail, onLoadFinanceInvoiceDetail, selectedFinanceRecord?.recordId]);
  const paymentContextInvoices = useMemo(
    () =>
      filteredInvoiceMessages
        .filter((message) => Number(message.metadata.outstandingAmount || 0) > 0 && Array.isArray(message.metadata.payments) && message.metadata.payments.length > 0)
        .map((message) => {
          const latestPayment = [...(message.metadata.payments || [])]
            .sort((left, right) => new Date(right.recordedAt).getTime() - new Date(left.recordedAt).getTime())[0] || null;

          return {
            id: message.metadata.invoiceId,
            invoiceNumber: message.metadata.invoiceNumber,
            customerName: message.metadata.customer?.name || message.metadata.companyName || "Unassigned customer",
            outstandingAmount: Number(message.metadata.outstandingAmount || 0),
            currency: message.metadata.currency || "USD",
            latestPayment
          };
        })
        .sort((left, right) => right.outstandingAmount - left.outstandingAmount)
        .slice(0, 4),
    [filteredInvoiceMessages]
  );
  const showOperationsBridge = useMemo(
    () => workspaceScope === "both" && canManageFinanceMembers,
    [canManageFinanceMembers, workspaceScope]
  );
  const operationsBridgeTopCustomers = useMemo(
    () => (financeSummary?.topCustomersOwed?.length ? financeSummary.topCustomersOwed : customerBalanceRows).slice(0, 3),
    [customerBalanceRows, financeSummary]
  );
  const operationsBridgePanel = showOperationsBridge ? (
    <OperationsBridgePanel
      financeMode={financeMode}
      financeSummary={financeSummary}
      warehouseSummary={warehouseSummary}
      executionSummary={executionSummary}
      recentPayments={reportingWindow === "all" && Array.isArray(financeSummary?.recentPayments) && financeSummary.recentPayments.length
        ? financeSummary.recentPayments
        : recentPaymentActivity}
      recentShipments={recentShipmentEvents}
      topCustomers={operationsBridgeTopCustomers}
      onSelectMetric={onSelectMetric}
      onNavigate={onNavigateOverview}
    />
  ) : null;
  const financeQuickActions = useMemo(
    () => [
      {
        id: "new-invoice",
        label: "New invoice",
        description: "Prefill the composer to create a fresh finance invoice card.",
        icon: "📄",
        accent: "#10b981"
      },
      {
        id: "log-expense",
        label: "Log expense",
        description: "Start a new expense entry from the finance composer.",
        icon: "💳",
        accent: "#38bdf8"
      },
      {
        id: "open-approvals",
        label: "Open approvals",
        description: "Jump straight to the live approvals queue.",
        icon: "✓",
        accent: "#f59e0b"
      },
      {
        id: "open-analytics",
        label: "Open analytics",
        description: "Review current finance metrics and recent activity.",
        icon: "📊",
        accent: "#22c55e"
      }
    ].filter((action) => {
      if (action.id === "new-invoice" || action.id === "log-expense") {
        return financePermissions?.canCreate;
      }

      return financePermissions?.canView;
    }),
    [financePermissions]
  );
  useEffect(() => {
    setFinanceAccountingState(resolveFinanceAccountingState(financeSummary, activeWorkspace, workspaceSettings));
  }, [activeWorkspace, financeSummary, workspaceSettings]);

  const financeAccountingEnabled = financeAccountingState.enabled;
  const financeAccountingEnabledAt = financeAccountingState.enabledAt;
  const financeSections = useMemo(
    () => {
      const sections = [...FINANCE_MEDIA_SECTIONS];
      if (financeAccountingEnabled) {
        sections.push({ id: "accounting", label: "Accounting" });
      }
      if (financePermissions?.isAccountant) {
        sections.push({ id: "accountant", label: "Accountant" });
      }
      return sections;
    },
    [financeAccountingEnabled, financePermissions?.isAccountant]
  );
  const canManageWarehouseStock =
    workspaceAccessMode !== "real" ||
    (Array.isArray(activeWorkspaceMembership?.modules) &&
      activeWorkspaceMembership.modules.includes("warehouse") &&
      activeWorkspaceMembership.status !== "suspended");
  const accountingAccountCodes = useMemo(
    () => new Set((financeSummary?.accountingStatements?.accountBalances || []).map((account) => account.code)),
    [financeSummary]
  );
  const canManageFinanceControls =
    financeAccountingEnabled &&
    (activeWorkspaceMembership?.workspaceRole === "owner" || activeWorkspaceMembership?.workspaceRole === "manager");
  const financeToolbarActions = useMemo(
    () => [
      {
        id: "refresh-finance",
        label: "Refresh finance data",
        description: "Pull the latest invoices, expenses, metrics, and activity from the backend.",
        icon: "↻",
        accent: "#10b981"
      },
      {
        id: "latest-activity",
        label: "Jump to latest activity",
        description: "Open Analytics to review the most recent FinanceBot actions.",
        icon: "🕘",
        accent: "#38bdf8"
      },
      {
        id: "return-chat",
        label: "Return to chat",
        description: "Go back to the main FinanceBot conversation and composer.",
        icon: "💬",
        accent: "#a78bfa"
      },
      {
        id: "clear-detail",
        label: "Clear detail panel",
        description: "Close the open metric detail drawer and return to the main workspace view.",
        icon: "⊘",
        accent: "#94a3b8"
      }
    ],
    []
  );
  const visiblePinnedMetrics = financeMode ? financeMetricCards : metricCards;
  const workspaceBotMode = isWorkspaceBotMode(activeThread, financeMode ? "finances" : activeThread?.botType === "warehouse" ? "warehouse" : "");
  const showWorkspaceOverviewView = activeNav === "home";
  const showWorkspaceMembersView = workspaceBotMode && activeNav === "users";
  const headerAvatar = showWorkspaceOverviewView
    ? { label: "◎", fg: financeMode ? "text-white" : "text-slate-700" }
    : showWorkspaceMembersView
    ? { label: "⚙", fg: financeMode ? "text-white" : "text-slate-700" }
    : avatarForThread(activeThread);
  const headerTitle = showWorkspaceOverviewView
    ? "Workspace Overview"
    : showWorkspaceMembersView
      ? "Workspace Settings"
      : activeThread.isBot
        ? `${activeThread.id === "financebot" ? "💰" : "📦"} ${activeThread.name}`
        : activeThread.name;
  const headerSubtitle = showWorkspaceOverviewView
    ? "Operational snapshot for owners and managers"
    : showWorkspaceMembersView
    ? "Workspace members, modules, and ownership"
    : financeMode
      ? `${activeThread.id === "financebot" ? "Finance Cockpit" : "Workspace"} • ${activeThread.online ? "Online" : "Offline"}`
      : activeThread.online
        ? "Online"
        : "Offline";
  const showHeaderEmail = !showWorkspaceMembersView && !showWorkspaceOverviewView && !activeThread.isBot && activeThread.linkedUserEmail;
  const unreadNotificationLabel = workspaceNotificationCount > 99 ? "99+" : String(workspaceNotificationCount || 0);
  const notificationBadgeStyles = buildNotificationToneStyles(notificationTone, financeMode);

  useEffect(() => {
    setActiveCommandIndex(0);
    if (!draft.startsWith("/")) {
      setCommandMenuDismissed(false);
    }
  }, [draft]);

  useEffect(() => {
    if (!financeAccountingEnabled && financeSection === "accounting") {
      setFinanceSection("reports");
    }
  }, [financeAccountingEnabled, financeSection]);

  useEffect(() => {
    if (activeTab !== "Media" && financeSection !== "reports") {
      setFinanceSection("reports");
    }
  }, [activeTab, financeSection]);

  useEffect(() => {
    setShowNotificationMenu(false);
  }, [activeThread?.id, activeWorkspace?.id, showWorkspaceMembersView, showWorkspaceOverviewView]);

  useEffect(() => {
    if (!showNotificationMenu) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (notificationMenuRef.current?.contains(event.target)) {
        return;
      }

      setShowNotificationMenu(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [showNotificationMenu]);

  useEffect(() => {
    if (accountingPeriodSyncRef.current === reportingWindow) {
      return;
    }

    accountingPeriodSyncRef.current = reportingWindow;
    if (financeMode && financeSection === "accounting" && workspaceAccessMode === "real" && onRefreshFinanceData) {
      void onRefreshFinanceData({ accountingPeriod: reportingWindow, toastOnSuccess: false });
    }
  }, [financeMode, financeSection, onRefreshFinanceData, reportingWindow, workspaceAccessMode]);

  useEffect(() => {
    if (!financeAccountingEnabled) {
      setSelectedAccountingAccountCode("");
      setAccountDrilldown(null);
      return;
    }

    if (selectedAccountingAccountCode && !accountingAccountCodes.has(selectedAccountingAccountCode)) {
      setSelectedAccountingAccountCode("");
      setAccountDrilldown(null);
    }
  }, [accountingAccountCodes, financeAccountingEnabled, selectedAccountingAccountCode]);

  useEffect(() => {
    if (!selectedLockPeriodKey && financeSummary?.accountingControls?.currentPeriodKey) {
      setSelectedLockPeriodKey(financeSummary.accountingControls.currentPeriodKey);
    }
  }, [financeSummary?.accountingControls?.currentPeriodKey, selectedLockPeriodKey]);

  useEffect(() => {
    if (
      !financeAccountingEnabled ||
      financeSection !== "accounting" ||
      !selectedAccountingAccountCode ||
      !financeMode ||
      workspaceAccessMode !== "real" ||
      !onLoadAccountingAccountDrilldown
    ) {
      setAccountDrilldown(null);
      setAccountDrilldownLoading(false);
      return;
    }

    let cancelled = false;
    setAccountDrilldownLoading(true);

    void onLoadAccountingAccountDrilldown(selectedAccountingAccountCode, {
      accountingPeriod: reportingWindow,
      limit: 12
    })
      .then((payload) => {
        if (!cancelled) {
          setAccountDrilldown(payload || null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAccountDrilldown(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAccountDrilldownLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [financeAccountingEnabled, financeMode, financeSection, onLoadAccountingAccountDrilldown, reportingWindow, selectedAccountingAccountCode, workspaceAccessMode]);

  useEffect(() => {
    if (!showQuickActionMenu) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (quickActionMenuRef.current?.contains(event.target)) {
        return;
      }

      setShowQuickActionMenu(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [showQuickActionMenu]);

  useEffect(() => {
    if (!showToolbarOverflowMenu) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (toolbarOverflowMenuRef.current?.contains(event.target)) {
        return;
      }

      setShowToolbarOverflowMenu(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [showToolbarOverflowMenu]);

  async function handleExportAccountingStatement() {
    await handleExportAccountingStatementVariant("pack");
  }

  async function handleExportAccountingStatementVariant(variant = "pack") {
    if (!financeAccountingEnabled || !financeMode || workspaceAccessMode !== "real" || accountingExporting || !onExportAccountingStatement) {
      return;
    }

    setAccountingExporting(variant);

    try {
      const payload = await onExportAccountingStatement({
        accountingPeriod: reportingWindow,
        variant
      });
      const statementRows = Array.isArray(payload?.statementRows) ? payload.statementRows : [];
      downloadCsvFile(
        `${sanitizeDownloadPart(activeWorkspace?.name)}-${sanitizeDownloadPart(variant)}-${reportingWindow}.csv`,
        [
          { key: "section", label: "Section" },
          { key: "label", label: "Label" },
          { key: "value", label: "Current Value" },
          { key: "previousValue", label: "Previous Value" },
          { key: "delta", label: "Delta" },
          { key: "direction", label: "Direction" },
          { key: "accountCode", label: "Account Code" },
          { key: "accountType", label: "Account Type" },
          { key: "periodLabel", label: "Period" }
        ],
        statementRows
      );
      pushToast({
        title: `${formatAccountingReportVariantLabel(variant)} CSV ready`,
        body: `Downloaded the ${formatAccountingPeriodLabel(reportingWindow).toLowerCase()} ${formatAccountingReportVariantLabel(variant).toLowerCase()} table.`
      });
    } catch (error) {
      pushToast({
        title: "Statement export failed",
        body: error?.message || "The accounting statement export could not be prepared."
      });
    } finally {
      setAccountingExporting("");
    }
  }

  async function handleExportAccountingJournals() {
    if (!financeAccountingEnabled || !financeMode || workspaceAccessMode !== "real" || accountingExporting || !onExportAccountingJournals) {
      return;
    }

    setAccountingExporting("journals");

    try {
      const payload = await onExportAccountingJournals({
        accountingPeriod: reportingWindow,
        limit: 150
      });
      const journalRows = Array.isArray(payload?.journalRows) ? payload.journalRows : [];
      downloadCsvFile(
        `${sanitizeDownloadPart(activeWorkspace?.name)}-accounting-journals-${reportingWindow}.csv`,
        [
          { key: "entryNumber", label: "Entry Number" },
          { key: "postingDate", label: "Posting Date" },
          { key: "status", label: "Status" },
          { key: "entryType", label: "Entry Type" },
          { key: "description", label: "Description" },
          { key: "accountCode", label: "Account Code" },
          { key: "accountName", label: "Account Name" },
          { key: "accountType", label: "Account Type" },
          { key: "debit", label: "Debit" },
          { key: "credit", label: "Credit" },
          { key: "totalDebit", label: "Entry Total Debit" },
          { key: "totalCredit", label: "Entry Total Credit" },
          { key: "createdBy", label: "Recorded By" },
          { key: "sourceType", label: "Source Type" },
          { key: "sourceId", label: "Source Id" },
          { key: "periodLabel", label: "Period" }
        ],
        journalRows
      );
      pushToast({
        title: "Journal CSV ready",
        body: `Downloaded the ${formatAccountingPeriodLabel(reportingWindow).toLowerCase()} journal table for accountant review.`
      });
    } catch (error) {
      pushToast({
        title: "Journal export failed",
        body: error?.message || "The journal export could not be prepared."
      });
    } finally {
      setAccountingExporting("");
    }
  }

  async function handleLockFinancePeriod(lockRequest) {
    const periodKey = typeof lockRequest === "string" ? lockRequest : lockRequest?.periodKey;
    const note = typeof lockRequest === "string" ? "" : String(lockRequest?.note || "").trim();
    if (!periodKey || !onLockFinancePeriod || financeControlAction) {
      return;
    }

    setFinanceControlAction("lock");
    try {
      await onLockFinancePeriod({ periodKey, note });
      setSelectedLockPeriodKey(periodKey);
      pushToast({
        title: "Period locked",
        body: note
          ? `${formatPeriodKeyLabel(periodKey)} is now locked for finance posting changes. Review note saved.`
          : `${formatPeriodKeyLabel(periodKey)} is now locked for finance posting changes.`
      });
    } catch (error) {
      pushToast({
        title: "Lock failed",
        body: financeGuardrailMessage(error, "The accounting period could not be locked.")
      });
    } finally {
      setFinanceControlAction("");
    }
  }

  async function handleUnlockFinancePeriod(periodKey) {
    if (!periodKey || !onUnlockFinancePeriod || financeControlAction) {
      return;
    }

    setFinanceControlAction("unlock");
    try {
      await onUnlockFinancePeriod(periodKey);
      setSelectedLockPeriodKey(periodKey);
      pushToast({
        title: "Period unlocked",
        body: `${formatPeriodKeyLabel(periodKey)} is open for finance posting changes again.`
      });
    } catch (error) {
      pushToast({
        title: "Unlock failed",
        body: financeGuardrailMessage(error, "The accounting period could not be unlocked.")
      });
    } finally {
      setFinanceControlAction("");
    }
  }

  function handlePrintFinanceReport() {
    if (!financeAccountingEnabled || typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    document.body.classList.add("finance-print-mode");

    const cleanup = () => {
      document.body.classList.remove("finance-print-mode");
      window.removeEventListener("afterprint", cleanup);
    };

    window.addEventListener("afterprint", cleanup, { once: true });
    window.setTimeout(() => {
      try {
        window.print();
      } catch (error) {
        cleanup();
        pushToast({
          title: "Print failed",
          body: "The accounting print view could not be opened."
        });
      }
    }, 40);
  }

  const insertCommand = (command) => {
    setDraft(command);
    setCommandMenuDismissed(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  function requestRealWorkspaceUpgrade() {
    setShowRealWorkspaceConfirm(true);
  }

  function confirmRealWorkspaceUpgrade() {
    setShowRealWorkspaceConfirm(false);
    onUpgradeToRealWorkspace?.();
  }

  function openFinanceEntryModal(type, initialValues = {}, context = null) {
    setShowQuickActionMenu(false);
    setActiveTab("Chat");
    const defaultCurrency = workspaceDefaultCurrency || "USD";

    if (type === "invoice") {
      setFinanceEntryValues({
        invoiceNumber: "",
        customerName: activeThread?.isBot ? "" : activeThread?.name || "",
        customerEmail: "",
        amount: "9800",
        currency: defaultCurrency,
        dueDate: new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10),
        note: "",
        taxRate: "0",
        taxLabel: "Tax",
        recurringEnabled: false,
        recurringFrequency: "monthly",
        ...initialValues
      });
    } else {
      setFinanceEntryValues({
        amount: "",
        currency: defaultCurrency,
        category: "other",
        expenseDate: todayDateInputValue(),
        vendorName: activeThread?.isBot ? "" : activeThread?.name || "",
        vendorEmail: "",
        note: "",
        taxRate: "0",
        taxLabel: "Tax",
        ...initialValues
      });
    }

    setFinanceEntryContext(context);
    setFinanceEntryModal(type);
  }

  function closeFinanceEntryModal() {
    setFinanceEntryModal(null);
    setFinanceEntryValues({});
    setIsFinanceEntrySubmitting(false);
    setFinanceEntryContext(null);
  }

  function openPaymentEntry(message) {
    const remainingAmount = Number(message.metadata.outstandingAmount || message.metadata.amount || 0);
    setPaymentEntry({
      message,
      invoiceId: message.metadata.invoiceId,
      invoiceNumber: message.metadata.invoiceNumber,
      amount: Number(message.metadata.amount || 0),
      currency: message.metadata.currency || "USD",
      customerName: message.metadata.companyName || "",
      paidAmount: Number(message.metadata.paidAmount || 0),
      outstandingAmount: remainingAmount
    });
    setPaymentEntryValues({
      amount: remainingAmount > 0 ? String(remainingAmount) : "",
      method: "bank_transfer",
      reference: "",
      note: ""
    });
  }

  function closePaymentEntry() {
    setPaymentEntry(null);
    setPaymentEntryValues({ amount: "", method: "bank_transfer", reference: "", note: "" });
    setIsPaymentSubmitting(false);
  }

  async function handleMarkPaidInvoice(message, paymentDetails = null) {
    if (paymentDetails === null) {
      openPaymentEntry(message);
      return false;
    }

    const didRecordPayment = await handlers.onMarkPaidInvoice?.(message, paymentDetails);
    if (didRecordPayment) {
      closePaymentEntry();
    }
    return didRecordPayment;
  }

  async function handleSaveFinanceContact(kind, payload) {
    const saveFn = kind === "customer" ? onSaveFinanceCustomer : onSaveFinanceVendor;
    if (!saveFn) {
      return false;
    }

    setFinanceContactSavingKind(kind);
    try {
      return await saveFn(payload);
    } finally {
      setFinanceContactSavingKind(null);
    }
  }

  async function handleIssueRecurringInvoice(message) {
    if (!handlers.onIssueRecurringInvoice || !message?.metadata?.invoiceId) {
      return;
    }

    setIssuingRecurringInvoiceId(message.metadata.invoiceId);
    try {
      await handlers.onIssueRecurringInvoice(message);
    } finally {
      setIssuingRecurringInvoiceId(null);
    }
  }

  function updateFinanceEntryValue(field, value) {
    setFinanceEntryValues((current) => ({
      ...current,
      [field]: value
    }));
  }

  async function handleFinanceEntryFile(file) {
    if (!file) {
      if (financeEntryModal === "invoice") {
        updateFinanceEntryValue("attachment", null);
      } else if (financeEntryModal === "expense") {
        updateFinanceEntryValue("receipt", null);
      }
      return;
    }

    try {
      const fileUrl = await readFileAsDataUrl(file);
      const payload = {
        fileName: file.name,
        fileType: file.type || "application/octet-stream",
        fileUrl
      };

      if (financeEntryModal === "invoice") {
        updateFinanceEntryValue("attachment", payload);
      } else if (financeEntryModal === "expense") {
        updateFinanceEntryValue("receipt", payload);
      }
    } catch (error) {
      setShowQuickActionMenu(false);
      pushToast({
        title: "Attachment failed",
        body: error.message || "Unable to read the selected file."
      });
    }
  }

  function handleEditExpense(message) {
    openFinanceEntryModal(
      "expense",
      {
        expenseId: message.metadata.expenseId,
        amount: String(message.metadata.totalWithTax ? ((message.metadata.subtotal ?? message.metadata.amount) || "") : (message.metadata.amount || "")),
        currency: message.metadata.currency || workspaceDefaultCurrency || "USD",
        category: message.metadata.category || "other",
        expenseDate: message.metadata.expenseDate ? String(message.metadata.expenseDate).slice(0, 10) : todayDateInputValue(),
        vendorName: message.metadata.vendorName || "",
        vendorEmail: message.metadata.vendor?.email || "",
        note: message.metadata.note || "",
        taxRate: String(message.metadata.taxRate || 0),
        taxLabel: message.metadata.taxLabel || "Tax",
        receipt: message.metadata.receipt || null
      },
      {
        expenseId: message.metadata.expenseId
      }
    );
  }

  function handleEditInvoice(message) {
    openFinanceEntryModal(
      "invoice",
      {
        invoiceId: message.metadata.invoiceId,
        invoiceNumber: message.metadata.invoiceNumber || "",
        customerName: message.metadata.customer?.name || message.metadata.companyName || "",
        customerEmail: message.metadata.customer?.email || "",
        amount: String((message.metadata.subtotal ?? message.metadata.amount) || ""),
        currency: message.metadata.currency || workspaceDefaultCurrency || "USD",
        dueDate: message.metadata.dueDate ? String(message.metadata.dueDate).slice(0, 10) : "",
        note: message.metadata.note || "",
        taxRate: String(message.metadata.taxRate || 0),
        taxLabel: message.metadata.taxLabel || "Tax",
        recurringEnabled: Boolean(message.metadata.recurring?.enabled),
        recurringFrequency: message.metadata.recurring?.frequency || "monthly",
        attachment: Array.isArray(message.metadata.attachments) ? message.metadata.attachments[0] || null : null
      },
      {
        invoiceId: message.metadata.invoiceId
      }
    );
  }

  function handleQuickAction(actionId) {
    if ((actionId === "new-invoice" || actionId === "log-expense") && !financePermissions?.canCreate) {
      setShowQuickActionMenu(false);
      pushToast({
        title: "Action unavailable",
        body: "Your finance role does not allow creating or editing finance records."
      });
      return;
    }

    if (actionId === "new-invoice") {
      openFinanceEntryModal("invoice");
      return;
    }

    if (actionId === "log-expense") {
      openFinanceEntryModal("expense");
      return;
    }

    setShowQuickActionMenu(false);

    if (actionId === "open-approvals") {
      setActiveTab("Links");
      return;
    }

    if (actionId === "open-analytics") {
      setActiveTab("Media");
    }
  }

  async function handleFinanceEntrySubmit() {
    if (!financeEntryModal) {
      return;
    }

    if (!financePermissions?.canCreate) {
      pushToast({
        title: "Action unavailable",
        body: "Your finance role does not allow creating or editing finance records."
      });
      return;
    }

    setIsFinanceEntrySubmitting(true);

    try {
      if (financeEntryModal === "invoice") {
        const success = await onCreateInvoice?.({
          invoiceId: financeEntryContext?.invoiceId || financeEntryValues.invoiceId || null,
          invoiceNumber: financeEntryValues.invoiceNumber,
          customerName: financeEntryValues.customerName || financeEntryValues.vendorName,
          customerEmail: financeEntryValues.customerEmail,
          amount: financeEntryValues.amount,
          currency: financeEntryValues.currency || workspaceDefaultCurrency || "USD",
          dueDate: financeEntryValues.dueDate,
          note: financeEntryValues.note,
          taxRate: financeEntryValues.taxRate || 0,
          taxLabel: financeEntryValues.taxLabel || "Tax",
          recurringEnabled: Boolean(financeEntryValues.recurringEnabled),
          recurringFrequency: financeEntryValues.recurringFrequency || "monthly",
          attachments: financeEntryValues.attachment ? [financeEntryValues.attachment] : []
        });

        if (success) {
          closeFinanceEntryModal();
        }
        return;
      }

      const success = await onCreateExpense?.({
        expenseId: financeEntryContext?.expenseId || financeEntryValues.expenseId || null,
        amount: financeEntryValues.amount,
        currency: financeEntryValues.currency || workspaceDefaultCurrency || "USD",
        category: financeEntryValues.category,
        expenseDate: financeEntryValues.expenseDate || todayDateInputValue(),
        vendorName: financeEntryValues.vendorName,
        vendorEmail: financeEntryValues.vendorEmail,
        note: financeEntryValues.note,
        taxRate: financeEntryValues.taxRate || 0,
        taxLabel: financeEntryValues.taxLabel || "Tax",
        receipt: financeEntryValues.receipt || null
      });

      if (success) {
        closeFinanceEntryModal();
      }
    } finally {
      setIsFinanceEntrySubmitting(false);
    }
  }

  async function handleToolbarOverflowAction(actionId) {
    setShowToolbarOverflowMenu(false);

    if (actionId === "refresh-finance") {
      await onRefreshFinanceData?.();
      return;
    }

    if (actionId === "latest-activity") {
      setDetailMetric(null);
      setActiveTab("Media");
      return;
    }

    if (actionId === "return-chat") {
      setDetailMetric(null);
      setActiveTab("Chat");
      return;
    }

    if (actionId === "clear-detail") {
      setDetailMetric(null);
    }
  }

  return (
    <section
      className={`flex min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden ${financeMode ? "bg-[#0f1623]" : "bg-[#FBFCFF]"}`}
      style={financeMode ? { color: "#f1f5f9" } : undefined}
    >
      <div className="flex min-h-0 min-w-[760px] flex-1 flex-col">
        <div
          className={`flex items-center justify-between px-6 py-4 ${financeMode ? "" : "border-b border-slate-200"}`}
          style={financeMode ? { borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(6,10,18,0.9)" } : undefined}
        >
        <div className="flex items-center gap-3">
          <div
            className={`flex h-12 w-12 items-center justify-center rounded-2xl ${headerAvatar.fg}`}
            style={
              financeMode
                ? {
                    background: "rgba(16,185,129,0.12)",
                    border: "1px solid rgba(16,185,129,0.26)",
                    color: "#10b981"
                  }
                : undefined
            }
          >
            {headerAvatar.label}
          </div>
          <div>
            <h3
              className={`${financeMode ? "text-white" : "text-slate-900"}`}
              style={{ fontFamily: '"Sora","Manrope","DM Sans","Segoe UI",sans-serif', fontSize: 17, fontWeight: 700 }}
            >
              {headerTitle}
            </h3>
            <p className={`text-sm ${financeMode ? "text-slate-500" : "text-slate-500"}`}>
              {headerSubtitle}
            </p>
            {showHeaderEmail ? (
              <p className={`mt-1 text-xs ${financeMode ? "text-slate-500" : "text-slate-500"}`}>
                {activeThread.linkedUserEmail}
              </p>
            ) : null}
            {workspaceAccessMode === "real" && activeWorkspace ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className="rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]"
                  style={{
                    borderColor: financeMode ? "rgba(16,185,129,0.22)" : "rgba(148,163,184,0.22)",
                    background: financeMode ? "rgba(16,185,129,0.1)" : "rgba(15,23,42,0.06)",
                    color: financeMode ? "#34d399" : "#334155"
                  }}
                >
                  {activeWorkspace.name}
                </span>
                {activeWorkspaceMembership?.workspaceRole ? (
                  <span className={`text-xs font-medium ${financeMode ? "text-slate-400" : "text-slate-500"}`}>
                    {activeWorkspaceMembership.workspaceRole}
                  </span>
                ) : null}
                {(Array.isArray(activeWorkspaceMembership?.modules) ? activeWorkspaceMembership.modules : []).map((moduleId) => (
                  <span
                    key={`active-module-${moduleId}`}
                    className="rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]"
                    style={{
                      borderColor: financeMode ? "rgba(255,255,255,0.08)" : "rgba(148,163,184,0.24)",
                      background: financeMode ? "rgba(255,255,255,0.04)" : "rgba(15,23,42,0.05)",
                      color: financeMode ? "#cbd5e1" : "#475569"
                    }}
                  >
                    {moduleId}
                  </span>
                ))}
                {workspaceSettings?.summary?.usesLegacyFallback ? (
                  <span
                    className="rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]"
                    style={{
                      borderColor: "rgba(245,158,11,0.28)",
                      background: "rgba(245,158,11,0.1)",
                      color: "#fbbf24"
                    }}
                  >
                    Legacy compatibility
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {financeMode ? (
            <>
              {workspaceAccessMode === "real" && financeWorkspaces.length ? (
                <label
                  className="flex items-center gap-2 rounded-2xl border px-3 py-2"
                  style={{
                    borderColor: "rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.05)"
                  }}
                >
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Workspace</span>
                  {financeWorkspaces.length > 1 ? (
                    <select
                      value={activeWorkspace?.id || ""}
                      onChange={(event) => onSelectWorkspace?.(event.target.value)}
                      disabled={financeWorkspacesLoading}
                      className="bg-transparent text-sm font-semibold text-slate-50 outline-none"
                    >
                      {financeWorkspaces.map((entry) => (
                        <option key={entry.workspace.id} value={entry.workspace.id} className="bg-slate-950 text-slate-50">
                          {entry.workspace.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-sm font-semibold text-slate-50">{financeWorkspaces[0]?.workspace?.name || activeWorkspace.name}</span>
                  )}
                </label>
              ) : null}
              {onCloseWorkspace ? <HeaderAction financeMode onClick={onCloseWorkspace}>← Close</HeaderAction> : null}
              {workspaceAccessMode === "demo" && onUpgradeToRealWorkspace ? (
                <HeaderAction financeMode onClick={requestRealWorkspaceUpgrade}>Use Real Workspace</HeaderAction>
              ) : null}
              {workspaceAccessMode === "real" && onWorkspaceLogout ? (
                <HeaderAction financeMode onClick={onWorkspaceLogout}>Logout</HeaderAction>
              ) : null}
              {financePermissions?.canView ? (
                <HeaderAction financeMode onClick={() => setActiveTab("Media")}>📊 Report</HeaderAction>
              ) : null}
              {workspaceAccessMode === "real" && activeWorkspace ? (
                <div className="relative" ref={notificationMenuRef}>
                  <HeaderAction
                    financeMode
                    onClick={() => {
                      setShowNotificationMenu((current) => !current);
                      if (!showNotificationMenu) {
                        void onRefreshWorkspaceNotifications?.();
                      }
                    }}
                  >
                    <span className="relative inline-flex items-center gap-2">
                      <span>🔔 Inbox</span>
                      {workspaceNotificationCount > 0 ? (
                        <span
                          className="inline-flex min-w-[22px] items-center justify-center rounded-full border px-1.5 py-0.5 text-[10px] font-bold"
                          style={notificationBadgeStyles}
                        >
                          {unreadNotificationLabel}
                        </span>
                      ) : null}
                    </span>
                  </HeaderAction>
                  {showNotificationMenu ? (
                    <WorkspaceNotificationMenu
                      financeMode
                      unreadCount={workspaceNotificationCount}
                      notifications={workspaceNotifications}
                      loading={workspaceNotificationsLoading}
                      onOpenNotification={(notification) => {
                        setShowNotificationMenu(false);
                        void onOpenWorkspaceNotification?.(notification);
                      }}
                      onMarkAllRead={() => onMarkAllWorkspaceNotificationsRead?.()}
                      markAllLoading={markingAllWorkspaceNotificationsRead}
                    />
                  ) : null}
                </div>
              ) : null}
              {financeQuickActions.length ? (
                <div className="relative" ref={quickActionMenuRef}>
                  <HeaderAction financeMode onClick={() => setShowQuickActionMenu((current) => !current)}>⚡ Quick Action ▾</HeaderAction>
                  {showQuickActionMenu ? (
                    <QuickActionMenu items={financeQuickActions} onSelect={handleQuickAction} />
                  ) : null}
                </div>
              ) : null}
              <div className="relative" ref={toolbarOverflowMenuRef}>
                <HeaderAction financeMode onClick={() => setShowToolbarOverflowMenu((current) => !current)}>···</HeaderAction>
                {showToolbarOverflowMenu ? (
                  <ToolbarOverflowMenu items={financeToolbarActions} onSelect={handleToolbarOverflowAction} />
                ) : null}
              </div>
            </>
          ) : (
            <>
              {workspaceBotMode && onCloseWorkspace ? <HeaderAction onClick={onCloseWorkspace}>← Close</HeaderAction> : null}
              {workspaceBotMode && workspaceAccessMode === "demo" && onUpgradeToRealWorkspace ? (
                <HeaderAction onClick={requestRealWorkspaceUpgrade}>Use Real Workspace</HeaderAction>
              ) : null}
              {workspaceBotMode && workspaceAccessMode === "real" && onWorkspaceLogout ? (
                <HeaderAction onClick={onWorkspaceLogout}>Logout</HeaderAction>
              ) : null}
              {!workspaceBotMode && activeThread.linkedUserId && onOpenPersonalChat ? (
                <HeaderAction onClick={() => onOpenPersonalChat(activeThread.linkedUserId)}>
                  Personal chat
                </HeaderAction>
              ) : null}
              <HeaderAction>Call</HeaderAction>
              <HeaderAction>Video</HeaderAction>
              {workspaceAccessMode === "real" && activeWorkspace ? (
                <div className="relative" ref={notificationMenuRef}>
                  <HeaderAction
                    onClick={() => {
                      setShowNotificationMenu((current) => !current);
                      if (!showNotificationMenu) {
                        void onRefreshWorkspaceNotifications?.();
                      }
                    }}
                  >
                    <span className="relative inline-flex items-center gap-2">
                      <span>Bell</span>
                      {workspaceNotificationCount > 0 ? (
                        <span
                          className="inline-flex min-w-[22px] items-center justify-center rounded-full border px-1.5 py-0.5 text-[10px] font-bold"
                          style={notificationBadgeStyles}
                        >
                          {unreadNotificationLabel}
                        </span>
                      ) : null}
                    </span>
                  </HeaderAction>
                  {showNotificationMenu ? (
                    <WorkspaceNotificationMenu
                      unreadCount={workspaceNotificationCount}
                      notifications={workspaceNotifications}
                      loading={workspaceNotificationsLoading}
                      onOpenNotification={(notification) => {
                        setShowNotificationMenu(false);
                        void onOpenWorkspaceNotification?.(notification);
                      }}
                      onMarkAllRead={() => onMarkAllWorkspaceNotificationsRead?.()}
                      markAllLoading={markingAllWorkspaceNotificationsRead}
                    />
                  ) : null}
                </div>
              ) : (
                <HeaderAction>Bell</HeaderAction>
              )}
              <HeaderAction>Search</HeaderAction>
              <HeaderAction>Tools</HeaderAction>
            </>
          )}
        </div>
        </div>

        {!showWorkspaceMembersView && !showWorkspaceOverviewView ? (
          <div
            className="px-6"
            style={financeMode ? { borderBottom: "1px solid rgba(255,255,255,0.04)", background: "rgba(6,10,18,0.7)" } : { borderBottom: "1px solid #e2e8f0" }}
          >
            <div className="flex gap-4 py-3">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`px-0 py-2 text-sm font-semibold transition ${financeMode ? "rounded-none border-b-2" : "rounded-full px-4"}`}
                style={
                  financeMode
                    ? activeTab === tab
                      ? { color: "#fff", borderBottomColor: "#10b981" }
                      : { color: "#475569", borderBottomColor: "transparent" }
                    : activeTab === tab
                      ? { background: "#E8F2FF", color: "#2D8EFF" }
                      : { color: "#64748b" }
                }
              >
                {displayTabLabel(tab, financeMode)}
              </button>
            ))}
            </div>
          </div>
        ) : null}

        <div className="relative flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {showWorkspaceMembersView ? (
            <div className="flex-1 overflow-y-auto px-6 py-6">
              {workspaceAccessMode === "real" && canBootstrapManageFinanceMembers ? (
                <PlatformOwnerProvisioningPanel
                  currentUser={currentUser}
                  workspaces={platformWorkspaces}
                  loading={platformWorkspacesLoading}
                  selectedWorkspaceId={selectedPlatformWorkspaceId}
                  onSelectWorkspace={onSelectPlatformWorkspace}
                  onRefresh={onRefreshPlatformWorkspaces}
                  onCreateWorkspace={onCreatePlatformWorkspace}
                  creatingWorkspace={platformCreatingWorkspace}
                  onProvisionMember={onProvisionPlatformMember}
                  provisioningMember={platformProvisioningMember}
                />
              ) : null}
              {workspaceAccessMode === "real" && !canBootstrapManageFinanceMembers ? (
                <WorkspaceAdminOverviewPanel
                  workspace={activeWorkspace}
                  membership={activeWorkspaceMembership}
                  settings={workspaceSettings}
                  accountingEnabled={financeAccountingEnabled}
                  accountingEnabledAt={financeAccountingEnabledAt}
                  loading={workspaceSettingsLoading}
                  onRefresh={onRefreshWorkspaceSettings}
                  onEnableAccounting={onEnableWorkspaceAccounting}
                  enablingAccounting={workspaceAccountingEnabling}
                  onUpdateDefaultCurrency={onUpdateWorkspaceDefaultCurrency}
                  savingDefaultCurrency={workspaceDefaultCurrencySaving}
                  onInviteAccountant={onInviteAccountant}
                  invitingAccountant={invitingAccountant}
                  members={financeMembers}
                />
              ) : null}
              <div className={workspaceAccessMode === "real" ? "mt-6" : ""}>
              <WorkspaceMemberAccessPanel
                members={canBootstrapManageFinanceMembers ? platformWorkspaceMembers : financeMembers}
                loading={canBootstrapManageFinanceMembers ? platformWorkspaceMembersLoading : financeMembersLoading}
                canManage={canManageFinanceMembers}
                canBootstrapManage={canBootstrapManageFinanceMembers}
                workspaceScope={workspaceScope}
                currentUserId={currentUser.id}
                savingMemberId={canBootstrapManageFinanceMembers ? platformSavingMemberId : savingFinanceMemberId}
                onToggleRole={canBootstrapManageFinanceMembers ? onTogglePlatformFinanceRole : onToggleFinanceMemberRole}
                onUpdateWorkspaceAccess={canBootstrapManageFinanceMembers ? onUpdatePlatformMemberAccess : onUpdateFinanceMemberAccess}
                onRefresh={canBootstrapManageFinanceMembers ? onRefreshPlatformWorkspaceMembers : onRefreshFinanceMembers}
              />
              </div>
            </div>
          ) : null}

          {showWorkspaceOverviewView ? (
            <WorkspaceOverviewPanel
              financeMode={financeMode}
              workspaceScope={workspaceScope}
              overviewPressure={overviewPressure}
              financeMetricCards={financeMetricCards.filter((metric) => metric.id.startsWith("finance-"))}
              warehouseMetricCards={warehouseMetricCards}
              financeActivity={financeActivity}
              financeSummary={financeSummary}
              warehouseSummary={warehouseSummary}
              executionSummary={executionSummary}
              recentPayments={reportingWindow === "all" && Array.isArray(financeSummary?.recentPayments) && financeSummary.recentPayments.length
                ? financeSummary.recentPayments
                : recentPaymentActivity}
              recentShipments={recentShipmentEvents}
              operationsBridgePanel={operationsBridgePanel}
              onSelectMetric={onSelectMetric}
              onNavigate={onNavigateOverview}
              canManageOverview={canManageFinanceMembers}
            />
          ) : null}

          {activeTab === "Chat" && !showWorkspaceMembersView && !showWorkspaceOverviewView ? (
            <>
              <div className="flex-1 overflow-y-auto px-6 py-6" style={financeMode ? { background: "#0f1623" } : undefined}>
                {workspaceBotMode && workspaceAccessMode === "demo" ? (
                  <div
                    className="mb-4 rounded-[20px] p-4"
                    style={{
                      border: "1px solid rgba(16,185,129,0.16)",
                      background: "rgba(16,185,129,0.08)"
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        letterSpacing: "0.18em",
                        textTransform: "uppercase",
                        color: "#10b981",
                        fontWeight: 700
                      }}
                    >
                      Demo Workspace
                    </div>
                    <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.6, color: financeMode ? "#cbd5e1" : "#334155" }}>
                      You are viewing the demo version. Switch once to use the real workspace from now on.
                    </div>
                    {onUpgradeToRealWorkspace ? (
                      <button
                        type="button"
                        onClick={requestRealWorkspaceUpgrade}
                        style={{
                          marginTop: 14,
                          height: 40,
                          borderRadius: 12,
                          border: "1px solid rgba(16,185,129,0.34)",
                          background: "linear-gradient(135deg,#10b981,#059669)",
                          color: "#fff",
                          fontWeight: 700,
                          padding: "0 16px",
                          cursor: "pointer"
                        }}
                      >
                        Use Real Workspace
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {financeMode ? (
                  <FinanceHeroStrip metrics={financeMetricCards} onSelect={onSelectMetric} />
                ) : null}
                {financeMode && financeQueueSummary ? (
                  <div className="mb-6">
                    <FinanceQueueSummary summary={financeQueueSummary} />
                  </div>
                ) : null}
                <div className={`space-y-5 ${financeMode ? "max-w-[820px]" : ""}`}>
                  {projectLinkTargetMessage ? (
                    <div
                      className={`rounded-[22px] px-5 py-4 ${
                        financeMode
                          ? "border border-white/8 bg-white/[0.04]"
                          : "border border-slate-200 bg-slate-50"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${financeMode ? "text-slate-400" : "text-slate-500"}`}>
                            Attach to project
                          </p>
                          <p className={`mt-1 text-sm font-semibold ${financeMode ? "text-slate-100" : "text-slate-800"}`}>
                            Link this message to an existing project
                          </p>
                          <p className={`mt-2 text-sm leading-6 ${financeMode ? "text-slate-300" : "text-slate-600"}`}>
                            {projectLinkTargetExcerpt || "This message will be linked to the selected project for later review."}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={onCancelProjectLink}
                            className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                              financeMode
                                ? "border border-white/10 bg-white/5 text-slate-200"
                                : "border border-slate-200 bg-white text-slate-600 shadow-sm"
                            }`}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => onNavigateOverview?.({ scope: "projects" })}
                            className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                              financeMode
                                ? "border border-white/10 bg-white/5 text-slate-200"
                                : "border border-slate-200 bg-white text-slate-600 shadow-sm"
                            }`}
                          >
                            Open Projects
                          </button>
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <select
                          value={projectLinkSelectedProjectId}
                          onChange={(event) => onSelectProjectLink?.(event.target.value)}
                          disabled={projectLinkOptionsLoading || projectLinkSubmitting}
                          className={`min-w-[260px] rounded-2xl border px-4 py-3 text-sm outline-none ${
                            financeMode
                              ? "border-white/10 bg-slate-950 text-slate-100"
                              : "border-slate-200 bg-white text-slate-700"
                          }`}
                        >
                          <option value="">
                            {projectLinkOptionsLoading ? "Loading projects..." : "Select a project"}
                          </option>
                          {projectLinkOptions.map((project) => (
                            <option key={project.id} value={project.id}>
                              {project.name} · {project.status}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={onConfirmProjectLink}
                          disabled={!projectLinkSelectedProjectId || projectLinkSubmitting || projectLinkOptionsLoading}
                          className={`rounded-full px-4 py-2 text-sm font-semibold text-white ${
                            !projectLinkSelectedProjectId || projectLinkSubmitting || projectLinkOptionsLoading
                              ? "bg-slate-400"
                              : "bg-[#2D8EFF]"
                          }`}
                        >
                          {projectLinkSubmitting ? "Attaching..." : "Attach to project"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {linkedWorkMessages.length ? (
                    <div
                      className={`rounded-[22px] px-5 py-4 ${
                        financeMode
                          ? "border border-white/8 bg-white/[0.04]"
                          : "border border-slate-200 bg-slate-50"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${financeMode ? "text-slate-400" : "text-slate-500"}`}>
                            Linked work
                          </p>
                          <p className={`mt-1 text-sm ${financeMode ? "text-slate-200" : "text-slate-700"}`}>
                            {linkedWorkSummary.taskCount} task{linkedWorkSummary.taskCount === 1 ? "" : "s"} and {linkedWorkSummary.projectCount} project{linkedWorkSummary.projectCount === 1 ? "" : "s"} are now linked from this conversation.
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => onNavigateOverview?.({ scope: "tasks" })}
                            className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                              financeMode
                                ? "border border-white/10 bg-white/5 text-slate-200"
                                : "border border-slate-200 bg-white text-slate-600 shadow-sm"
                            }`}
                          >
                            Open Tasks
                          </button>
                          <button
                            type="button"
                            onClick={() => onNavigateOverview?.({ scope: "projects" })}
                            className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                              financeMode
                                ? "border border-white/10 bg-white/5 text-slate-200"
                                : "border border-slate-200 bg-white text-slate-600 shadow-sm"
                            }`}
                          >
                            Open Projects
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {linkedWorkSummary.recent.map((entry) => (
                          <button
                            type="button"
                            key={`linked-work-${entry.id}`}
                            onClick={() => onNavigateOverview?.({ scope: entry.kind === "project" ? "projects" : "tasks" })}
                            className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                              financeMode
                                ? "bg-white/6 text-slate-200 ring-1 ring-white/10"
                                : "bg-white text-slate-600 ring-1 ring-slate-200"
                            }`}
                          >
                            {entry.kind === "project" ? "Project" : "Task"} · {entry.title}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {activeThread.messages.length ? (
                    activeThread.messages.map((message) => (
                      <MessageBubble
                        key={message.id}
                        message={message}
                        currentUser={currentUser}
                        currentThread={activeThread}
                        role={role}
                        financeMode={financeMode}
                        reactions={reactions}
                        activePicker={activePicker}
                        setActivePicker={setActivePicker}
                        onReact={onReact}
                        resolveReactionUserName={resolveReactionUserName}
                        onApproveInvoice={handlers.onApproveInvoice}
                        onEditInvoice={handleEditInvoice}
                        onStartRejectInvoice={handlers.onStartRejectInvoice}
                        onRejectReasonChange={handlers.onRejectReasonChange}
                        onConfirmRejectInvoice={handlers.onConfirmRejectInvoice}
                        onReorderStart={handlers.onReorderStart}
                        onReorderChange={handlers.onReorderChange}
                        onReorderConfirm={handlers.onReorderConfirm}
                        onDismissStockAlert={handlers.onDismissStockAlert}
                        onMarkDelivered={handlers.onMarkDelivered}
                        onUpdateShipmentStatus={handlers.onUpdateWarehouseOrderStatus}
                        onExpenseNoteChange={handlers.onExpenseNoteChange}
                        onLogExpense={handlers.onLogExpense}
                        onApproveExpense={handlers.onApproveExpense}
                        onStartRejectExpense={handlers.onStartRejectExpense}
                        onRejectExpenseChange={handlers.onRejectExpenseChange}
                        onConfirmRejectExpense={handlers.onConfirmRejectExpense}
                        onStartReimburseExpense={handlers.onStartReimburseExpense}
                        onReimburseExpenseChange={handlers.onReimburseExpenseChange}
                        onConfirmReimburseExpense={handlers.onConfirmReimburseExpense}
                        onEditExpense={handleEditExpense}
                        financePermissions={financePermissions}
                        showFinanceAccounting={financeAccountingEnabled}
                        onMarkPaidInvoice={handleMarkPaidInvoice}
                        onDownloadInvoicePdf={handlers.onDownloadInvoicePdf}
                        downloadingInvoicePdfId={handlers.downloadingInvoicePdfId}
                        onIssueRecurringInvoice={handlers.onIssueRecurringInvoice}
                        onReconcileInvoice={handlers.onReconcileInvoice}
                        onReconcileExpense={handlers.onReconcileExpense}
                        canManageFinanceMembers={canManageFinanceMembers}
                        canCreateLinkedWork={canCreateLinkedWorkFromThread}
                        onCreateTaskFromMessage={onCreateTaskFromMessage}
                        onCreateProjectFromMessage={onCreateProjectFromMessage}
                        onAttachProjectMessage={onAttachProjectMessage}
                      />
                    ))
                  ) : (
                    <WorkspaceEmptyThreadState activeThread={activeThread} financeMode={financeMode} />
                  )}
                </div>
              </div>

              <div
                className="px-6 py-5"
                style={financeMode ? { borderTop: "1px solid rgba(255,255,255,0.05)", background: "rgba(6,10,18,0.7)" } : { borderTop: "1px solid #e2e8f0" }}
              >
                <div
                  className="relative rounded-2xl px-4 py-4"
                  style={
                    financeMode
                      ? {
                          border: "1px solid rgba(255,255,255,0.08)",
                          background: "rgba(255,255,255,0.05)",
                          boxShadow: "0 12px 30px rgba(0,0,0,0.25)"
                        }
                      : {
                          border: "1px solid #e2e8f0",
                          background: "#fff",
                          boxShadow: "0 1px 3px rgba(15,23,42,0.08)"
                        }
                  }
                >
                  {showCommandMenu ? (
                    <CommandMenu
                      items={commandItems}
                      activeIndex={activeCommandIndex}
                      onHoverItem={setActiveCommandIndex}
                      onInsertCommand={insertCommand}
                    />
                  ) : null}
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (draft.startsWith("/")) {
                        onRunCommand(draft);
                      } else {
                        onSendText();
                      }
                    }}
                    className="flex items-center gap-3"
                  >
                    <input
                      ref={inputRef}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (!showCommandMenu) {
                          return;
                        }

                        if (event.key === "ArrowDown") {
                          event.preventDefault();
                          setActiveCommandIndex((current) => (current + 1) % commandItems.length);
                          return;
                        }

                        if (event.key === "ArrowUp") {
                          event.preventDefault();
                          setActiveCommandIndex((current) => (current - 1 + commandItems.length) % commandItems.length);
                          return;
                        }

                        if (event.key === "Enter") {
                          event.preventDefault();
                          insertCommand(commandItems[activeCommandIndex].command);
                          return;
                        }

                        if (event.key === "Escape") {
                          event.preventDefault();
                          setCommandMenuDismissed(true);
                        }
                      }}
                      placeholder='Type "/" for commands'
                      className={`min-w-0 flex-1 border-none bg-transparent text-sm outline-none ${financeMode ? "text-slate-100 placeholder:text-slate-500" : "text-slate-700 placeholder:text-slate-400"}`}
                    />
                    <button
                      type="submit"
                      className="rounded-full px-5 py-2.5 text-sm font-bold text-white shadow-sm transition"
                      style={financeMode ? { background: "linear-gradient(135deg,#10b981,#059669)" } : { background: "#2D8EFF" }}
                    >
                      Send
                    </button>
                  </form>
                </div>
              </div>
            </>
          ) : null}

          {activeTab === "Media" && !showWorkspaceMembersView && !showWorkspaceOverviewView ? (
            financeMode ? (
              <div className="workspace-finance-shell flex-1 overflow-y-auto px-6 py-6">
                <div className="mb-4">
                  <h3 className="text-xl font-bold text-white">Finance workspace</h3>
                  <p className="mt-1 text-sm text-slate-400">
                    Review workflow pressure, customer records, payments, and accounting only when you need it.
                  </p>
                </div>
                <div className="workspace-finance-nav mb-6 flex flex-wrap gap-2">
                  {financeSections.map((section) => (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => setFinanceSection(section.id)}
                      className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                        financeSection === section.id
                          ? "text-white"
                          : "text-slate-400 hover:text-slate-100"
                      }`}
                      style={
                        financeSection === section.id
                          ? {
                              background: "linear-gradient(135deg, rgba(16,185,129,0.24), rgba(14,116,144,0.2))",
                              border: "1px solid rgba(16,185,129,0.32)"
                            }
                          : {
                              background: "rgba(255,255,255,0.04)",
                              border: "1px solid rgba(255,255,255,0.08)"
                            }
                      }
                    >
                      {section.label}
                    </button>
                  ))}
                </div>
                {financeSection === "reports" ? (
                  <>
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-white/8 bg-white/[0.04] px-4 py-3">
                      <div className="text-sm text-slate-300">
                        {financeFxRates?.live
                          ? `Live rates as of ${formatDateTime(financeFxRates.timestamp)}`
                          : "Approximate rates (static)"}
                      </div>
                      <button
                        type="button"
                        onClick={() => onLoadFinanceFxRates?.({ refresh: true })}
                        className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200"
                      >
                        Refresh rates
                      </button>
                    </div>
                    {operationsBridgePanel ? <div className="mb-6">{operationsBridgePanel}</div> : null}
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
                      <div className="grid gap-4 md:grid-cols-2">
                        {financeMetricCards.map((metric) => (
                          <StatCard key={metric.id} metric={metric} onSelect={onSelectMetric} financeMode />
                        ))}
                      </div>
                      <div>
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div>
                            <h4 className="text-sm font-bold uppercase tracking-[0.18em] text-slate-400">Recent Activity</h4>
                            <p className="mt-1 text-sm text-slate-500">Audit trail from FinanceBot actions.</p>
                          </div>
                        </div>
                        <FinanceActivityFeed actions={financeActivity.slice(0, 8)} />
                      </div>
                    </div>
                    <div className="mt-6">
                      <FinanceReportingSnapshot
                        statusBreakdown={reportingWindow === "all" && financeSummary?.invoiceStatusBreakdown
                          ? financeSummary.invoiceStatusBreakdown
                          : invoiceStatusBreakdown}
                        recurringSummary={{
                          templates: recurringLifecycleSummary.templates,
                          generated: reportingWindow === "all" && typeof financeSummary?.recurringGeneratedInvoices === "number"
                            ? financeSummary.recurringGeneratedInvoices
                            : recurringLifecycleSummary.generated,
                          due: recurringLifecycleSummary.due
                        }}
                        recentPayments={reportingWindow === "all" && Array.isArray(financeSummary?.recentPayments) && financeSummary.recentPayments.length
                          ? financeSummary.recentPayments
                          : recentPaymentActivity}
                        recurringTemplates={recurringTemplateHistory}
                      />
                    </div>
                    <FinanceAdvancedReportsPanel
                      workspaceDefaultCurrency={workspaceDefaultCurrency}
                      financeSummary={financeSummary}
                      financeTaxSummary={financeTaxSummary}
                      financeProfitLossReport={financeProfitLossReport}
                      financeCashFlowReport={financeCashFlowReport}
                      financeAgedReceivablesReport={financeAgedReceivablesReport}
                      financeBalanceSheetReport={financeBalanceSheetReport}
                      onLoadFinanceTaxSummary={onLoadFinanceTaxSummary}
                      onLoadFinanceProfitLossReport={onLoadFinanceProfitLossReport}
                      onLoadFinanceCashFlowReport={onLoadFinanceCashFlowReport}
                      onLoadFinanceAgedReceivablesReport={onLoadFinanceAgedReceivablesReport}
                      onLoadFinanceBalanceSheetReport={onLoadFinanceBalanceSheetReport}
                    />
                  </>
                ) : null}
                {(financeSection === "invoices" || financeSection === "expenses") ? (
                  <div className="mb-6">
                    <FinanceFilterToolbar
                      customerOptions={financeCustomers.filter((customer) => customer.status !== "inactive")}
                      vendorOptions={financeVendors.filter((vendor) => vendor.status !== "inactive")}
                      invoiceFilter={invoiceFilter}
                      expenseFilter={expenseFilter}
                      reportingWindow={reportingWindow}
                      onInvoiceFilterChange={(field, value) => setInvoiceFilter((current) => ({ ...current, [field]: value }))}
                      onExpenseFilterChange={(field, value) => setExpenseFilter((current) => ({ ...current, [field]: value }))}
                      onReportingWindowChange={setReportingWindow}
                    />
                  </div>
                ) : null}
                {financeSection === "invoices" ? (
                  <>
                    <div className={`grid gap-6 ${financeRouteDetailKind === "invoice" ? "" : "xl:grid-cols-[minmax(0,0.95fr)_minmax(340px,1.05fr)]"}`}>
                      {financeRouteDetailKind === "invoice" ? null : (
                      <div className="space-y-6">
                        <FinanceRecordDigest
                          title="Invoice workflow"
                          subtitle="Review invoices by customer, status, and payment state."
                          items={filteredInvoiceMessages.slice(0, 8)}
                          kind="invoice"
                          selectedItemId={selectedInvoiceMessage?.id || ""}
                          onSelectItem={(item) => handleSelectFinanceRecord("invoice", item)}
                        />
                        <FinanceOperationalInsights
                          recurringDueInvoices={recurringDueInvoices.map((message) => ({
                            id: message.metadata.invoiceId,
                            invoiceNumber: message.metadata.invoiceNumber,
                            companyName: message.metadata.companyName,
                            recurring: message.metadata.recurring
                          }))}
                          partialPaymentInvoices={partialPaymentInvoices.map((message) => ({
                            id: message.metadata.invoiceId,
                            invoiceNumber: message.metadata.invoiceNumber,
                            companyName: message.metadata.companyName,
                            currency: message.metadata.currency,
                            outstandingAmount: message.metadata.outstandingAmount,
                            payments: message.metadata.payments || []
                          }))}
                          topCustomers={financeSummary?.topCustomersOwed?.length ? financeSummary.topCustomersOwed : customerBalanceRows}
                          topVendors={financeSummary?.topVendors?.length ? financeSummary.topVendors : vendorUsageRows}
                          canIssueRecurring={financePermissions?.canEdit}
                          issuingInvoiceId={issuingRecurringInvoiceId}
                          onIssueRecurring={(invoice) => handleIssueRecurringInvoice({ metadata: { invoiceId: invoice.id } })}
                        />
                      </div>
                      )}
                      <div>
                        {(selectedInvoiceMessage || selectedFinanceRecordDetail) ? (
                          selectedFinanceRecordLoading ? (
                            <div className="rounded-[24px] border border-white/8 bg-white/5 px-4 py-4 text-sm text-slate-400">
                              Loading invoice detail...
                            </div>
                          ) : (
                            <FinanceInvoiceDetailPanel
                              detail={selectedFinanceRecordDetail}
                              message={selectedInvoiceMessage}
                              canApprove={financePermissions?.canApprove}
                              canMarkPaid={financePermissions?.canEdit}
                              canReconcile={financePermissions?.canReconcile}
                              downloadingPdf={downloadingInvoicePdfId === (selectedInvoiceMessage?.metadata?.invoiceId || selectedFinanceRecordDetail?.id)}
                              onBack={() => {
                                setSelectedFinanceRecord(null);
                                setSelectedFinanceRecordDetail(null);
                                updateFinanceHashRoute("", "");
                              }}
                              onApprove={handlers.onApproveInvoice}
                              onReject={handlers.onConfirmRejectInvoice}
                              onRecordPayment={handleMarkPaidInvoice}
                              onReconcile={handlers.onReconcileInvoice}
                              onDownloadPdf={handlers.onDownloadInvoicePdf}
                            />
                          )
                        ) : (
                          <div className="rounded-[24px] border border-white/8 bg-white/5 px-5 py-5 text-sm text-slate-400">
                            Select an invoice to open the full detail screen, payment history, and accounting context.
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                ) : null}
                {financeSection === "expenses" ? (
                  <div className={`grid gap-6 ${financeRouteDetailKind === "expense" ? "" : "xl:grid-cols-[minmax(0,0.95fr)_minmax(340px,1.05fr)]"}`}>
                    {financeRouteDetailKind === "expense" ? null : (
                    <div className="space-y-6">
                      <FinanceRecordDigest
                        title="Expense workflow"
                        subtitle="Review expense approvals, reimbursement state, and reconciliation work."
                        items={filteredExpenseMessages.slice(0, 8)}
                        kind="expense"
                        selectedItemId={selectedExpenseMessage?.id || ""}
                        onSelectItem={(item) => handleSelectFinanceRecord("expense", item)}
                      />
                      <div
                        className="rounded-[26px] border border-white/8 bg-white/[0.04] px-5 py-5"
                      >
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Expense snapshot</div>
                        <div className="mt-4 space-y-4">
                          <div className="rounded-[18px] border border-white/8 bg-slate-950/40 px-4 py-4">
                            <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Pending approval</div>
                            <div className="mt-2 text-2xl font-bold text-white">
                              {financeSummary?.pendingExpenses ?? filteredExpenseMessages.filter((message) => message.metadata.status === "pending_review").length}
                            </div>
                          </div>
                          <div className="rounded-[18px] border border-white/8 bg-slate-950/40 px-4 py-4">
                            <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Reconcile queue</div>
                            <div className="mt-2 text-2xl font-bold text-white">
                              {financeQueueSummary?.reconcileCount || 0}
                            </div>
                          </div>
                          <div className="rounded-[18px] border border-white/8 bg-slate-950/40 px-4 py-4">
                            <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Tracked vendors</div>
                            <div className="mt-2 text-2xl font-bold text-white">{financeVendors.length}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                    )}
                    <div>
                      {(selectedExpenseMessage || selectedFinanceRecordDetail) ? (
                        selectedFinanceRecordLoading ? (
                          <div className="rounded-[24px] border border-white/8 bg-white/5 px-4 py-4 text-sm text-slate-400">
                            Loading expense detail...
                          </div>
                        ) : (
                          <FinanceExpenseDetailPanel
                            detail={selectedFinanceRecordDetail}
                            message={selectedExpenseMessage}
                            canApprove={canManageFinanceMembers}
                            canEdit={financePermissions?.canEdit}
                            canReconcile={financePermissions?.canReconcile}
                            onBack={() => {
                              setSelectedFinanceRecord(null);
                              setSelectedFinanceRecordDetail(null);
                              updateFinanceHashRoute("", "");
                            }}
                            onApprove={handlers.onApproveExpense}
                            onReject={handlers.onConfirmRejectExpense}
                            onReimburse={handlers.onConfirmReimburseExpense}
                            onReconcile={handlers.onReconcileExpense}
                          />
                        )
                      ) : (
                        <div className="rounded-[24px] border border-white/8 bg-white/5 px-5 py-5 text-sm text-slate-400">
                          Select an expense to open the full detail screen, receipt, and accounting context.
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
                {financeSection === "customers" ? (
                  <>
                    <FinanceRelationshipSummary customers={financeCustomers} vendors={financeVendors} />
                    <div className="mt-6 grid gap-6 xl:grid-cols-2">
                      <FinanceContactManagerPanel
                        title="Customer records"
                        kind="customer"
                        items={financeCustomers}
                        accent="#10b981"
                        saving={financeContactSavingKind === "customer"}
                        canManage={financePermissions?.canCreate}
                        onSave={(payload) => handleSaveFinanceContact("customer", payload)}
                      />
                      <FinanceContactManagerPanel
                        title="Vendor records"
                        kind="vendor"
                        items={financeVendors}
                        accent="#38bdf8"
                        saving={financeContactSavingKind === "vendor"}
                        canManage={financePermissions?.canCreate}
                        onSave={(payload) => handleSaveFinanceContact("vendor", payload)}
                      />
                    </div>
                  </>
                ) : null}
                {financeSection === "payments" ? (
                  <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)]">
                    <div className="rounded-[26px] border border-white/8 bg-white/[0.04] px-5 py-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Recent payments</div>
                          <div className="mt-1 text-sm text-slate-400">Latest settled invoice activity across the workspace.</div>
                        </div>
                      </div>
                      <div className="mt-4 space-y-3">
                        {(reportingWindow === "all" && Array.isArray(financeSummary?.recentPayments) && financeSummary.recentPayments.length
                          ? financeSummary.recentPayments
                          : recentPaymentActivity
                        ).slice(0, 8).map((payment, index) => (
                          <div
                            key={`finance-payment-row-${payment.id || payment.invoiceId || index}`}
                            className="rounded-[18px] border border-white/8 bg-slate-950/40 px-4 py-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold text-white">{payment.invoiceNumber || payment.companyName || "Invoice payment"}</div>
                                <div className="mt-1 text-xs text-slate-500">
                                  {(payment.customerName || payment.companyName || "Customer")} · {formatPaymentMethod(payment.method)}
                                </div>
                              </div>
                              <div className="text-sm font-semibold text-emerald-300">
                                {formatMoney(payment.amount || 0, payment.currency || "USD")}
                              </div>
                            </div>
                            <div className="mt-2 text-xs text-slate-500">
                              {payment.reference ? `${payment.reference} · ` : ""}{formatDateTime(payment.recordedAt || payment.createdAt || new Date().toISOString())}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-6">
                      <FinanceActivityFeed actions={financeActivity.filter((action) => ["paid", "reconciled"].includes(action.action)).slice(0, 8)} />
                      <FinanceOperationalInsights
                        recurringDueInvoices={[]}
                        partialPaymentInvoices={partialPaymentInvoices.map((message) => ({
                          id: message.metadata.invoiceId,
                          invoiceNumber: message.metadata.invoiceNumber,
                          companyName: message.metadata.companyName,
                          currency: message.metadata.currency,
                          outstandingAmount: message.metadata.outstandingAmount,
                          payments: message.metadata.payments || []
                        }))}
                        topCustomers={financeSummary?.topCustomersOwed?.length ? financeSummary.topCustomersOwed : customerBalanceRows}
                        topVendors={financeSummary?.topVendors?.length ? financeSummary.topVendors : vendorUsageRows}
                        canIssueRecurring={false}
                        issuingInvoiceId={null}
                        onIssueRecurring={() => {}}
                      />
                    </div>
                  </div>
                ) : null}
                {financeSection === "banks" ? (
                  <FinanceBankingPanel
                    workspaceDefaultCurrency={workspaceDefaultCurrency}
                    bankAccounts={financeBankAccounts}
                    bankTransactions={financeBankTransactions}
                    financeFxRates={financeFxRates}
                    expenses={filteredExpenseMessages}
                    payments={reportingWindow === "all" && Array.isArray(financeSummary?.recentPayments) && financeSummary.recentPayments.length
                      ? financeSummary.recentPayments
                      : recentPaymentActivity}
                    onCreateBankAccount={onCreateBankAccount}
                    onCreatePlaidBankAccount={onCreatePlaidBankAccount}
                    onUpdateBankAccount={onUpdateBankAccount}
                    onDeleteBankAccount={onDeleteBankAccount}
                    onCreateBankTransaction={onCreateBankTransaction}
                    onSyncBankTransactions={onSyncBankTransactions}
                    onSyncPlaidAccount={onSyncPlaidAccount}
                    onRefreshPlaidBalance={onRefreshPlaidBalance}
                    onAutoMatchBankTransactions={onAutoMatchBankTransactions}
                    onMatchBankTransactionExpense={onMatchBankTransactionExpense}
                    onMatchBankTransactionPayment={onMatchBankTransactionPayment}
                    onReconcileBankTransaction={onReconcileBankTransaction}
                    onReconcileMatchedBankTransactions={onReconcileMatchedBankTransactions}
                  />
                ) : null}
                {financeSection === "payroll" ? (
                  <FinancePayrollPanel
                    workspaceDefaultCurrency={workspaceDefaultCurrency}
                    payrollRecords={financePayrollRecords}
                    canManage={canManageFinanceMembers}
                    onCreatePayrollRecord={onCreatePayrollRecord}
                    onApprovePayrollRecord={onApprovePayrollRecord}
                    onPayPayrollRecord={onPayPayrollRecord}
                    onCancelPayrollRecord={onCancelPayrollRecord}
                  />
                ) : null}
                {financeSection === "accounting" && financeAccountingEnabled ? (
                  <>
                    <Suspense
                      fallback={
                        <div className="mb-6 rounded-[24px] border border-white/8 bg-white/5 px-4 py-4 text-sm text-slate-400">
                          Loading accounting workspace...
                        </div>
                      }
                    >
                      <FinanceAccountingAnalytics
                        section="top"
                        reportingWindow={reportingWindow}
                        accountingExporting={accountingExporting}
                        onExportAccountingStatementVariant={handleExportAccountingStatementVariant}
                        onExportAccountingJournals={handleExportAccountingJournals}
                        onPrintFinanceReport={handlePrintFinanceReport}
                        activeWorkspace={activeWorkspace}
                        financeSummary={financeSummary}
                        canManageFinanceControls={canManageFinanceControls}
                        selectedLockPeriodKey={selectedLockPeriodKey}
                        onSelectLockPeriodKey={setSelectedLockPeriodKey}
                        onLockFinancePeriod={handleLockFinancePeriod}
                        onUnlockFinancePeriod={handleUnlockFinancePeriod}
                        financeControlAction={financeControlAction}
                      />
                    </Suspense>
                    <Suspense
                      fallback={
                        <div className="mt-6 rounded-[24px] border border-white/8 bg-white/5 px-4 py-4 text-sm text-slate-400">
                          Loading accounting workspace...
                        </div>
                      }
                    >
                      <FinanceAccountingAnalytics
                        section="bottom"
                        financeSummary={financeSummary}
                        reportingWindow={reportingWindow}
                        onSelectAccount={setSelectedAccountingAccountCode}
                        selectedAccountCode={selectedAccountingAccountCode}
                        accountDrilldown={accountDrilldown}
                        accountDrilldownLoading={accountDrilldownLoading}
                      />
                    </Suspense>
                  </>
                ) : null}
                {financeSection === "accountant" && financePermissions?.isAccountant ? (
                  <FinanceAccountantPortalPanel
                    accountantSummary={financeAccountantSummary}
                    canExport={financeAccountingEnabled}
                  />
                ) : null}
              </div>
            ) : (
              <div className="workspace-warehouse-shell">
                <WarehouseAnalyticsPanel
                  summary={warehouseSummary}
                  products={warehouseProducts}
                  orders={warehouseOrders}
                  alerts={warehouseAlerts}
                  purchaseOrders={warehousePurchaseOrders}
                  inventoryValueReport={warehouseInventoryValueReport}
                  financeVendors={financeVendors}
                  metrics={metricCards.filter((metric) => metric.id.startsWith("warehouse-") || metric.id.startsWith("ops-"))}
                  onSelectMetric={onSelectMetric}
                  bridgePanel={operationsBridgePanel}
                  canManageStock={canManageWarehouseStock}
                  onAdjustStock={handlers.onAdjustWarehouseStock}
                  onSaveProduct={createWarehouseProductEntry}
                  onLoadProductMovementReview={onLoadWarehouseProductMovementReview}
                  canManageShipments={canManageWarehouseStock}
                  onUpdateShipmentStatus={handlers.onUpdateWarehouseOrderStatus}
                  onLoadShipmentReview={onLoadWarehouseOrderReview}
                  onSavePurchaseOrder={handleSavePurchaseOrder}
                  onSendPurchaseOrder={handleSendPurchaseOrder}
                  onReceivePurchaseOrder={handleReceivePurchaseOrder}
                  onCancelPurchaseOrder={handleCancelPurchaseOrder}
                  workspaceDefaultCurrency={workspaceDefaultCurrency}
                  onOpenFinanceExpense={(expense) => {
                    if (!expense?.id) {
                      return;
                    }
                    handleOverviewNavigate({ scope: "finance", tab: "Media", metricId: "finance-expenses" });
                  }}
                />
              </div>
            )
          ) : null}

          {activeTab === "Links" && !showWorkspaceMembersView && !showWorkspaceOverviewView ? (
            financeMode ? (
              <div className="flex-1 overflow-y-auto px-6 py-6">
                <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-bold text-white">Approvals queue</h3>
                    <p className="mt-1 text-sm text-slate-400">
                      Review what needs a decision, payment, or reconciliation right now.
                    </p>
                  </div>
                  <div
                    className="rounded-[18px] px-4 py-3"
                    style={{
                      border: "1px solid rgba(255,255,255,0.08)",
                      background: "rgba(255,255,255,0.04)"
                    }}
                  >
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Open items</div>
                    <div
                      style={{
                        marginTop: 6,
                        fontFamily: '"Sora","Manrope","DM Sans","Segoe UI",sans-serif',
                        fontSize: 28,
                        fontWeight: 800,
                        lineHeight: 1,
                        color: "#f8fafc"
                      }}
                    >
                      {financeApprovalCount}
                    </div>
                  </div>
                </div>

                {financeQueueSummary ? (
                  <div className="mb-6">
                    <FinanceQueueSummary summary={financeQueueSummary} compact />
                  </div>
                ) : null}

                {financeApprovalSections.length ? (
                  <div className="space-y-6">
                    {financeApprovalSections.map((section) => (
                      <section
                        key={section.id}
                        className="rounded-[24px] p-5"
                        style={{
                          border: "1px solid rgba(255,255,255,0.08)",
                          background: "linear-gradient(180deg,#111827 0%,#10192a 100%)",
                          boxShadow: "0 12px 32px rgba(0,0,0,0.28)"
                        }}
                      >
                        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div
                              className="text-[11px] font-semibold uppercase tracking-[0.18em]"
                              style={{ color: section.accent }}
                            >
                              {section.title}
                            </div>
                            <p className="mt-1 text-sm text-slate-400">{section.description}</p>
                          </div>
                          <div
                            className="rounded-full px-3 py-1 text-xs font-bold"
                            style={{
                              border: `1px solid ${section.accent}44`,
                              background: `${section.accent}18`,
                              color: section.accent
                            }}
                          >
                            {section.items.length} item{section.items.length === 1 ? "" : "s"}
                          </div>
                        </div>

                        <div className="space-y-5">
                          {section.items.map((message) => (
                            <MessageBubble
                              key={`${section.id}-${message.id}`}
                              message={message}
                              currentUser={currentUser}
                              currentThread={activeThread}
                              role={role}
                              financeMode={financeMode}
                              reactions={reactions}
                              activePicker={activePicker}
                              setActivePicker={setActivePicker}
                              onReact={onReact}
                              resolveReactionUserName={resolveReactionUserName}
                              showFinanceAccounting={financeAccountingEnabled}
                              onApproveInvoice={handlers.onApproveInvoice}
                              onEditInvoice={handleEditInvoice}
                              onStartRejectInvoice={handlers.onStartRejectInvoice}
                              onRejectReasonChange={handlers.onRejectReasonChange}
                              onConfirmRejectInvoice={handlers.onConfirmRejectInvoice}
                              onReorderStart={handlers.onReorderStart}
                              onReorderChange={handlers.onReorderChange}
                              onReorderConfirm={handlers.onReorderConfirm}
                              onDismissStockAlert={handlers.onDismissStockAlert}
                              onMarkDelivered={handlers.onMarkDelivered}
                              onUpdateShipmentStatus={handlers.onUpdateWarehouseOrderStatus}
                              onExpenseNoteChange={handlers.onExpenseNoteChange}
                              onLogExpense={handlers.onLogExpense}
                              onApproveExpense={handlers.onApproveExpense}
                              onStartRejectExpense={handlers.onStartRejectExpense}
                              onRejectExpenseChange={handlers.onRejectExpenseChange}
                              onConfirmRejectExpense={handlers.onConfirmRejectExpense}
                              onStartReimburseExpense={handlers.onStartReimburseExpense}
                              onReimburseExpenseChange={handlers.onReimburseExpenseChange}
                              onConfirmReimburseExpense={handlers.onConfirmReimburseExpense}
                              onEditExpense={handleEditExpense}
                              financePermissions={financePermissions}
                              onMarkPaidInvoice={handleMarkPaidInvoice}
                              onDownloadInvoicePdf={handlers.onDownloadInvoicePdf}
                              downloadingInvoicePdfId={handlers.downloadingInvoicePdfId}
                              onIssueRecurringInvoice={handlers.onIssueRecurringInvoice}
                              onReconcileInvoice={handlers.onReconcileInvoice}
                              onReconcileExpense={handlers.onReconcileExpense}
                              canManageFinanceMembers={canManageFinanceMembers}
                            />
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                ) : (
                  <div
                    className="grid place-items-center rounded-[24px] px-6 py-16 text-center"
                    style={{
                      border: "1px solid rgba(255,255,255,0.08)",
                      background: "linear-gradient(180deg,#111827 0%,#10192a 100%)"
                    }}
                  >
                    <div>
                      <p className="text-lg font-semibold text-slate-100">All caught up</p>
                      <p className="mt-2 max-w-md text-sm text-slate-400">
                        There are no pending finance approvals, payments, or reconciliation tasks right now.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className={`grid flex-1 place-items-center px-6 py-6 text-center ${financeMode ? "text-slate-500" : "text-slate-500"}`}>
                <div>
                  <p className={`text-lg font-semibold ${financeMode ? "text-slate-100" : "text-slate-700"}`}>{displayTabLabel("Links", financeMode)}</p>
                  <p className="mt-2 max-w-md text-sm">{financeMode ? "Approval queues, invoice links, and review shortcuts can surface here." : "Quick links to invoice PDFs, stock sheets, and shipment documents will show up here."}</p>
                </div>
              </div>
            )
          ) : null}

          {activeTab === "Pinned" && !showWorkspaceMembersView && !showWorkspaceOverviewView ? (
            <div className="flex-1 overflow-y-auto px-6 py-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className={`text-xl font-bold ${financeMode ? "text-white" : "text-slate-900"}`}>{financeMode ? "Pinned dashboard" : "Pinned dashboard"}</h3>
                  <p className="text-sm text-slate-500">Live metrics tied to this business thread.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setDetailMetric(null)}
                  className="rounded-full px-4 py-2 text-sm font-semibold shadow-sm"
                  style={
                    financeMode
                      ? {
                          border: "1px solid rgba(255,255,255,0.08)",
                          background: "rgba(255,255,255,0.05)",
                          color: "#cbd5e1"
                        }
                      : undefined
                  }
                >
                  Refresh
                </button>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {visiblePinnedMetrics.map((metric) => (
                  <StatCard key={metric.id} metric={metric} onSelect={onSelectMetric} financeMode={financeMode} />
                ))}
              </div>
            </div>
          ) : null}
          </div>

          <AnimatePresence>
            {detailMetric ? (
              <motion.aside
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              className="absolute right-0 top-0 h-full w-[320px] p-5"
              style={
                financeMode
                  ? {
                      borderLeft: "1px solid rgba(255,255,255,0.08)",
                      background: "linear-gradient(180deg,#0f1623,#111827)",
                      boxShadow: "-20px 0 60px rgba(0,0,0,0.4)"
                    }
                  : undefined
              }
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Metric detail</p>
                  <h4 className={`mt-2 text-lg font-bold ${financeMode ? "text-white" : "text-slate-900"}`}>{detailMetric.label}</h4>
                </div>
                <button
                  type="button"
                  onClick={() => setDetailMetric(null)}
                  className="rounded-full px-3 py-1 text-sm font-semibold"
                  style={
                    financeMode
                      ? {
                          border: "1px solid rgba(255,255,255,0.08)",
                          color: "#94a3b8"
                        }
                      : undefined
                  }
                >
                  Close
                </button>
              </div>
              <div
                className="mt-5 rounded-2xl p-4"
                style={
                  financeMode
                    ? {
                        background: "#111827",
                        border: "1px solid rgba(255,255,255,0.08)"
                      }
                    : undefined
                }
              >
                <p className={`text-3xl font-bold ${financeMode ? "text-slate-50" : "text-slate-900"}`}>{detailMetric.value}</p>
                {detailMetric.subvalue ? <p className="mt-2 text-sm font-medium text-slate-500">{detailMetric.subvalue}</p> : null}
              </div>
              <p className={`mt-4 text-sm leading-6 ${financeMode ? "text-slate-400" : "text-slate-600"}`}>{metricDescription(detailMetric)}</p>
              {financeMode ? (
                <div className="mt-5">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Recent Finance Activity</p>
                  <FinanceActivityFeed actions={financeActivity.slice(0, 4)} compact />
                </div>
              ) : null}
              {detailMetric?.id === "ops-attention" ? (
                <div className="mt-5">
                  <p className={`mb-3 text-xs font-semibold uppercase tracking-[0.18em] ${financeMode ? "text-slate-400" : "text-slate-500"}`}>Cross-module coordination</p>
                  <div className="space-y-3">
                    {[
                      financeSummary?.overdueInvoices
                        ? {
                            id: "ops-overdue",
                            title: `${financeSummary.overdueInvoices} overdue invoice${financeSummary.overdueInvoices === 1 ? "" : "s"}`,
                            detail: `${formatMoneyDisplay(financeSummary?.overdueAmount || 0)} needs follow-up`
                          }
                        : null,
                      warehouseSummary?.reorderAttention
                        ? {
                            id: "ops-reorder",
                            title: `${warehouseSummary.reorderAttention} product${warehouseSummary.reorderAttention === 1 ? "" : "s"} need reorder`,
                            detail: `${warehouseSummary.lowStockItems || warehouseSummary.reorderAttention} low-stock signal${Number(warehouseSummary.lowStockItems || warehouseSummary.reorderAttention) === 1 ? "" : "s"} active`
                          }
                        : null,
                      warehouseSummary?.delayedOrders
                        ? {
                            id: "ops-delayed",
                            title: `${warehouseSummary.delayedOrders} delayed shipment${warehouseSummary.delayedOrders === 1 ? "" : "s"}`,
                            detail: "Operational timing is slipping in the warehouse flow."
                          }
                        : null
                    ].filter(Boolean).map((item) => (
                      <div
                        key={item.id}
                        className="rounded-[16px] px-4 py-3"
                        style={
                          financeMode
                            ? { border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.05)" }
                            : { border: "1px solid #e2e8f0", background: "#f8fafc" }
                        }
                      >
                        <div className={`text-sm font-semibold ${financeMode ? "text-slate-100" : "text-slate-900"}`}>{item.title}</div>
                        <div className="mt-1 text-xs text-slate-500">{item.detail}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-5">
                    <p className={`mb-3 text-xs font-semibold uppercase tracking-[0.18em] ${financeMode ? "text-slate-400" : "text-slate-500"}`}>Recent shared flow</p>
                    <div className="space-y-3">
                      {[
                        ...(reportingWindow === "all" && Array.isArray(financeSummary?.recentPayments) && financeSummary.recentPayments.length
                          ? financeSummary.recentPayments
                          : recentPaymentActivity
                        ).slice(0, 2).map((payment) => ({
                          id: `ops-payment-${payment.id}`,
                          title: `${payment.invoiceNumber} payment`,
                          detail: `${payment.customerName} · ${formatMoney(payment.amount, payment.currency)}`,
                          meta: formatDateTime(payment.recordedAt)
                        })),
                        ...recentShipmentEvents.slice(0, 2).map((shipment) => ({
                          id: `ops-shipment-${shipment.id}`,
                          title: `${shipment.orderNumber} ${warehouseStatusLabel(shipment.status).toLowerCase()}`,
                          detail: `${shipment.destination} · ${warehouseShipmentTypeLabel(shipment.shipmentType)}`,
                          meta: formatDateTime(shipment.updatedAt || shipment.createdAt || shipment.estimatedDelivery)
                        }))
                      ].slice(0, 4).map((item) => (
                        <div
                          key={item.id}
                          className="rounded-[16px] px-4 py-3"
                          style={
                            financeMode
                              ? { border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.05)" }
                              : { border: "1px solid #e2e8f0", background: "#f8fafc" }
                          }
                        >
                          <div className={`text-sm font-semibold ${financeMode ? "text-slate-100" : "text-slate-900"}`}>{item.title}</div>
                          <div className="mt-1 text-xs text-slate-500">{item.detail}</div>
                          <div className="mt-2 text-xs text-slate-500">{item.meta}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
              {financeMode && detailMetric?.id === "finance-outstanding" ? (
                <div className="mt-5">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Top open balances</p>
                  <div className="space-y-3">
                    {(financeSummary?.topCustomersOwed?.length ? financeSummary.topCustomersOwed : customerBalanceRows).slice(0, 4).map((item) => (
                      <div key={item.name} className="rounded-[16px] border border-white/8 bg-white/5 px-4 py-3">
                        <div className="text-sm font-semibold text-slate-100">{item.name}</div>
                        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-400">
                          <span>{item.invoiceCount} invoice{item.invoiceCount === 1 ? "" : "s"}</span>
                          <span className="text-amber-200">{formatMoneyDisplay((item.outstandingAmountByCurrency ?? item.outstandingAmount) || 0)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {paymentContextInvoices.length ? (
                    <div className="mt-5">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Latest payment context on open invoices</p>
                      <div className="space-y-3">
                        {paymentContextInvoices.map((item) => (
                          <div key={item.id} className="rounded-[16px] border border-white/8 bg-white/5 px-4 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold text-slate-100">{item.invoiceNumber}</div>
                                <div className="mt-1 text-xs text-slate-400">{item.customerName}</div>
                              </div>
                              <div className="text-xs text-amber-200">{formatMoney(item.outstandingAmount || 0, item.currency)} open</div>
                            </div>
                            {item.latestPayment ? (
                              <div className="mt-3 rounded-[14px] border border-white/8 bg-white/5 px-3 py-3 text-xs text-slate-300">
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <div>{formatPaymentMethod(item.latestPayment.method)}{item.latestPayment.reference ? ` · Ref ${item.latestPayment.reference}` : ""}</div>
                                    <div className="mt-1 text-slate-500">{formatDateTime(item.latestPayment.recordedAt)}</div>
                                    {item.latestPayment.note ? <div className="mt-2 text-slate-500">{item.latestPayment.note}</div> : null}
                                  </div>
                                  <div className="text-right">
                                    <div>{formatMoney(item.latestPayment.amount || 0, item.currency)}</div>
                                    <div className="mt-1 text-slate-500">{item.latestPayment.recordedBy?.name || "Finance staff"}</div>
                                  </div>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {financeMode && detailMetric?.id === "finance-paid" ? (
                <div className="mt-5">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Recent payment history</p>
                  <div className="space-y-3">
                    {(reportingWindow === "all" && Array.isArray(financeSummary?.recentPayments) && financeSummary.recentPayments.length
                      ? financeSummary.recentPayments
                      : recentPaymentActivity
                    ).slice(0, 4).map((payment) => (
                      <div key={payment.id} className="rounded-[16px] border border-white/8 bg-white/5 px-4 py-3">
                        <div className="text-sm font-semibold text-slate-100">{payment.invoiceNumber}</div>
                        <div className="mt-1 text-xs text-slate-400">{payment.customerName}</div>
                        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500">
                          <span>{formatDateTime(payment.recordedAt)}</span>
                          <span className="text-emerald-300">{formatMoney(payment.amount, payment.currency)}</span>
                        </div>
                        <div className="mt-2 text-xs text-slate-500">
                          {formatPaymentMethod(payment.method)}
                          {payment.reference ? ` · Ref ${payment.reference}` : ""}
                        </div>
                        {payment.note ? <div className="mt-2 text-xs text-slate-500">{payment.note}</div> : null}
                        {payment.recordedBy?.name ? <div className="mt-1 text-xs text-slate-500">Recorded by {payment.recordedBy.name}</div> : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {financeMode && detailMetric?.id === "finance-overdue" ? (
                <div className="mt-5">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Overdue invoices</p>
                  <div className="space-y-3">
                    {overdueInvoiceMessages.slice(0, 4).map((invoice) => (
                      <div key={invoice.metadata.invoiceId} className="rounded-[16px] border border-white/8 bg-white/5 px-4 py-3">
                        <div className="text-sm font-semibold text-slate-100">{invoice.metadata.invoiceNumber}</div>
                        <div className="mt-1 text-xs text-slate-400">{invoice.metadata.companyName}</div>
                        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-400">
                          <span>Due {formatDate(invoice.metadata.dueDate)}</span>
                          <span className="text-rose-300">{formatMoney(invoice.metadata.outstandingAmount || 0, invoice.metadata.currency)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {recurringTemplateHistory.some((template) => template.dueNow) ? (
                    <div className="mt-5">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Recurring templates due to issue</p>
                      <div className="space-y-3">
                        {recurringTemplateHistory.filter((template) => template.dueNow).slice(0, 4).map((template) => (
                          <div key={template.id} className="rounded-[16px] border border-amber-400/20 bg-amber-500/5 px-4 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold text-slate-100">{template.invoiceNumber}</div>
                                <div className="mt-1 text-xs text-slate-400">{template.customerName}</div>
                                <div className="mt-2 text-xs text-slate-500">
                                  Next issue {template.nextIssueDate ? formatDate(template.nextIssueDate) : "not scheduled"}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-xs text-amber-200">Due now</div>
                                <div className="mt-1 text-xs text-slate-500">{template.generatedCount} generated</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {financeMode && detailMetric?.id === "finance-expenses" ? (
                <div className="mt-5">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Most used vendors</p>
                  <div className="space-y-3">
                    {(financeSummary?.topVendors?.length ? financeSummary.topVendors : vendorUsageRows).slice(0, 4).map((vendor) => (
                      <div key={vendor.name} className="rounded-[16px] border border-white/8 bg-white/5 px-4 py-3">
                        <div className="text-sm font-semibold text-slate-100">{vendor.name}</div>
                        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-400">
                          <span>{vendor.expenseCount} expense{vendor.expenseCount === 1 ? "" : "s"}</span>
                          <span className="text-sky-300">{formatMoneyDisplay((vendor.totalAmountByCurrency ?? vendor.totalAmount) || 0)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {!financeMode && detailMetric?.id === "warehouse-skus" ? (
                <div className="mt-5">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Catalog status</p>
                  <div className="space-y-3">
                    {[
                      ["Active", warehouseSummary?.productStatusBreakdown?.active ?? warehouseProducts.filter((product) => product.productStatus !== "paused" && product.productStatus !== "discontinued").length],
                      ["Paused", warehouseSummary?.productStatusBreakdown?.paused ?? warehouseProducts.filter((product) => product.productStatus === "paused").length],
                      ["Discontinued", warehouseSummary?.productStatusBreakdown?.discontinued ?? warehouseProducts.filter((product) => product.productStatus === "discontinued").length]
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="font-semibold text-slate-900">{label}</span>
                          <span className="text-slate-500">{value}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-5">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Recent stock movement</p>
                    <div className="space-y-3">
                      {(warehouseSummary?.recentStockMovements || []).slice(0, 4).map((movement) => {
                        const positiveChange = Number(movement.quantityDelta || 0) > 0;
                        return (
                          <div key={movement.id} className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold text-slate-900">{movement.productName}</div>
                                <div className="mt-1 text-xs text-slate-500">{movement.movementLabel || warehouseMovementTypeLabel(movement.movementType)}</div>
                                <div className="mt-2 text-xs text-slate-500">
                                  {formatWarehouseQuantity(movement.previousStock)} {movement.unit} → {formatWarehouseQuantity(movement.resultingStock)} {movement.unit}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className={`text-xs font-semibold ${positiveChange ? "text-emerald-600" : "text-rose-600"}`}>
                                  {formatWarehouseQuantityDelta(movement.quantityDelta, movement.unit)}
                                </div>
                                <div className="mt-1 text-xs text-slate-500">{formatDateTime(movement.createdAt)}</div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {!warehouseSummary?.recentStockMovements?.length ? (
                        <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                          No stock movement is recorded yet.
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
              {!financeMode && detailMetric?.id === "warehouse-low-stock" ? (
                <div className="mt-5">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Reorder attention</p>
                  <div className="space-y-3">
                    {(warehouseSummary?.lowStockProducts?.length
                      ? warehouseSummary.lowStockProducts
                      : warehouseProducts
                          .filter(isWarehouseLowStock)
                          .map((product) => ({
                            id: product.id,
                            name: product.name,
                            sku: product.sku,
                            stockGap: Number(product.stockGap || Math.max(0, getWarehouseReorderThreshold(product) - Number(product.currentStock || 0))),
                            reorderQuantity: Number(product.reorderQuantity || 0),
                            unit: product.unit || "units"
                          }))
                    ).slice(0, 4).map((product) => (
                      <div key={product.id} className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3">
                        <div className="text-sm font-semibold text-slate-900">{product.name}</div>
                        <div className="mt-1 text-xs text-slate-500">{product.sku}</div>
                        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500">
                          <span>Gap {product.stockGap}</span>
                          <span>Reorder {product.reorderQuantity} {product.unit}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {!financeMode && detailMetric?.id === "warehouse-in-transit" ? (
                <div className="mt-5">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Shipment movement</p>
                  <div className="space-y-3">
                    {(warehouseSummary?.recentShipmentActivity?.length
                      ? warehouseSummary.recentShipmentActivity
                      : warehouseOrders
                    ).filter((order) => ["pending", "packed", "dispatched", "in_transit", "delayed"].includes(order.status))
                      .slice(0, 4)
                      .map((order) => (
                        <div key={order.id} className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-slate-900">{order.orderNumber}</div>
                              <div className="mt-1 text-xs text-slate-500">{order.destination}</div>
                              {order.lastStatusUpdate ? (
                                <div className="mt-2 text-xs text-slate-500">
                                  Last update {formatDateTime(order.lastStatusUpdate.changedAt)}
                                  {order.lastStatusUpdate.actor?.name ? ` · ${order.lastStatusUpdate.actor.name}` : ""}
                                </div>
                              ) : null}
                            </div>
                            <div className="text-right">
                              <div className="text-xs font-semibold text-[#2D8EFF]">{warehouseStatusLabel(order.status)}</div>
                              <div className="mt-1 text-xs text-slate-500">{warehouseShipmentTypeLabel(order.shipmentType)}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              ) : null}
              {!financeMode && detailMetric?.id === "warehouse-delivered" ? (
                <div className="mt-5">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Recent completed handoffs</p>
                  <div className="space-y-3">
                    {(warehouseSummary?.recentShipmentActivity?.length
                      ? warehouseSummary.recentShipmentActivity
                      : warehouseOrders
                    ).filter((order) => order.status === "delivered" || order.status === "delayed" || order.status === "cancelled")
                      .slice(0, 4)
                      .map((order) => (
                        <div key={order.id} className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3">
                          <div className="text-sm font-semibold text-slate-900">{order.orderNumber}</div>
                          <div className="mt-1 text-xs text-slate-500">{order.destination}</div>
                          <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500">
                            <span>{warehouseStatusLabel(order.status)}</span>
                            <span>{formatDate(order.estimatedDelivery)}</span>
                          </div>
                          {order.lastStatusUpdate ? (
                            <div className="mt-2 text-xs text-slate-500">
                              Last update {formatDateTime(order.lastStatusUpdate.changedAt)}
                              {order.lastStatusUpdate.actor?.name ? ` · ${order.lastStatusUpdate.actor.name}` : ""}
                            </div>
                          ) : null}
                        </div>
                      ))}
                  </div>
                </div>
              ) : null}
              </motion.aside>
            ) : null}
          </AnimatePresence>

          <AnimatePresence>
            {showRealWorkspaceConfirm ? (
              <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-20 flex items-center justify-center p-6"
              style={{ background: "rgba(2,6,23,0.62)", backdropFilter: "blur(6px)" }}
            >
              <motion.div
                initial={{ opacity: 0, y: 18, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.98 }}
                transition={{ duration: 0.2 }}
                style={{
                  width: "min(440px, 100%)",
                  borderRadius: 24,
                  border: "1px solid rgba(255,255,255,0.1)",
                  background: "linear-gradient(180deg,#111827 0%,#0f1623 100%)",
                  boxShadow: "0 24px 60px rgba(0,0,0,0.4)",
                  padding: 24
                }}
              >
                <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "#10b981", fontWeight: 700 }}>
                  Leave Demo
                </div>
                <h3
                  style={{
                    margin: "10px 0 0",
                    fontFamily: '"Sora","Manrope","DM Sans","Segoe UI",sans-serif',
                    fontSize: 24,
                    lineHeight: 1.2,
                    fontWeight: 700,
                    color: "#f8fafc"
                  }}
                >
                  Use the real workspace from now on?
                </h3>
                <p style={{ margin: "12px 0 0", color: "#94a3b8", lineHeight: 1.7 }}>
                  Demo mode will stop opening automatically on this device. Future Finance and Warehouse access will go to the real workspace or its sign-in screen.
                </p>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 22 }}>
                  <button
                    type="button"
                    onClick={() => setShowRealWorkspaceConfirm(false)}
                    style={{
                      height: 42,
                      borderRadius: 12,
                      border: "1px solid rgba(255,255,255,0.08)",
                      background: "rgba(255,255,255,0.04)",
                      color: "#cbd5e1",
                      fontWeight: 700,
                      padding: "0 16px",
                      cursor: "pointer"
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmRealWorkspaceUpgrade}
                    style={{
                      height: 42,
                      borderRadius: 12,
                      border: "1px solid rgba(16,185,129,0.36)",
                      background: "linear-gradient(135deg,#10b981,#059669)",
                      color: "#fff",
                      fontWeight: 700,
                      padding: "0 16px",
                      cursor: "pointer"
                    }}
                  >
                    Continue
                  </button>
                </div>
              </motion.div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <AnimatePresence>
            {financeEntryModal ? (
              <FinanceEntryModal
                type={financeEntryModal}
                values={financeEntryValues}
                onChange={updateFinanceEntryValue}
                onFileChange={handleFinanceEntryFile}
                customerSuggestions={customerSuggestions}
                vendorSuggestions={vendorSuggestions}
                categorySuggestions={categorySuggestions}
                onClose={closeFinanceEntryModal}
                onSubmit={handleFinanceEntrySubmit}
                submitting={isFinanceEntrySubmitting}
                workspaceDefaultCurrency={workspaceDefaultCurrency}
              />
            ) : null}
          </AnimatePresence>

          <AnimatePresence>
            {paymentEntry ? (
              <InvoicePaymentModal
                invoice={paymentEntry}
                values={paymentEntryValues}
                onChange={(field, value) => setPaymentEntryValues((current) => ({ ...current, [field]: value }))}
                onClose={closePaymentEntry}
                onSubmit={async () => {
                  setIsPaymentSubmitting(true);
                  try {
                    await handleMarkPaidInvoice(paymentEntry.message, paymentEntryValues);
                  } finally {
                    setIsPaymentSubmitting(false);
                  }
                }}
                submitting={isPaymentSubmitting}
              />
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
