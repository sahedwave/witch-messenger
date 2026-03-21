import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { REACTIONS } from "../WorkspaceMessenger.constants.js";
import { formatTime, isCoarsePointer, useNotifications } from "../WorkspaceMessenger.utils.js";
import { ExpenseMessageCard, InvoiceMessageCard, LinkedWorkMessageCard, ReportMessageCard } from "./FinanceMessageCards.jsx";
import { ShipmentMessageCard, StockAlertMessageCard } from "../warehouse/WarehousePanels.jsx";

export function useMessageInteractionState({
  workspaceState,
  workspaceMode,
  activePicker,
  setActivePicker,
  setReactions,
  seededReactionsRef
}) {
  const reactionNameMap = useMemo(() => {
    const map = {
      [workspaceState.currentUser.id]: workspaceState.currentUser.name,
      me: workspaceState.currentUser.name,
      financebot: "FinanceBot",
      warebot: "WareBot"
    };

    if (workspaceMode === "demo") {
      map.sarah = "Sarah Khan";
    }

    workspaceState.threads.forEach((thread) => {
      map[thread.id] = thread.name;
      thread.messages.forEach((message) => {
        map[message.senderId] = message.senderName;
      });
    });

    return map;
  }, [workspaceMode, workspaceState.currentUser.id, workspaceState.currentUser.name, workspaceState.threads]);

  const resolveReactionUserName = useCallback((userId) => reactionNameMap[userId] || userId, [reactionNameMap]);

  useEffect(() => {
    if (seededReactionsRef.current || !workspaceState.threads.length) {
      return;
    }

    const financeThread = workspaceState.threads.find((thread) => thread.id === "financebot");
    const warehouseThread = workspaceState.threads.find((thread) => thread.id === "warebot");

    setReactions((current) => {
      if (Object.keys(current).length) {
        return current;
      }

      const seeded = {};
      if (financeThread?.messages[0]?.id) {
        seeded[financeThread.messages[0].id] =
          workspaceMode === "real" ? { "👍": ["financebot"] } : { "👍": ["sarah", "financebot"] };
      }
      if (warehouseThread?.messages[0]?.id) {
        seeded[warehouseThread.messages[0].id] =
          workspaceMode === "real" ? { "🔥": ["warebot"] } : { "🔥": ["warebot"], "😂": ["sarah"] };
      }
      return seeded;
    });
    seededReactionsRef.current = true;
  }, [seededReactionsRef, setReactions, workspaceMode, workspaceState.threads]);

  useEffect(() => {
    if (!activePicker) {
      return undefined;
    }

    function handlePointerDown(event) {
      const pickerHost = event.target.closest?.("[data-reaction-host]");
      if (!pickerHost) {
        setActivePicker(null);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [activePicker, setActivePicker]);

  const handleReact = useCallback((messageId, emoji) => {
    const currentUserId = workspaceState.currentUser.id;
    setReactions((previous) => {
      const messageReactions = { ...(previous[messageId] || {}) };
      const alreadyReacted = !!previous[messageId]?.[emoji]?.includes(currentUserId);

      Object.keys(messageReactions).forEach((key) => {
        messageReactions[key] = (messageReactions[key] || []).filter((userId) => userId !== currentUserId);
        if (!messageReactions[key].length) {
          delete messageReactions[key];
        }
      });

      if (!alreadyReacted) {
        messageReactions[emoji] = [...(messageReactions[emoji] || []), currentUserId];
      }

      const next = { ...previous };
      if (Object.keys(messageReactions).length) {
        next[messageId] = messageReactions;
      } else {
        delete next[messageId];
      }
      return next;
    });
    setActivePicker(null);
  }, [setActivePicker, setReactions, workspaceState.currentUser.id]);

  return {
    reactionNameMap,
    resolveReactionUserName,
    handleReact
  };
}

export function useLongPress(callback, delay = 500) {
  const timerRef = useRef(null);
  const isLongPressRef = useRef(false);

  function clearTimer() {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function start(event) {
    isLongPressRef.current = false;
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      isLongPressRef.current = true;
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(30);
      }
      callback(event);
    }, delay);
  }

  function stop() {
    clearTimer();
  }

  function click(event) {
    if (isLongPressRef.current) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  useEffect(() => () => clearTimer(), []);

  return {
    onMouseDown: start,
    onMouseUp: stop,
    onMouseLeave: stop,
    onTouchStart: start,
    onTouchEnd: stop,
    onClick: click
  };
}

export function ReactionPicker({ isOwn, onSelect, onClose }) {
  const [visible, setVisible] = useState(false);
  const [hoveredEmoji, setHoveredEmoji] = useState(null);
  const closeTimerRef = useRef(null);

  function clearCloseTimer() {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function scheduleClose() {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setVisible(false);
      window.setTimeout(onClose, 160);
    }, 3000);
  }

  useEffect(() => {
    const raf = window.requestAnimationFrame(() => setVisible(true));
    scheduleClose();
    return () => {
      window.cancelAnimationFrame(raf);
      clearCloseTimer();
    };
  }, []);

  function handleSelect(emoji) {
    clearCloseTimer();
    setVisible(false);
    window.setTimeout(() => onSelect(emoji), 150);
  }

  return (
    <>
      <button
        type="button"
        aria-label="Close reactions"
        onClick={onClose}
        className="fixed inset-0 z-[99] bg-transparent"
      />
      <div
        onMouseEnter={scheduleClose}
        onMouseMove={scheduleClose}
        onTouchStart={scheduleClose}
        className={`absolute bottom-[calc(100%+10px)] z-[100] ${
          isOwn ? "right-0" : "left-0"
        }`}
        style={{
          background: "rgba(20,12,35,0.97)",
          backdropFilter: "blur(20px)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 999,
          padding: "8px 10px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)",
          display: "flex",
          alignItems: "center",
          gap: 2,
          transform: visible ? "translateY(0) scale(1)" : "translateY(8px) scale(0.85)",
          opacity: visible ? 1 : 0,
          transition: "transform 220ms cubic-bezier(0.34,1.56,0.64,1), opacity 180ms ease",
          fontFamily: '"Sora", sans-serif'
        }}
      >
        {REACTIONS.map((reaction, index) => (
          <div key={reaction.emoji} className="relative">
            {hoveredEmoji === reaction.emoji ? (
              <div
                className="pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-1 text-[10px] font-semibold text-white"
                style={{
                  bottom: "110%",
                  background: "rgba(0,0,0,0.82)"
                }}
              >
                {reaction.label}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => handleSelect(reaction.emoji)}
              onMouseEnter={() => {
                setHoveredEmoji(reaction.emoji);
                scheduleClose();
              }}
              onMouseLeave={() => setHoveredEmoji(null)}
              className="relative z-[1] flex h-[38px] w-[38px] items-center justify-center rounded-full border-none text-[22px]"
              style={{
                background: hoveredEmoji === reaction.emoji ? "rgba(255,255,255,0.12)" : "transparent",
                transform: hoveredEmoji === reaction.emoji ? "scale(1.5) translateY(-4px)" : "scale(1)",
                transition: "transform 150ms cubic-bezier(0.34,1.56,0.64,1), background 150ms ease"
              }}
            >
              {reaction.emoji}
            </button>
            {index === 2 ? (
              <div
                style={{
                  position: "absolute",
                  right: -3,
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: 1,
                  height: 24,
                  background: "rgba(255,255,255,0.12)"
                }}
              />
            ) : null}
          </div>
        ))}
      </div>
    </>
  );
}

export function ReactionSummary({ reactions, currentUserId, onReact, resolveReactionUserName }) {
  const [tooltip, setTooltip] = useState(null);

  return (
    <div className="relative mt-1 flex flex-wrap gap-1">
      {Object.entries(reactions).map(([emoji, users]) => {
        if (!users.length) {
          return null;
        }

        const iReacted = users.includes(currentUserId);
        const names = users.map((userId) => resolveReactionUserName(userId));

        return (
          <div key={emoji} className="relative">
            {tooltip === emoji ? (
              <div
                className="absolute bottom-[120%] left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[11px] text-white shadow-[0_4px_12px_rgba(0,0,0,0.3)]"
                style={{
                  background: "rgba(0,0,0,0.9)",
                  fontFamily: '"Sora", sans-serif'
                }}
              >
                {names.slice(0, 3).join(", ")}
                {names.length > 3 ? ` +${names.length - 3} others` : ""}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => onReact(emoji)}
              onMouseEnter={() => setTooltip(emoji)}
              onMouseLeave={() => setTooltip(null)}
              className="workspace-reaction-pop flex items-center gap-1 rounded-full px-2 py-1 text-[13px] text-white transition"
              style={{
                border: iReacted ? "1px solid rgba(255,111,216,0.5)" : "1px solid rgba(255,255,255,0.12)",
                background: iReacted ? "rgba(255,111,216,0.15)" : "rgba(255,255,255,0.07)",
                fontFamily: '"Sora", sans-serif'
              }}
            >
              <span>{emoji}</span>
              <span
                key={`${emoji}-${users.length}`}
                className="workspace-reaction-count-flip text-[11px] font-semibold"
                style={{
                  color: iReacted ? "#ff6fd8" : "rgba(255,255,255,0.7)"
                }}
              >
                {users.length}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function MessageBubble({
  message,
  currentUser,
  currentThread,
  role,
  financeMode = false,
  reactions,
  activePicker,
  setActivePicker,
  onReact,
  resolveReactionUserName,
  onApproveInvoice,
  onEditInvoice,
  onStartRejectInvoice,
  onRejectReasonChange,
  onConfirmRejectInvoice,
  onReorderStart,
  onReorderChange,
  onReorderConfirm,
  onDismissStockAlert,
  onMarkDelivered,
  onUpdateShipmentStatus,
  onExpenseNoteChange,
  onLogExpense,
  onApproveExpense,
  onStartRejectExpense,
  onRejectExpenseChange,
  onConfirmRejectExpense,
  onStartReimburseExpense,
  onReimburseExpenseChange,
  onConfirmReimburseExpense,
  onEditExpense,
  financePermissions,
  onMarkPaidInvoice,
  onDownloadInvoicePdf,
  downloadingInvoicePdfId = null,
  onIssueRecurringInvoice,
  onReconcileInvoice,
  onReconcileExpense,
  showFinanceAccounting = true,
  canManageFinanceMembers = false,
  canCreateLinkedWork = false,
  onCreateTaskFromMessage = null,
  onCreateProjectFromMessage = null,
  onAttachProjectMessage = null
}) {
  const isMe = message.senderId === currentUser.id || message.senderId === "me";
  const bubbleRef = useRef(null);
  const hoverTimerRef = useRef(null);
  const isTouch = useMemo(() => isCoarsePointer(), []);
  const messageReactions = reactions[message.id] || {};
  const hasReactions = Object.keys(messageReactions).length > 0;
  const canReact = message.type !== "system" || currentThread.isBot;

  function clearHoverTimer() {
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }

  const longPressProps = useLongPress(() => {
    if (canReact) {
      setActivePicker(message.id);
    }
  }, 500);

  useEffect(() => () => clearHoverTimer(), []);

  function handleMouseEnter() {
    if (isTouch || !canReact) {
      return;
    }
    clearHoverTimer();
    hoverTimerRef.current = window.setTimeout(() => {
      setActivePicker(message.id);
    }, 400);
  }

  function handleMouseLeave() {
    clearHoverTimer();
  }

  const bubbleTriggerProps = canReact
    ? {
        ...longPressProps,
        onMouseEnter: handleMouseEnter,
        onMouseLeave: handleMouseLeave
      }
    : {};

  const bubbleBody =
    message.type === "system" && message.metadata?.linkedWork ? (
      <LinkedWorkMessageCard message={message} financeMode={financeMode} />
    ) : message.type !== "text" && message.type !== "system" ? (
      <div className="max-w-[540px]">
        {message.type === "invoice" ? (
          <InvoiceMessageCard
            message={message}
            currentUser={currentUser}
            onEdit={onEditInvoice}
            onApprove={onApproveInvoice}
            onRejectStart={onStartRejectInvoice}
            onRejectChange={onRejectReasonChange}
            onRejectConfirm={onConfirmRejectInvoice}
            onMarkPaid={onMarkPaidInvoice}
            onDownloadPdf={onDownloadInvoicePdf}
            downloadingPdf={downloadingInvoicePdfId === message.metadata.invoiceId}
            onIssueRecurring={onIssueRecurringInvoice}
            onReconcile={onReconcileInvoice}
            showAccounting={showFinanceAccounting}
            canEdit={financePermissions?.canEdit}
            canApprove={financePermissions?.canApprove}
            canMarkPaid={financePermissions?.canMarkPaid}
            canReconcile={financePermissions?.canReconcile}
          />
        ) : null}
        {message.type === "stock_alert" ? (
          <StockAlertMessageCard
            message={message}
            onReorderStart={onReorderStart}
            onReorderChange={onReorderChange}
            onReorderConfirm={onReorderConfirm}
            onDismiss={onDismissStockAlert}
          />
        ) : null}
        {message.type === "shipment" ? (
          <ShipmentMessageCard
            message={message}
            canManage={role !== "finance"}
            onMarkDelivered={onMarkDelivered}
            onUpdateStatus={onUpdateShipmentStatus}
          />
        ) : null}
        {message.type === "expense" ? (
          <ExpenseMessageCard
            message={message}
            onNoteChange={onExpenseNoteChange}
            onLogExpense={onLogExpense}
            onApproveExpense={onApproveExpense}
            onStartRejectExpense={onStartRejectExpense}
            onRejectExpenseChange={onRejectExpenseChange}
            onConfirmRejectExpense={onConfirmRejectExpense}
            onStartReimburseExpense={onStartReimburseExpense}
            onReimburseExpenseChange={onReimburseExpenseChange}
            onConfirmReimburseExpense={onConfirmReimburseExpense}
            onEditExpense={onEditExpense}
            onReconcileExpense={onReconcileExpense}
            showAccounting={showFinanceAccounting}
            canEdit={financePermissions?.canEdit}
            canOperate={financePermissions?.canEdit}
            canManageWorkflow={canManageFinanceMembers}
            canReimburse={financePermissions?.canEdit}
            canReconcile={financePermissions?.canReconcile}
          />
        ) : null}
        {message.type === "report" ? <ReportMessageCard message={message} /> : null}
        <p className={`mt-2 text-xs ${financeMode ? "text-slate-500" : "text-slate-400"}`}>{formatTime(message.createdAt)}</p>
      </div>
    ) : message.type === "system" && financeMode ? (
      <div
        className="max-w-[640px] rounded-2xl px-4 py-3"
        style={{
          background: "rgba(245,158,11,0.08)",
          border: "1px solid rgba(245,158,11,0.18)",
          color: "#f8fafc"
        }}
      >
        <p className="text-sm leading-6">{message.content}</p>
        <p className="mt-2 text-xs text-amber-300/80">{formatTime(message.createdAt)}</p>
      </div>
    ) : (
      <div
        className={`max-w-[560px] rounded-2xl px-4 py-3 ${
          financeMode
            ? isMe
              ? "text-white"
              : "text-slate-100"
            : isMe
              ? "bg-[#2D8EFF] text-white"
              : "bg-white text-slate-800 shadow-sm ring-1 ring-slate-200"
        }`}
        style={
          financeMode
            ? isMe
              ? {
                  background: "linear-gradient(135deg,#10b981,#059669)",
                  boxShadow: "0 14px 32px rgba(5,150,105,0.18)"
                }
              : {
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.08)"
                }
            : undefined
        }
      >
        <p className="text-sm leading-6">{message.content}</p>
        <p className={`mt-2 text-xs ${financeMode ? (isMe ? "text-white/70" : "text-slate-500") : isMe ? "text-white/70" : "text-slate-400"}`}>{formatTime(message.createdAt)}</p>
      </div>
    );

  return (
    <div className={`flex flex-col ${isMe ? "items-end" : "items-start"}`} style={{ marginBottom: hasReactions ? 18 : 8 }}>
      <div className={`relative flex ${isMe ? "justify-end" : "justify-start"}`}>
        <div ref={bubbleRef} className="relative" style={{ userSelect: "none" }} {...bubbleTriggerProps}>
          {bubbleBody}
          {activePicker === message.id && canReact ? (
            <ReactionPicker
              isOwn={isMe}
              onClose={() => setActivePicker(null)}
              onSelect={(emoji) => onReact(message.id, emoji)}
            />
          ) : null}
        </div>
      </div>
      {canCreateLinkedWork && message.type !== "system" ? (
        <div className={`mt-2 flex gap-2 ${isMe ? "justify-end" : "justify-start"}`}>
          <button
            type="button"
            onClick={() => onCreateTaskFromMessage?.(message)}
            className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
              financeMode
                ? "border border-white/10 bg-white/5 text-slate-200"
                : "border border-slate-200 bg-white text-slate-600 shadow-sm"
            }`}
          >
            + Task
          </button>
          <button
            type="button"
            onClick={() => onCreateProjectFromMessage?.(message)}
            className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
              financeMode
                ? "border border-white/10 bg-white/5 text-slate-200"
                : "border border-slate-200 bg-white text-slate-600 shadow-sm"
            }`}
          >
            + Project
          </button>
          <button
            type="button"
            onClick={() => onAttachProjectMessage?.(message)}
            className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
              financeMode
                ? "border border-white/10 bg-white/5 text-slate-200"
                : "border border-slate-200 bg-white text-slate-600 shadow-sm"
            }`}
          >
            Attach
          </button>
        </div>
      ) : null}
      {hasReactions ? (
        <ReactionSummary
          reactions={messageReactions}
          currentUserId={currentUser.id}
          onReact={(emoji) => onReact(message.id, emoji)}
          resolveReactionUserName={resolveReactionUserName}
        />
      ) : null}
    </div>
  );
}

export function NotificationToasts({ onOpenThread }) {
  const { toasts, dismissToast } = useNotifications();

  return (
    <div className="pointer-events-none fixed right-6 top-6 z-[80] flex w-[320px] flex-col gap-3">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.button
            key={toast.id}
            initial={{ opacity: 0, x: 24, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 20, scale: 0.96 }}
            onClick={() => {
              onOpenThread(toast.threadId);
              dismissToast(toast.id);
            }}
            className="pointer-events-auto rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-[0_24px_48px_rgba(15,23,42,0.14)]"
          >
            <p className="text-sm font-bold text-slate-900">{toast.title}</p>
            <p className="mt-1 text-sm text-slate-500">{toast.body}</p>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
