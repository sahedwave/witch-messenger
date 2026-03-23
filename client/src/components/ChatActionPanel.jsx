import { useEffect, useMemo, useRef, useState } from "react";

import { Avatar } from "./Avatar";
import { CalendarFlyout } from "./CalendarFlyout";
import { InvoiceFlyout } from "./InvoiceFlyout";
import { MemoryCapsuleFlyout } from "./MemoryCapsuleFlyout";
import { PdfReviewFlyout } from "./PdfReviewFlyout";

function PdfIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
      <path d="M9 15h6" />
      <path d="M9 11h2" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 3v3" />
      <path d="M17 3v3" />
      <rect x="4" y="5" width="16" height="15" rx="3" />
      <path d="M4 10h16" />
      <path d="M8 14h.01" />
      <path d="M12 14h.01" />
      <path d="M16 14h.01" />
    </svg>
  );
}

function ReceiptIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3h8a2 2 0 0 1 2 2v15l-3-2-3 2-3-2-3 2V5a2 2 0 0 1 2-2z" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
      <path d="M9 16h4" />
    </svg>
  );
}

function CapsuleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l2.5 2.5" />
      <path d="M12 5v1.5" />
    </svg>
  );
}

const dockItems = [
  { id: "pdfReview", label: "PDF review", glyph: <PdfIcon />, tone: "is-green" },
  { id: "calendar", label: "Calendar", glyph: <CalendarIcon />, tone: "is-blue" },
  { id: "invoice", label: "Invoice viewer", glyph: <ReceiptIcon />, tone: "is-dark" },
  { id: "memoryCapsule", label: "Memory capsule", glyph: <CapsuleIcon />, tone: "is-cyan" }
];

function formatLastActive(contact) {
  if (!contact?.lastActiveAt) {
    return "Last active unavailable";
  }

  const deltaMinutes = Math.round((new Date(contact.lastActiveAt).getTime() - Date.now()) / 60000);
  const formatter = new Intl.RelativeTimeFormat([], { numeric: "auto" });

  if (Math.abs(deltaMinutes) < 60) {
    return formatter.format(deltaMinutes, "minute");
  }

  if (Math.abs(deltaMinutes) < 1440) {
    return formatter.format(Math.round(deltaMinutes / 60), "hour");
  }

  return formatter.format(Math.round(deltaMinutes / 1440), "day");
}

function ActionButton({ active = false, glyph, label, onClick, tone = "default" }) {
  return (
    <button
      type="button"
      className={`action-panel-button ${active ? "is-active" : ""} ${tone === "danger" ? "is-danger" : ""}`}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {glyph ? (
        <span className="action-panel-button-glyph" aria-hidden="true">
          {glyph}
        </span>
      ) : null}
      <span className="action-panel-button-label">{label}</span>
    </button>
  );
}

const actionItems = [
  { id: "favorite", glyph: "★", label: "Favorite" },
  { id: "labels", glyph: "#", label: "Labels" },
  { id: "pin", glyph: "📌", label: "Pin" },
  { id: "mute", glyph: "🔕", label: "Mute" },
  { id: "nickname", glyph: "Aa", label: "Nickname" },
  { id: "export", glyph: "⇩", label: "Export" },
  { id: "archive", glyph: "Ar", label: "Archive" },
  { id: "restrict", glyph: "Rs", label: "Restrict" },
  { id: "block", glyph: "⛔", label: "Block", tone: "danger" }
];

