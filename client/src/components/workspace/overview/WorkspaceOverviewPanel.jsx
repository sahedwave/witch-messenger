import { motion } from "framer-motion";

import {
  canAccessWorkspaceScope,
  financeMetricMeta,
  formatMoney,
  formatMoneyDisplay,
  metricTone,
  relativeTime
} from "../WorkspaceMessenger.utils.js";

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

export default function WorkspaceOverviewPanel({
  financeMode = false,
  workspaceScope = "both",
  overviewPressure = null,
  financeMetricCards = [],
  warehouseMetricCards = [],
  executionSummary = null,
  financeActivity = [],
  financeSummary = null,
  warehouseSummary = null,
  recentPayments = [],
  recentShipments = [],
  operationsBridgePanel = null,
  onSelectMetric,
  onNavigate = null,
  canManageOverview = false
}) {
  const canSeeFinance = canAccessWorkspaceScope("finance", workspaceScope);
  const canSeeWarehouse = canAccessWorkspaceScope("warehouse", workspaceScope);
  const financePressure = overviewPressure?.finance || null;
  const warehousePressure = overviewPressure?.warehouse || null;
  const taskPressure = overviewPressure?.tasks || null;
  const projectPressure = overviewPressure?.projects || null;
  const hasExecutionVisibility = Boolean(taskPressure || projectPressure || executionSummary?.trackedTasks || executionSummary?.trackedProjects);
  const overviewVariant = canSeeFinance && canSeeWarehouse ? "both" : canSeeFinance ? "finance" : canSeeWarehouse ? "warehouse" : hasExecutionVisibility ? "execution" : "none";
  const pressureSortRank = (item) => {
    const count = Number(item.count || 0);
    const zeroPenalty = count > 0 ? 0 : 1000;
    switch (item.id) {
      case "finance-overdue":
      case "tasks-overdue":
        return zeroPenalty + 1;
      case "finance-pending-approvals":
      case "warehouse-low-stock":
      case "warehouse-needs-attention":
      case "projects-with-overdue":
        return zeroPenalty + 2;
      case "finance-reconcile":
      case "tasks-due-today":
      case "warehouse-pending-shipments":
        return zeroPenalty + 3;
      case "tasks-my":
      case "tasks-unassigned":
      case "projects-active":
        return zeroPenalty + 4;
      default:
        return zeroPenalty + 5;
    }
  };
  const highlightToneForCount = (count, tone = "info") => (Number(count || 0) > 0 ? tone : "");
  const financeOverviewCards = canSeeFinance && financePressure
    ? [
        {
          id: "finance-pending-approvals",
          label: "Pending Approvals",
          value: `${Number(financePressure.pendingApprovals || 0) + Number(financePressure.pendingExpenses || 0)}`,
          subvalue: `${financePressure.pendingApprovals || 0} invoices · ${financePressure.pendingExpenses || 0} expenses`,
          count: Number(financePressure.pendingApprovals || 0) + Number(financePressure.pendingExpenses || 0),
          highlightTone: highlightToneForCount(Number(financePressure.pendingApprovals || 0) + Number(financePressure.pendingExpenses || 0), "warning"),
          action: () => onNavigate?.({ scope: "finance", tab: "Links" })
        },
        {
          id: "finance-overdue",
          label: "Overdue Invoices",
          value: `${financePressure.overdueInvoices || 0}`,
          subvalue: `${formatMoneyDisplay(financePressure.outstandingAmount || 0)} still open`,
          count: Number(financePressure.overdueInvoices || 0),
          highlightTone: highlightToneForCount(financePressure.overdueInvoices, "danger"),
          action: () => onNavigate?.({ scope: "finance", tab: "Pinned", metricId: "finance-overdue" })
        },
        {
          id: "finance-outstanding",
          label: "Outstanding Amount",
          value: formatMoneyDisplay(financePressure.outstandingAmount || 0),
          subvalue: `${financePressure.pendingApprovals || 0} approvals waiting`,
          count: Object.values(financePressure.outstandingAmount || {}).reduce((sum, amount) => sum + Number(amount || 0), 0),
          highlightTone: highlightToneForCount(Object.values(financePressure.outstandingAmount || {}).reduce((sum, amount) => sum + Number(amount || 0), 0), "warning"),
          action: () => onNavigate?.({ scope: "finance", tab: "Pinned", metricId: "finance-outstanding" })
        },
        {
          id: "finance-reconcile",
          label: "Reconcile Queue",
          value: `${financePressure.reconcileQueue || 0}`,
          subvalue: "Payments and expenses still need close-out",
          count: Number(financePressure.reconcileQueue || 0),
          highlightTone: highlightToneForCount(financePressure.reconcileQueue, "info"),
          action: () => onNavigate?.({ scope: "finance", tab: "Links" })
        }
      ].sort((left, right) => pressureSortRank(left) - pressureSortRank(right))
    : financeMetricCards;
  const warehouseOverviewCards = canSeeWarehouse && warehousePressure
    ? [
        {
          id: "warehouse-low-stock",
          label: "Low Stock Items",
          value: `${warehousePressure.lowStock || 0}`,
          subvalue: `${warehousePressure.pendingPOCount || 0} open PO · ${warehousePressure.needsAttention || 0} need attention`,
          count: Number(warehousePressure.lowStock || 0),
          highlightTone: highlightToneForCount(warehousePressure.lowStock, "danger"),
          action: () => onNavigate?.({ scope: "warehouse", tab: "Media", metricId: "warehouse-low-stock" })
        },
        {
          id: "warehouse-pending-shipments",
          label: "Pending Shipments",
          value: `${warehousePressure.pendingShipments || 0}`,
          subvalue: `${warehousePressure.pendingPOCount || 0} purchase order${Number(warehousePressure.pendingPOCount || 0) === 1 ? "" : "s"} still open`,
          count: Number(warehousePressure.pendingShipments || 0),
          highlightTone: highlightToneForCount(warehousePressure.pendingShipments, "warning"),
          action: () => onNavigate?.({ scope: "warehouse", tab: "Pinned", metricId: "warehouse-in-transit" })
        },
        {
          id: "warehouse-needs-attention",
          label: "Needs Attention",
          value: `${warehousePressure.needsAttention || 0}`,
          subvalue: "Low stock and delivery pressure combined",
          count: Number(warehousePressure.needsAttention || 0),
          highlightTone: highlightToneForCount(warehousePressure.needsAttention, "warning"),
          action: () => onNavigate?.({ scope: "warehouse", tab: "Media" })
        }
      ].sort((left, right) => pressureSortRank(left) - pressureSortRank(right))
    : warehouseMetricCards;
  const taskOverviewCards = taskPressure
    ? [
        {
          id: "tasks-overdue",
          label: "Overdue Tasks",
          value: `${taskPressure.overdue || 0}`,
          subvalue: "Assigned work is now slipping",
          count: Number(taskPressure.overdue || 0),
          highlightTone: highlightToneForCount(taskPressure.overdue, "danger"),
          action: () => onNavigate?.({ scope: "tasks", taskView: "overdue" })
        },
        {
          id: "tasks-due-today",
          label: "Due Today",
          value: `${taskPressure.dueToday || 0}`,
          subvalue: "Tasks that need to land today",
          count: Number(taskPressure.dueToday || 0),
          highlightTone: highlightToneForCount(taskPressure.dueToday, "warning"),
          action: () => onNavigate?.({ scope: "tasks", taskView: "today" })
        },
        {
          id: "tasks-my",
          label: "My Tasks",
          value: `${taskPressure.myTasks || 0}`,
          subvalue: "Assigned to you right now",
          count: Number(taskPressure.myTasks || 0),
          highlightTone: highlightToneForCount(taskPressure.myTasks, "info"),
          action: () => onNavigate?.({ scope: "tasks", taskView: "my" })
        },
        {
          id: "tasks-unassigned",
          label: "Unassigned Tasks",
          value: `${taskPressure.unassigned || 0}`,
          subvalue: "Work without a clear owner",
          count: Number(taskPressure.unassigned || 0),
          highlightTone: highlightToneForCount(taskPressure.unassigned, "warning"),
          action: () => onNavigate?.({ scope: "tasks", taskView: "unassigned" })
        }
      ].sort((left, right) => pressureSortRank(left) - pressureSortRank(right))
    : [
        {
          id: "execution-overdue",
          label: "Overdue Tasks",
          value: `${executionSummary?.overdueTasks || 0}`,
          subvalue: `${executionSummary?.inProgressTasks || 0} in progress`,
          count: Number(executionSummary?.overdueTasks || 0),
          highlightTone: highlightToneForCount(executionSummary?.overdueTasks, "danger"),
          action: () => onNavigate?.({ scope: "tasks", taskView: "overdue" })
        }
      ];
  const projectOverviewCards = projectPressure
    ? [
        {
          id: "projects-with-overdue",
          label: "Projects With Overdue Tasks",
          value: `${projectPressure.withOverdueTasks || 0}`,
          subvalue: `${projectPressure.active || 0} active project${Number(projectPressure.active || 0) === 1 ? "" : "s"} tracked`,
          count: Number(projectPressure.withOverdueTasks || 0),
          highlightTone: highlightToneForCount(projectPressure.withOverdueTasks, "danger"),
          action: () => onNavigate?.({ scope: "projects" })
        },
        {
          id: "projects-active",
          label: "Active Projects",
          value: `${projectPressure.active || 0}`,
          subvalue: "Open coordination work across the workspace",
          count: Number(projectPressure.active || 0),
          highlightTone: highlightToneForCount(projectPressure.active, "info"),
          action: () => onNavigate?.({ scope: "projects" })
        }
      ].sort((left, right) => pressureSortRank(left) - pressureSortRank(right))
    : [
        {
          id: "execution-projects",
          label: "Projects Needing Review",
          value: `${executionSummary?.projectsNeedingAttention || 0}`,
          subvalue: `${executionSummary?.activeProjects || 0} active project${Number(executionSummary?.activeProjects || 0) === 1 ? "" : "s"} tracked`,
          count: Number(executionSummary?.projectsNeedingAttention || 0),
          highlightTone: highlightToneForCount(executionSummary?.projectsNeedingAttention, "warning"),
          action: () => onNavigate?.({ scope: "projects" })
        }
      ];
  const enabledSections = [
    canSeeFinance
      ? {
          id: "finance",
          label: "Finance snapshot",
          subtitle: "Approvals, overdue work, outstanding balances, and reconciliation pressure.",
          metrics: financeOverviewCards,
          actionLabel: "Open Finance",
          action: () => onNavigate?.({ scope: "finance", tab: "Media" })
        }
      : null,
    canSeeWarehouse
      ? {
          id: "warehouse",
          label: "Warehouse snapshot",
          subtitle: "Low stock, shipment pressure, and items that need follow-up.",
          metrics: warehouseOverviewCards,
          actionLabel: "Open Warehouse",
          action: () => onNavigate?.({ scope: "warehouse", tab: "Media" })
        }
      : null,
    {
      id: "tasks",
      label: "Task snapshot",
      subtitle: "Assigned work, due dates, and accountability gaps for the team.",
      metrics: taskOverviewCards,
      actionLabel: "Open Tasks",
      action: () => onNavigate?.({ scope: "tasks", taskView: "my" })
    },
    {
      id: "projects",
      label: "Project snapshot",
      subtitle: "Project activity and overdue task pressure across active work.",
      metrics: projectOverviewCards,
      actionLabel: "Open Projects",
      action: () => onNavigate?.({ scope: "projects" })
    }
  ].filter(Boolean);
  const combinedPressureItems = [...financeOverviewCards, ...warehouseOverviewCards, ...taskOverviewCards, ...projectOverviewCards]
    .map((item) => ({
      id: item.id,
      title: `${item.value} ${item.label.toLowerCase()}`,
      detail: item.subvalue || "",
      action: item.action,
      count: item.count || 0
    }))
    .sort((left, right) => pressureSortRank(left) - pressureSortRank(right));
  const urgentItems = combinedPressureItems.filter((item) => Number(item.count || 0) > 0).slice(0, 4);
  const watchItems = combinedPressureItems.filter((item) => Number(item.count || 0) === 0).slice(0, 4);
  const dashboardIntro =
    overviewVariant === "finance"
      ? "Keep track of invoices, collected cash, and finance work that needs attention."
      : overviewVariant === "warehouse"
        ? "Track stock pressure, shipment movement, and warehouse work that needs attention."
        : overviewVariant === "execution"
          ? "See which tasks and projects need owner attention before dropping into detailed execution work."
        : overviewVariant === "both"
          ? "Start here to see what needs attention across Finance and Warehouse before dropping into module workflows."
          : "This workspace does not currently have module activity to show here.";
  const urgentEmptyCopy =
    overviewVariant === "finance"
      ? "No urgent finance issues are open right now. Overdue invoices and recurring due items will appear here first."
      : overviewVariant === "warehouse"
        ? "No urgent warehouse issues are open right now. Delayed shipments and reorder pressure will appear here first."
        : overviewVariant === "execution"
          ? "No urgent task or project issues are open right now. Overdue execution work will appear here first."
        : overviewVariant === "both"
          ? "No urgent cross-workspace issues are open right now. This section will surface finance and warehouse items that need attention first."
          : "Urgent items will appear here once this workspace starts using modules.";
  const watchEmptyCopy =
    overviewVariant === "finance"
      ? "Routine finance follow-up will show here, including outstanding and partially paid invoices."
      : overviewVariant === "warehouse"
        ? "Routine warehouse follow-up will show here, including low stock and shipments in transit."
        : overviewVariant === "execution"
          ? "Routine task and project follow-up will show here after urgent items are handled."
        : overviewVariant === "both"
          ? "Routine finance and warehouse follow-up will show here after the urgent items are handled."
          : "Watchlist items will appear here once module data starts flowing.";
  const recentEmptyCopy =
    overviewVariant === "finance"
      ? "Recent finance operations will appear here as invoices and payments move through the workspace."
      : overviewVariant === "warehouse"
        ? "Recent warehouse operations will appear here as stock and shipments move through the workspace."
      : overviewVariant === "both"
          ? "Recent finance and warehouse activity will appear here as the workspace gets busier."
          : "Recent operations will appear here once this workspace starts activity.";
  const financeFeedItems = canSeeFinance
    ? (financeActivity.length
        ? financeActivity.slice(0, 8).map((entry) => {
            const copy = financeActivityCopy(entry);
            const isInvoice = entry.itemType === "invoice";
            const isPaid = entry.action === "paid";
            const isRecurring = entry.action === "recurring_issued";
            const isExpense = entry.itemType === "expense";
            return {
              id: `overview-finance-activity-${entry.id}`,
              sortAt: entry.createdAt,
              category: "finance",
              eyebrow: isRecurring ? "Finance · Recurring" : isExpense ? "Finance · Expense" : "Finance · Invoice",
              title: copy.title,
              detail: copy.body,
              meta: relativeTime(entry.createdAt),
              target: {
                scope: "finance",
                tab: isExpense ? "Media" : isRecurring ? "Media" : "Pinned",
                metricId:
                  isInvoice
                    ? isPaid
                      ? "finance-paid"
                      : isRecurring
                        ? "finance-overdue"
                        : entry.action === "rejected" || entry.action === "approved"
                      ? "finance-overdue"
                      : "finance-outstanding"
                    : "finance-expenses"
              }
            };
          })
        : recentPayments.slice(0, 4).map((payment) => ({
            id: `overview-finance-payment-${payment.id}`,
            sortAt: payment.recordedAt,
            category: "finance",
            eyebrow: "Finance · Payment",
            title: `${payment.invoiceNumber} payment recorded`,
            detail: `${payment.customerName} · ${formatMoney(payment.amount, payment.currency)} via ${formatPaymentMethod(payment.method)}`,
            meta: relativeTime(payment.recordedAt),
            target: { scope: "finance", tab: "Pinned", metricId: "finance-paid" }
          })))
    : [];
  const crossModuleFeedItems = canSeeFinance && canSeeWarehouse
    ? [
        warehouseSummary?.reorderAttention && financeSummary?.outstandingInvoices
          ? {
              id: "overview-cross-reorder-cash",
              sortAt: new Date().toISOString(),
              category: "cross_module",
              eyebrow: "Cross-module · Purchasing pressure",
              title: "Low stock is now carrying finance impact",
              detail: `${warehouseSummary.reorderAttention} reorder signal${warehouseSummary.reorderAttention === 1 ? "" : "s"} are active while ${financeSummary.outstandingInvoices} invoice${financeSummary.outstandingInvoices === 1 ? "" : "s"} stay open.`,
              meta: "Review collections before replenishment pressure turns into spend pressure.",
              target: { scope: "finance", tab: "Pinned", metricId: "finance-outstanding" }
            }
          : null,
        warehouseSummary?.delayedOrders && (financeSummary?.overdueInvoices || financeSummary?.outstandingInvoices)
          ? {
              id: "overview-cross-delay-risk",
              sortAt: new Date(Date.now() - 1000).toISOString(),
              category: "cross_module",
              eyebrow: "Cross-module · Customer risk",
              title: "Shipment delay may affect collections",
              detail: `${warehouseSummary.delayedOrders} delayed shipment${warehouseSummary.delayedOrders === 1 ? "" : "s"} are active alongside finance follow-up pressure.`,
              meta: "Customer conversations may need operations and finance aligned.",
              target: { scope: "warehouse", tab: "Pinned", metricId: "warehouse-in-transit" }
            }
          : null,
        financeSummary?.recurringDueInvoices && warehouseSummary?.reorderAttention
          ? {
              id: "overview-cross-recurring-stock",
              sortAt: new Date(Date.now() - 2000).toISOString(),
              category: "cross_module",
              eyebrow: "Cross-module · Timing",
              title: "Billing work is due while stock pressure is active",
              detail: `${financeSummary.recurringDueInvoices} recurring invoice${financeSummary.recurringDueInvoices === 1 ? "" : "s"} are due and ${warehouseSummary.reorderAttention} stock item${warehouseSummary.reorderAttention === 1 ? "" : "s"} still need replenishment.`,
              meta: "Keep billing and fulfillment timing in sync.",
              target: { scope: "finance", tab: "Media", metricId: "finance-overdue" }
            }
          : null
      ].filter(Boolean)
    : [];
  const executionFeedItems = [
    ...(executionSummary?.topOverdueTasks || []).map((task, index) => ({
      id: `overview-execution-task-${task.id}`,
      sortAt: new Date(Date.now() - index * 1200).toISOString(),
      category: "execution",
      eyebrow: "Execution · Overdue",
      title: `${task.title} is overdue`,
      detail: `${task.priority} priority${task.assigneeName ? ` · ${task.assigneeName}` : ""}`,
      meta: "Task follow-up needed",
      target: { scope: "tasks" }
    })),
    ...(executionSummary?.topProjects || []).map((project, index) => ({
      id: `overview-execution-project-${project.id}`,
      sortAt: new Date(Date.now() - (index + 4) * 1200).toISOString(),
      category: "execution",
      eyebrow: "Execution · Project",
      title: `${project.name} needs review`,
      detail: `${project.progress || 0}% complete${project.daysUntilDue != null ? ` · ${project.daysUntilDue < 0 ? "past due" : `${project.daysUntilDue} day${project.daysUntilDue === 1 ? "" : "s"} left`}` : ""}`,
      meta: project.attentionReason === "low_completion" ? "Progress is light" : "Timing needs review",
      target: { scope: "projects" }
    }))
  ];
  const warehouseFeedItems = canSeeWarehouse
    ? [
        ...((warehouseSummary?.warehouseHandoffCues || []).slice(0, 2).map((cue, index) => ({
          id: `overview-warehouse-handoff-feed-${cue.id}`,
          sortAt: new Date(Date.now() - index * 1500).toISOString(),
          category: canSeeFinance ? "cross_module" : "warehouse",
          eyebrow: canSeeFinance ? "Cross-module · Warehouse" : "Warehouse · Handoff",
          title: cue.title,
          detail: cue.detail,
          meta: cue.signal === "risk" ? "Review now" : cue.signal === "attention" ? "Needs planning" : "Worth watching",
          target: { scope: "warehouse", tab: "Media", metricId: cue.targetMetricId || "warehouse-in-transit" }
        }))),
        ...(warehouseSummary?.lowStockProducts?.slice(0, 2) || []).map((product) => ({
          id: `overview-warehouse-stock-${product.id}`,
          sortAt: product.updatedAt || product.createdAt || new Date(0).toISOString(),
          category: canSeeFinance ? "cross_module" : "warehouse",
          eyebrow: canSeeFinance ? "Cross-module · Reorder" : "Warehouse · Reorder",
          title: `${product.name} low stock`,
          detail: `Gap ${product.stockGap || 0} · reorder ${product.reorderQuantity || 0} ${product.unit || "units"}`,
          meta: product.updatedAt || product.createdAt ? relativeTime(product.updatedAt || product.createdAt) : "Needs attention",
          target: { scope: "warehouse", tab: "Pinned", metricId: "warehouse-low-stock" }
        })),
        ...recentShipments.slice(0, 6).map((shipment) => ({
          id: `overview-warehouse-shipment-${shipment.id}`,
          sortAt: shipment.updatedAt || shipment.createdAt || shipment.estimatedDelivery || new Date(0).toISOString(),
          category: "warehouse",
          eyebrow: shipment.status === "delayed" ? "Warehouse · Delay" : shipment.status === "delivered" ? "Warehouse · Handoff" : "Warehouse · Shipment",
          title: `${shipment.orderNumber} ${warehouseStatusLabel(shipment.status).toLowerCase()}`,
          detail: `${shipment.destination} · ${warehouseShipmentTypeLabel(shipment.shipmentType)} · ${shipment.itemsCount || 1} item${Number(shipment.itemsCount || 1) === 1 ? "" : "s"}`,
          meta: shipment.updatedAt || shipment.createdAt || shipment.estimatedDelivery ? relativeTime(shipment.updatedAt || shipment.createdAt || shipment.estimatedDelivery) : "Shipment update",
          target: {
            scope: "warehouse",
            tab: shipment.status === "delivered" ? "Media" : "Pinned",
            metricId: shipment.status === "delivered" ? "warehouse-delivered" : "warehouse-in-transit"
          }
        }))
      ]
    : [];
  const operationsFeed = [...crossModuleFeedItems, ...executionFeedItems, ...financeFeedItems, ...warehouseFeedItems]
    .sort((left, right) => new Date(right.sortAt).getTime() - new Date(left.sortAt).getTime())
    .slice(0, 8);
  const focusSequence = [
    ...urgentItems.slice(0, 2).map((item, index) => ({
      id: `focus-urgent-${item.id}`,
      step: index + 1,
      lane: "Urgent now",
      title: item.title,
      detail: item.detail,
      action: item.action
    })),
    ...watchItems.slice(0, Math.max(0, 3 - Math.min(urgentItems.length, 2))).map((item, index) => ({
      id: `focus-watch-${item.id}`,
      step: Math.min(urgentItems.length, 2) + index + 1,
      lane: "Watch next",
      title: item.title,
      detail: item.detail,
      action: item.action
    }))
  ].slice(0, 3);
  const headerPills = [
    urgentItems.length ? `${urgentItems.length} urgent` : null,
    watchItems.length ? `${watchItems.length} watchlist` : null,
    operationsFeed.length ? `${operationsFeed.length} feed` : null
  ].filter(Boolean);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="mb-5">
        <h3 className={`text-2xl font-bold ${financeMode ? "text-white" : "text-slate-900"}`}>Workspace overview</h3>
        <p className={`mt-2 max-w-3xl text-sm ${financeMode ? "text-slate-400" : "text-slate-500"}`}>
          {dashboardIntro}
        </p>
        {headerPills.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {headerPills.map((pill) => (
              <span
                key={pill}
                className="rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]"
                style={
                  financeMode
                    ? { border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", color: "#cbd5e1" }
                    : { border: "1px solid #dbeafe", background: "#eff6ff", color: "#1d4ed8" }
                }
              >
                {pill}
              </span>
            ))}
          </div>
        ) : null}
        {!canManageOverview ? (
          <p className={`mt-3 max-w-3xl text-sm ${financeMode ? "text-slate-500" : "text-slate-500"}`}>
            This view stays lighter for non-manager roles and focuses on high-level workspace visibility.
          </p>
        ) : null}
      </div>

      {operationsBridgePanel ? <div className="mb-6">{operationsBridgePanel}</div> : null}

      {focusSequence.length ? (
        <div
          className={`mb-6 rounded-[24px] p-5 ${financeMode ? "" : "border border-slate-200 bg-white shadow-sm"}`}
          style={
            financeMode
              ? {
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "linear-gradient(180deg,#111827 0%,#10192a 100%)",
                  boxShadow: "0 12px 32px rgba(0,0,0,0.28)"
                }
              : undefined
          }
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${financeMode ? "text-cyan-300" : "text-slate-500"}`}>Focus now</div>
              <p className={`mt-2 text-sm ${financeMode ? "text-slate-400" : "text-slate-500"}`}>
                A simple sequence for what to review first across the workspace before you drop into the modules.
              </p>
            </div>
            <div className={`rounded-full px-3 py-1 text-xs font-semibold ${financeMode ? "text-cyan-200" : "text-sky-700"}`} style={financeMode ? { background: "rgba(34,211,238,0.12)" } : { background: "#e0f2fe" }}>
              {focusSequence.length} step{focusSequence.length === 1 ? "" : "s"}
            </div>
          </div>
          <div className="mt-4 grid gap-3 xl:grid-cols-3">
            {focusSequence.map((item) => {
              const Container = canManageOverview ? "button" : "div";
              return (
                <Container
                  key={item.id}
                  type={canManageOverview ? "button" : undefined}
                  onClick={canManageOverview ? item.action : undefined}
                  className="rounded-[18px] px-4 py-4 text-left"
                  style={
                    financeMode
                      ? { border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)" }
                      : { border: "1px solid #e2e8f0", background: "#f8fafc" }
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${financeMode ? "text-cyan-300" : "text-slate-500"}`}>
                        {item.lane}
                      </div>
                      <div className={`mt-1 text-sm font-semibold ${financeMode ? "text-slate-100" : "text-slate-900"}`}>{item.title}</div>
                      <div className="mt-1 text-sm text-slate-500">{item.detail}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className={`text-lg font-bold ${financeMode ? "text-slate-100" : "text-slate-900"}`}>{item.step}</div>
                      {canManageOverview ? <div className="mt-1 text-xs font-semibold text-slate-500">Open</div> : null}
                    </div>
                  </div>
                </Container>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          {enabledSections.map((section) => (
            <div
              key={section.id}
              className={`rounded-[24px] p-5 ${financeMode ? "" : "border border-slate-200 bg-white shadow-sm"}`}
              style={
                financeMode
                  ? {
                      border: "1px solid rgba(255,255,255,0.08)",
                      background: "linear-gradient(180deg,#111827 0%,#10192a 100%)",
                      boxShadow: "0 12px 32px rgba(0,0,0,0.28)"
                    }
                  : undefined
              }
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${financeMode ? "text-cyan-300" : "text-slate-500"}`}>{section.label}</div>
                  <p className={`mt-2 text-sm ${financeMode ? "text-slate-400" : "text-slate-500"}`}>{section.subtitle}</p>
                </div>
                {canManageOverview ? (
                  <button
                    type="button"
                    onClick={section.action}
                    className="rounded-full px-3 py-2 text-xs font-semibold"
                    style={
                      financeMode
                        ? { border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.05)", color: "#e2e8f0" }
                        : { border: "1px solid #dbeafe", background: "#eff6ff", color: "#1d4ed8" }
                    }
                  >
                    {section.actionLabel}
                  </button>
                ) : null}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {section.metrics.map((metric) => (
                  <StatCard
                    key={metric.id}
                    metric={metric}
                    onSelect={onSelectMetric}
                    onActivate={metric.action ? () => metric.action() : null}
                    financeMode={financeMode}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-6">
          <div
            className={`rounded-[24px] p-5 ${financeMode ? "" : "border border-slate-200 bg-white shadow-sm"}`}
            style={
              financeMode
                ? {
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "linear-gradient(180deg,#111827 0%,#10192a 100%)",
                    boxShadow: "0 12px 32px rgba(0,0,0,0.28)"
                  }
                : undefined
            }
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${financeMode ? "text-rose-300" : "text-rose-600"}`}>Urgent now</div>
                <p className={`mt-2 text-sm ${financeMode ? "text-slate-400" : "text-slate-500"}`}>Handle these first before moving into routine follow-up.</p>
              </div>
              {urgentItems.length ? (
                <div className={`rounded-full px-3 py-1 text-xs font-semibold ${financeMode ? "text-rose-200" : "text-rose-700"}`} style={financeMode ? { background: "rgba(244,63,94,0.12)" } : { background: "#ffe4e6" }}>
                  {urgentItems.length} priority
                </div>
              ) : null}
            </div>
            <div className="mt-4 space-y-3">
              {urgentItems.length ? urgentItems.map((item) => {
                const Container = canManageOverview ? "button" : "div";
                return (
                <Container
                  key={item.id}
                  type={canManageOverview ? "button" : undefined}
                  onClick={canManageOverview ? item.action : undefined}
                  className="rounded-[18px] px-4 py-4"
                  style={
                    financeMode
                      ? { border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)" }
                      : { border: "1px solid #e2e8f0", background: "#f8fafc" }
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className={`text-sm font-semibold ${financeMode ? "text-slate-100" : "text-slate-900"}`}>{item.title}</div>
                      <div className="mt-1 text-sm text-slate-500">{item.detail}</div>
                    </div>
                    {canManageOverview ? <div className="text-xs font-semibold text-slate-500">Open</div> : null}
                  </div>
                </Container>
              )}) : (
                <div
                  className="rounded-[18px] px-4 py-4 text-sm text-slate-500"
                  style={
                    financeMode
                      ? { border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)" }
                      : { border: "1px solid #e2e8f0", background: "#f8fafc" }
                  }
                >
                  {urgentEmptyCopy}
                </div>
              )}
            </div>
          </div>

          <div
            className={`rounded-[24px] p-5 ${financeMode ? "" : "border border-slate-200 bg-white shadow-sm"}`}
            style={
              financeMode
                ? {
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "linear-gradient(180deg,#111827 0%,#10192a 100%)",
                    boxShadow: "0 12px 32px rgba(0,0,0,0.28)"
                  }
                : undefined
            }
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${financeMode ? "text-amber-300" : "text-amber-700"}`}>Watchlist</div>
                <p className={`mt-2 text-sm ${financeMode ? "text-slate-400" : "text-slate-500"}`}>Important follow-up that is active, but not the first fire to put out.</p>
              </div>
              {watchItems.length ? (
                <div className={`rounded-full px-3 py-1 text-xs font-semibold ${financeMode ? "text-amber-200" : "text-amber-700"}`} style={financeMode ? { background: "rgba(245,158,11,0.12)" } : { background: "#fef3c7" }}>
                  {watchItems.length} watch
                </div>
              ) : null}
            </div>
            <div className="mt-4 space-y-3">
              {watchItems.length ? watchItems.map((item) => {
                const Container = canManageOverview ? "button" : "div";
                return (
                <Container
                  key={item.id}
                  type={canManageOverview ? "button" : undefined}
                  onClick={canManageOverview ? item.action : undefined}
                  className="rounded-[18px] px-4 py-4"
                  style={
                    financeMode
                      ? { border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)" }
                      : { border: "1px solid #e2e8f0", background: "#f8fafc" }
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className={`text-sm font-semibold ${financeMode ? "text-slate-100" : "text-slate-900"}`}>{item.title}</div>
                      <div className="mt-1 text-sm text-slate-500">{item.detail}</div>
                    </div>
                    {canManageOverview ? <div className="text-xs font-semibold text-slate-500">Open</div> : null}
                  </div>
                </Container>
              )}) : (
                <div
                  className="rounded-[18px] px-4 py-4 text-sm text-slate-500"
                  style={
                    financeMode
                      ? { border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)" }
                      : { border: "1px solid #e2e8f0", background: "#f8fafc" }
                  }
                >
                  {watchEmptyCopy}
                </div>
              )}
            </div>
          </div>

          <div
            className={`rounded-[24px] p-5 ${financeMode ? "" : "border border-slate-200 bg-white shadow-sm"}`}
            style={
              financeMode
                ? {
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "linear-gradient(180deg,#111827 0%,#10192a 100%)",
                    boxShadow: "0 12px 32px rgba(0,0,0,0.28)"
                  }
                : undefined
            }
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${financeMode ? "text-cyan-300" : "text-slate-500"}`}>Operations feed</div>
                <p className={`mt-2 text-sm ${financeMode ? "text-slate-400" : "text-slate-500"}`}>One timeline of the most meaningful finance and warehouse signals in this workspace.</p>
              </div>
              {operationsFeed.length ? (
                <div className={`rounded-full px-3 py-1 text-xs font-semibold ${financeMode ? "text-cyan-200" : "text-sky-700"}`} style={financeMode ? { background: "rgba(34,211,238,0.12)" } : { background: "#e0f2fe" }}>
                  Live feed
                </div>
              ) : null}
            </div>
            <div className="mt-4 space-y-3">
              {operationsFeed.length ? operationsFeed.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate?.(item.target)}
                  className="rounded-[18px] px-4 py-4 text-left"
                  style={
                    financeMode
                      ? { border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)" }
                      : { border: "1px solid #e2e8f0", background: "#f8fafc" }
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ background: operationsTimelineCategoryTone(item.category, financeMode) }}
                        />
                        <div className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${financeMode ? "text-cyan-300" : "text-slate-500"}`}>{item.eyebrow}</div>
                      </div>
                      <div className={`mt-1 text-sm font-semibold ${financeMode ? "text-slate-100" : "text-slate-900"}`}>{item.title}</div>
                      <div className="mt-1 text-sm text-slate-500">{item.detail}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-xs font-semibold text-slate-500">{item.meta}</div>
                      {canManageOverview ? (
                        <div className="mt-2 text-xs font-semibold text-slate-500">
                          {item.target?.metricId ? "Open detail" : "Open module"}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </button>
              )) : (
                <div
                  className="rounded-[18px] px-4 py-4 text-sm text-slate-500"
                  style={
                    financeMode
                      ? { border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)" }
                      : { border: "1px solid #e2e8f0", background: "#f8fafc" }
                  }
                >
                  {recentEmptyCopy}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
