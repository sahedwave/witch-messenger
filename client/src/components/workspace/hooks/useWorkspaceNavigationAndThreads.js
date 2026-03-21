import { useCallback } from "react";

import { api } from "../../../api";
import { COMMAND_ITEMS } from "../WorkspaceMessenger.constants.js";
import {
  canAccessWorkspaceScope,
  formatMoney,
  messagePreview,
  moveThreadToTop,
  sortThreads,
  sumCurrencyBucketInBaseCurrency,
  uid
} from "../WorkspaceMessenger.utils.js";
import { isWarehouseLowStock } from "../warehouse/warehouse-record-mappers.js";

export default function useWorkspaceNavigationAndThreads({
  authToken,
  activeWorkspaceId,
  pushToast,
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
}) {
  function handleSelectWorkspace(nextWorkspaceId) {
    if (!nextWorkspaceId || nextWorkspaceId === activeWorkspaceId) {
      return;
    }

    setDetailMetric(null);
    setActiveWorkspaceId(nextWorkspaceId);
  }

  function updateThread(threadId, updater) {
    setWorkspaceState((current) => ({
      ...current,
      threads: sortThreads(
        current.threads.map((thread) => (thread.id === threadId ? updater(thread) : thread))
      )
    }));
  }

  function appendMessage(threadId, message, options = {}) {
    setWorkspaceState((current) => {
      const nextThreads = current.threads.map((thread) => {
        if (thread.id !== threadId) {
          return thread;
        }

        const nextMessage = {
          id: uid("msg"),
          senderId: options.senderId || current.currentUser.id,
          senderName: options.senderName || current.currentUser.name,
          createdAt: new Date().toISOString(),
          ...message
        };
        const shouldIncrementUnread =
          thread.id !== activeThreadId &&
          (thread.isBot || nextMessage.senderId !== current.currentUser.id);

        return {
          ...thread,
          messages: [...thread.messages, nextMessage],
          updatedAt: nextMessage.createdAt,
          unread: shouldIncrementUnread ? thread.unread + 1 : thread.unread,
          preview: messagePreview(nextMessage)
        };
      });

      const sorted = options.bringToTop ? moveThreadToTop(sortThreads(nextThreads), threadId) : sortThreads(nextThreads);
      return { ...current, threads: sorted };
    });
  }

  function appendBotAlert(threadId, title, body, message) {
    appendMessage(
      threadId,
      message,
      {
        senderId: threadId,
        senderName: title,
        bringToTop: true
      }
    );
    pushToast({ title, body, threadId });
  }

  function openThread(threadId) {
    setActiveThreadId(threadId);
    setActiveTab("Chat");
    setWorkspaceState((current) => ({
      ...current,
      threads: current.threads.map((thread) =>
        thread.id === threadId ? { ...thread, unread: 0 } : thread
      )
    }));
  }

  function decrementThreadUnread(threadId) {
    setWorkspaceState((current) => ({
      ...current,
      threads: current.threads.map((thread) =>
        thread.id === threadId
          ? { ...thread, unread: Math.max(0, thread.unread - 1) }
          : thread
      )
    }));
  }

  function updateMessage(threadId, messageId, updater) {
    setWorkspaceState((current) => ({
      ...current,
      threads: current.threads.map((thread) => {
        if (thread.id !== threadId) {
          return thread;
        }

        const messages = thread.messages.map((message) =>
          message.id === messageId ? updater(message) : message
        );
        return {
          ...thread,
          messages,
          preview: messagePreview(messages[messages.length - 1])
        };
      })
    }));
  }

  async function handleSendText() {
    if (!draft.trim() || !activeThread) {
      return;
    }

    if (realWorkspaceEnabled && !activeThread.isBot && activeThread.conversationId) {
      try {
        const conversation = await api.sendWorkspaceConversationMessage(
          authToken,
          activeThread.conversationId,
          { content: draft.trim() },
          activeWorkspaceId
        );
        setWorkspaceState((current) => upsertWorkspaceConversationThread(current, conversation));
        setDraft("");
        return;
      } catch (error) {
        pushToast({
          title: "Unable to send workspace message",
          body: error.message || "Please try again."
        });
        return;
      }
    }

    appendMessage(activeThread.id, {
      type: "text",
      content: draft.trim()
    });
    setDraft("");
  }

  async function handleCreateTaskFromMessage(message) {
    if (!authToken || !activeWorkspaceId || !activeThread?.conversationId || activeThread?.isBot) {
      return;
    }

    try {
      const task = await api.createWorkspaceTask(
        authToken,
        buildTaskPayloadFromMessage(message, activeThread),
        activeWorkspaceId
      );
      await Promise.all([
        loadWorkspaceConversations(authToken, activeWorkspaceId),
        loadExecutionSummary(authToken, activeWorkspaceId),
        loadWorkspaceNotifications(authToken, activeWorkspaceId, { toastOnError: false })
      ]);
      pushToast({
        title: "Task linked to conversation",
        body: `${task.title} is now tracked from this thread.`
      });
    } catch (error) {
      pushToast({
        title: "Unable to create linked task",
        body: error.message || "Please try again."
      });
    }
  }

  async function handleCreateProjectFromMessage(message) {
    if (!authToken || !activeWorkspaceId || !activeThread?.conversationId || activeThread?.isBot) {
      return;
    }

    try {
      const project = await api.createWorkspaceProject(
        authToken,
        buildProjectPayloadFromMessage(message, activeThread),
        activeWorkspaceId
      );
      await Promise.all([
        loadWorkspaceConversations(authToken, activeWorkspaceId),
        loadExecutionSummary(authToken, activeWorkspaceId),
        loadWorkspaceNotifications(authToken, activeWorkspaceId, { toastOnError: false })
      ]);
      pushToast({
        title: "Project linked to conversation",
        body: `${project.name} is now tracked from this thread.`
      });
    } catch (error) {
      pushToast({
        title: "Unable to create linked project",
        body: error.message || "Please try again."
      });
    }
  }

  async function handleOpenProjectLinkPicker(message) {
    if (!authToken || !activeWorkspaceId || !activeThread?.conversationId || activeThread?.isBot || !message) {
      return;
    }

    setProjectLinkTargetMessage(message);
    setProjectLinkSelectedProjectId("");
    setProjectLinkOptionsLoading(true);

    try {
      const payload = await api.getWorkspaceProjects(authToken, activeWorkspaceId);
      const nextProjects = Array.isArray(payload?.projects) ? payload.projects : [];
      const practicalProjects = nextProjects.filter((project) => project.status !== "completed");
      const resolvedProjects = practicalProjects.length ? practicalProjects : nextProjects;
      setProjectLinkOptions(resolvedProjects);
    } catch (error) {
      setProjectLinkOptions([]);
      pushToast({
        title: "Projects unavailable",
        body: error.message || "Unable to load projects for attachment."
      });
    } finally {
      setProjectLinkOptionsLoading(false);
    }
  }

  function handleCancelProjectLink() {
    setProjectLinkTargetMessage(null);
    setProjectLinkSelectedProjectId("");
  }

  async function handleConfirmProjectLink() {
    if (!authToken || !activeWorkspaceId || !projectLinkTargetMessage || !projectLinkSelectedProjectId || !activeThread?.conversationId) {
      return;
    }

    setProjectLinkSubmitting(true);
    try {
      const response = await api.attachWorkspaceProjectConversationLink(
        authToken,
        projectLinkSelectedProjectId,
        buildConversationSourcePayloadFromMessage(projectLinkTargetMessage, activeThread),
        activeWorkspaceId
      );

      await loadWorkspaceConversations(authToken, activeWorkspaceId);
      pushToast({
        title: response?.alreadyLinked ? "Project already linked" : "Conversation attached to project",
        body: response?.project?.name
          ? `${response.project.name} is now connected to this conversation.`
          : "The selected project is now connected to this conversation."
      });
      setProjectLinkTargetMessage(null);
      setProjectLinkSelectedProjectId("");
    } catch (error) {
      pushToast({
        title: "Unable to attach project",
        body: error.message || "Please try again."
      });
    } finally {
      setProjectLinkSubmitting(false);
    }
  }

  return {
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
  };
}