export function ChatActionPanel({
  activeDock: controlledActiveDock = null,
  activeContact,
  calendarFocusEventId = null,
  calendarEvents,
  currentUserId,
  invoiceDocuments = [],
  memoryCapsules = [],
  isOpen = true,
  isOverlay = false,
  messages,
  pdfReviewSessions = [],
  onClose = () => {},
  onArchive,
  onActiveDockChange = () => {},
  onCreatePdfReviewSession,
  onDeleteInvoiceDocument,
  onDeleteMemoryCapsule,
  onOpenMemoryCapsule,
  onReactMemoryCapsule,
  onReplyMemoryCapsule,
  onRespondPdfReviewSession,
  onExportConversation,
  onSaveInvoiceDocument,
  onSaveMemoryCapsule,
  onUpdatePdfReviewSession,
  onRestrict,
  onSetLabels,
  onSetNickname,
  onCalendarEventsChange,
  onCalendarFocusHandled = () => {},
  onUpdateInvoiceStatus,
  onToggleBlock,
  onToggleFavorite,
  onToggleMute,
  onTogglePin
}) {
  const panelRef = useRef(null);
  const [internalActiveDock, setInternalActiveDock] = useState(null);
  const [showMore, setShowMore] = useState(false);
  const activeDock = controlledActiveDock ?? internalActiveDock;
  const summaryText = useMemo(() => {
    if (activeContact?.presenceStatus === "online") {
      return "Online now";
    }

    return formatLastActive(activeContact);
  }, [activeContact]);

  if (!isOpen) {
    return null;
  }

  function updateActiveDock(nextValue) {
    const resolvedValue =
      typeof nextValue === "function" ? nextValue(activeDock) : nextValue;
    setInternalActiveDock(resolvedValue);
    onActiveDockChange(resolvedValue);
  }

  useEffect(() => {
    if (isOverlay || (!activeDock && !showMore)) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (!panelRef.current?.contains(event.target)) {
        setShowMore(false);
        updateActiveDock(null);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [activeDock, isOverlay, showMore]);

  const activeDockPanel =
    activeDock === "calendar" ? (
      <CalendarFlyout
        activeContact={activeContact}
        events={calendarEvents}
        focusEventId={calendarFocusEventId}
        messages={messages}
        onEventsChange={onCalendarEventsChange}
        onFocusHandled={onCalendarFocusHandled}
      />
    ) : activeDock === "pdfReview" ? (
      <PdfReviewFlyout
        activeContact={activeContact}
        currentUserId={currentUserId}
        sessions={pdfReviewSessions}
        onCreateSession={onCreatePdfReviewSession}
        onRespondSession={onRespondPdfReviewSession}
        onUpdateSession={onUpdatePdfReviewSession}
      />
    ) : activeDock === "invoice" ? (
      <InvoiceFlyout
        activeContact={activeContact}
        documents={invoiceDocuments}
        onDeleteDocument={onDeleteInvoiceDocument}
        onSaveDocument={onSaveInvoiceDocument}
        onUpdateStatus={onUpdateInvoiceStatus}
      />
    ) : activeDock === "memoryCapsule" ? (
      <MemoryCapsuleFlyout
        activeContact={activeContact}
        capsules={memoryCapsules}
        currentUserId={currentUserId}
        onDeleteCapsule={onDeleteMemoryCapsule}
        onOpenCapsule={onOpenMemoryCapsule}
        onReactCapsule={onReactMemoryCapsule}
        onReplyCapsule={onReplyMemoryCapsule}
        onSaveCapsule={onSaveMemoryCapsule}
      />
    ) : null;

  const morePanel =
    showMore && activeContact ? (
      <section className={`chat-action-card compact secondary rail-flyout ${isOverlay ? "is-overlay-dropdown" : ""}`}>
        <div className="chat-action-flyout-head">
          <span className="avatar-shell">
            <Avatar user={activeContact} size="large" />
            <span
              className={`avatar-status avatar-status-${
                activeContact.presenceStatus === "online"
                  ? "online"
                  : activeContact.presenceStatus === "away"
                    ? "away"
                    : "offline"
              }`}
              aria-hidden="true"
            />
          </span>
          <div className="chat-action-mini-meta">
            <strong>{activeContact.displayName || activeContact.name}</strong>
            <span className="chat-action-mini-status">{summaryText}</span>
          </div>
        </div>
        <div className="chat-action-grid compact">
          {actionItems.map((item) => {
            const active =
              item.id === "favorite"
                ? Boolean(activeContact.isFavorite)
                : item.id === "pin"
                  ? Boolean(activeContact.isPinned)
                  : item.id === "mute"
                    ? Boolean(activeContact.isMuted)
                    : item.id === "archive"
                      ? Boolean(activeContact.isArchived)
                      : item.id === "restrict"
                        ? Boolean(activeContact.isRestricted)
                        : item.id === "block"
                          ? Boolean(activeContact.isBlocked)
                          : false;

            const onClick =
              item.id === "favorite"
                ? onToggleFavorite
                : item.id === "labels"
                  ? onSetLabels
                  : item.id === "pin"
                    ? onTogglePin
                    : item.id === "mute"
                      ? onToggleMute
                      : item.id === "nickname"
                        ? onSetNickname
                        : item.id === "export"
                          ? onExportConversation
                          : item.id === "archive"
                            ? onArchive
                            : item.id === "restrict"
                              ? onRestrict
                              : onToggleBlock;

            return (
              <ActionButton
                key={item.id}
                active={active}
                glyph={item.glyph}
                label={item.label}
                onClick={onClick}
                tone={item.tone}
              />
            );
          })}
        </div>
      </section>
    ) : null;

  const panelContent = (
    <>
      {isOverlay ? (
        <div className="chat-action-sheet-head">
          <strong>Conversation tools</strong>
          <button className="ghost-button compact-header-toggle" type="button" onClick={onClose}>
            Done
          </button>
        </div>
      ) : null}
      <div className="chat-action-dock-wrap">
        <section className="chat-action-dock">
          {dockItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`chat-dock-button ${item.tone} ${activeDock === item.id ? "is-active" : ""}`}
              aria-label={item.label}
              title={item.label}
              onClick={() => {
                setShowMore(false);
                if (
                  item.id === "calendar" ||
                  item.id === "pdfReview" ||
                  item.id === "invoice" ||
                  item.id === "memoryCapsule"
                ) {
                  updateActiveDock((current) => (current === item.id ? null : item.id));
                  return;
                }

                updateActiveDock(null);
              }}
            >
              {item.glyph}
            </button>
          ))}

          <button
            type="button"
            className="chat-dock-button is-muted"
            aria-label="More apps"
            title="More apps"
            onClick={() => {
              updateActiveDock(null);
              setShowMore((value) => !value);
            }}
          >
            +
          </button>
        </section>
        {isOverlay ? morePanel : null}
      </div>

      {activeDockPanel ? (
        <div className={isOverlay ? "" : "chat-action-active-flyout"}>{activeDockPanel}</div>
      ) : null}
      {morePanel && !isOverlay ? (
        <div className="chat-action-active-flyout is-more-panel">{morePanel}</div>
      ) : null}

    </>
  );

  if (isOverlay) {
    return (
      <div className="chat-action-panel-overlay">
        <button className="chat-action-panel-backdrop" type="button" aria-label="Close conversation tools" onClick={onClose} />
        <aside className="chat-action-panel chat-action-panel-sheet">{panelContent}</aside>
      </div>
    );
  }

  return <aside ref={panelRef} className={`chat-action-panel ${activeDock || showMore ? "has-active-dock" : ""}`}>{panelContent}</aside>;
}