export function useWorkspaceNavigationActions({
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
}) {
  const handleMarkAllWorkspaceNotificationsRead = useCallback(async () => {
    if (!authToken || !activeWorkspaceId || markingAllWorkspaceNotificationsRead || !workspaceNotificationCount) {
      return;
    }

    setMarkingAllWorkspaceNotificationsRead(true);
    try {
      await api.markAllWorkspaceNotificationsRead(authToken, activeWorkspaceId);
      setWorkspaceNotifications([]);
      setWorkspaceNotificationCount(0);
    } catch (error) {
      pushToast({
        title: "Unable to mark notifications",
        body: error.message || "Please try again."
      });
    } finally {
      setMarkingAllWorkspaceNotificationsRead(false);
    }
  }, [activeWorkspaceId, authToken, markingAllWorkspaceNotificationsRead, pushToast, workspaceNotificationCount]);

  function handleOverviewNavigate(target) {
    if (!target?.scope) {
      return;
    }

    if (target.scope === "tasks") {
      const taskUrl = new URL(window.location.href);
      taskUrl.searchParams.set("view", "tasks");
      if (target.taskView) {
        taskUrl.searchParams.set("taskView", target.taskView);
      } else {
        taskUrl.searchParams.delete("taskView");
      }
      if (target.taskId) {
        taskUrl.searchParams.set("taskId", target.taskId);
      } else {
        taskUrl.searchParams.delete("taskId");
      }
      if (target.projectId) {
        taskUrl.searchParams.set("projectId", target.projectId);
      } else {
        taskUrl.searchParams.delete("projectId");
      }
      if (target.projectName) {
        taskUrl.searchParams.set("projectName", target.projectName);
      } else {
        taskUrl.searchParams.delete("projectName");
      }
      if (target.composer) {
        taskUrl.searchParams.set("composer", target.composer);
      } else {
        taskUrl.searchParams.delete("composer");
      }
      const popup = window.open(
        taskUrl.toString(),
        "witch-task-window",
        "popup=yes,width=1180,height=860,left=90,top=60,resizable=yes,scrollbars=yes"
      );

      if (popup) {
        popup.focus();
        return;
      }

      window.location.href = taskUrl.toString();
      return;
    }

    if (target.scope === "projects") {
      const projectUrl = new URL(window.location.href);
      projectUrl.searchParams.set("view", "projects");
      if (target.projectId) {
        projectUrl.searchParams.set("projectId", target.projectId);
      } else {
        projectUrl.searchParams.delete("projectId");
      }
      if (target.composer) {
        projectUrl.searchParams.set("composer", target.composer);
      } else {
        projectUrl.searchParams.delete("composer");
      }
      if (target.projectName) {
        projectUrl.searchParams.set("projectName", target.projectName);
      } else {
        projectUrl.searchParams.delete("projectName");
      }
      const popup = window.open(
        projectUrl.toString(),
        "witch-project-window",
        "popup=yes,width=1240,height=900,left=100,top=60,resizable=yes,scrollbars=yes"
      );

      if (popup) {
        popup.focus();
        return;
      }

      window.location.href = projectUrl.toString();
      return;
    }

    if (!canAccessWorkspaceScope(target.scope, effectiveWorkspaceScope)) {
      return;
    }

    const threadId = target.scope === "warehouse" ? "warebot" : "financebot";
    setDetailMetric(null);
    setActiveNav(target.scope === "warehouse" ? "warehouse" : "finances");
    openThread(threadId);

    if (target.tab) {
      setActiveTab(target.tab);
    }

    if (target.metricId) {
      const metric = metricCards.find((entry) => entry.id === target.metricId);
      if (metric) {
        setDetailMetric(metric);
      }
    }
  }

  const handleOpenWorkspaceNotification = useCallback(async (notification) => {
    if (!notification) {
      return;
    }

    if (authToken && activeWorkspaceId && notification.id) {
      try {
        await api.markWorkspaceNotificationRead(authToken, notification.id, activeWorkspaceId);
      } catch {
        // Ignore read-state sync failures and continue opening the target.
      }
    }

    setWorkspaceNotifications((current) => current.filter((entry) => entry.id !== notification.id));
    setWorkspaceNotificationCount((current) => Math.max(0, current - 1));

    if (notification.referenceType === "project") {
      handleOverviewNavigate({
        scope: "projects",
        projectId: notification.referenceId
      });
      return;
    }

    handleOverviewNavigate({
      scope: "tasks",
      taskId: notification.referenceId,
      taskView:
        notification.type === "task_overdue"
          ? "overdue"
          : notification.type === "task_due_soon"
            ? "today"
            : "my"
    });
  }, [activeWorkspaceId, authToken]);

  function buildReportMetrics() {
    const pendingInvoices = workspaceState.invoices.filter((invoice) => ["pending", "partial"].includes(invoice.status));
    const overdueInvoices = workspaceState.invoices.filter((invoice) => invoice.status === "overdue");
    const lowStock = workspaceState.products.filter(isWarehouseLowStock);
    const inTransit = workspaceState.orders.filter((order) => order.status === "in_transit");
    const grossProfit = financeProfitLossReport?.normalizedTotals?.grossProfit || 0;
    const netCashFlow = financeCashFlowReport?.normalizedTotals?.netCashFlow || 0;
    const inventoryValue = warehouseInventoryValueReport
      ? sumCurrencyBucketInBaseCurrency(warehouseInventoryValueReport.totals || {}, workspaceDefaultCurrency)
      : 0;
    return [
      { label: "Pending invoices", value: `${pendingInvoices.length}` },
      { label: "Overdue", value: `${overdueInvoices.length}` },
      { label: "Low stock", value: `${lowStock.length}` },
      { label: "In transit", value: `${inTransit.length}` },
      { label: "Gross profit", value: `approx. ${formatMoney(grossProfit, workspaceDefaultCurrency)}` },
      { label: "Net cash flow", value: `approx. ${formatMoney(netCashFlow, workspaceDefaultCurrency)}` },
      { label: "Inventory value", value: `approx. ${formatMoney(inventoryValue, workspaceDefaultCurrency)}` }
    ];
  }

  async function runCommand(commandText) {
    const trimmed = commandText.trim();
    const [command, ...rest] = trimmed.split(/\s+/);
    const matchingCommand = COMMAND_ITEMS.find((item) => item.command.split(" ")[0] === command);

    if (!command.startsWith("/")) {
      setDraft(commandText);
      return;
    }

    if (matchingCommand && !canAccessWorkspaceScope(matchingCommand.scope, effectiveWorkspaceScope)) {
      pushToast({
        title: "Command unavailable here",
        body: `Switch to the ${matchingCommand.scope} workspace to use ${command}.`
      });
      return;
    }

    if (matchingCommand?.scope === "finance") {
      const needsCreateAccess = command === "/invoice" || command === "/expense";
      const allowed = needsCreateAccess ? financePermissions.canCreate : financePermissions.canView;
      if (!allowed) {
        pushToast({
          title: "Command unavailable",
          body: needsCreateAccess
            ? "Your finance role does not allow creating or editing finance records."
            : "Your finance role does not allow using this finance command."
        });
        return;
      }
    }

    if (command === "/report" && activeThread && canAccessWorkspaceScope("finance", effectiveWorkspaceScope) && financePermissions.canView) {
      appendMessage(activeThread.id, {
        type: "report",
        content: "Business report generated.",
        metadata: {
          metrics: buildReportMetrics()
        }
      });
      setDraft("");
      return;
    }

    if (command === "/invoice" && canAccessWorkspaceScope("finance", effectiveWorkspaceScope) && financePermissions.canCreate) {
      const invoiceNumber = rest[0] || `#INV-${Math.floor(Math.random() * 900 + 100)}`;
      await createInvoiceEntry({
        invoiceNumber,
        customerName: activeThread?.isBot ? "Client account" : activeThread?.name || "Client account",
        amount: rest[1] || "9800",
        dueDate: new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10)
      });
      return;
    }

    if (command === "/stock" && canAccessWorkspaceScope("warehouse", effectiveWorkspaceScope)) {
      await createWarehouseProductEntry({
        name: rest.join(" ") || "Unknown item",
        sku: `SKU-${Math.floor(Math.random() * 900 + 100)}`,
        currentStock: 22,
        minimumStock: 50,
        reorderQuantity: 150
      });
      return;
    }

    if (command === "/expense" && canAccessWorkspaceScope("finance", effectiveWorkspaceScope) && financePermissions.canCreate) {
      await createExpenseEntry({
        amount: rest[0] || "",
        category: rest[1] || "other",
        vendorName: "",
        note: ""
      });
      return;
    }

    if (command === "/order" && canAccessWorkspaceScope("warehouse", effectiveWorkspaceScope)) {
      await createWarehouseOrderEntry({
        orderNumber: rest[0] || `#ORD-${Math.floor(Math.random() * 9000 + 1000)}`,
        destination: "Regional Delivery Hub",
        estimatedDelivery: new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10),
        status: "dispatched",
        currentStep: 1
      });
    }
  }

  return {
    handleMarkAllWorkspaceNotificationsRead,
    handleOverviewNavigate,
    handleOpenWorkspaceNotification,
    runCommand
  };
}
