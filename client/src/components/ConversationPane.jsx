import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";

import snapToolbarLogo from "../assets/snap-toolbar-logo.svg";
import { Avatar } from "./Avatar";

const SnapViewer = lazy(() => import("../snap/SnapViewer"));
const SnapWindowMockup = lazy(() => import("./SnapWindowMockup"));

const reactionPalette = ["👍", "❤️", "😂", "🔥"];
const emojiPalette = ["😀", "😂", "😍", "👍", "🔥", "🎉", "🙏", "😎"];
const contentTabs = [
  ["chat", "Chat", "o"],
  ["media", "Media", "[]"],
  ["links", "Links", "<>"],
  ["pinned", "Pinned", "*"]
];

function formatTimestamp(value) {
  return new Intl.DateTimeFormat([], {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatClockTime(timeValue) {
  const [hourText = "0", minuteText = "00"] = (timeValue || "00:00").split(":");
  let hour = Number(hourText);
  const suffix = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  return `${hour}:${minuteText} ${suffix}`;
}

function formatDisplayDate(value) {
  const [year = "", month = "", day = ""] = String(value || "").split("-");
  return day && month && year ? `${day}/${month}/${year}` : value;
}

function formatMuteStatus(contact) {
  if (!contact?.isMuted) {
    return "Notifications on";
  }

  if (contact.muteDisabledForever) {
    return "Notifications off always";
  }

  if (contact.muteUntil) {
    return `Off until ${new Intl.DateTimeFormat([], {
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(contact.muteUntil))}`;
  }

  return "Notifications off";
}

function getSecondsLeft(value, now) {
  if (!value) {
    return 0;
  }

  return Math.max(0, Math.ceil((new Date(value).getTime() - now) / 1000));
}

function formatPdfReviewHistory(session) {
  if (session.status === "accepted") {
    return "PDF review active";
  }

  if (session.status === "completed") {
    return "PDF review completed";
  }

  if (session.status === "declined") {
    return "PDF review declined";
  }

  return "PDF review requested";
}

function formatHeaderPresence(contact, isTyping) {
  if (isTyping) {
    return `${contact.displayName || contact.name} is typing`;
  }

  if (contact.isGroup) {
    return `${contact.memberCount || contact.memberNames?.length || 0} members in this project group`;
  }

  if (contact.presenceStatus === "online") {
    return contact.deviceCount > 1 ? `Online on ${contact.deviceCount} devices` : "Online now";
  }

  if (contact.presenceStatus === "away") {
    return "Away";
  }

  if (contact.lastActiveAt) {
    const deltaMinutes = Math.round((new Date(contact.lastActiveAt).getTime() - Date.now()) / 60000);
    return `Last active ${new Intl.RelativeTimeFormat([], { numeric: "auto" }).format(deltaMinutes, "minute")}`;
  }

  return "Offline";
}

function groupMessages(messages) {
  const groups = [];

  messages.forEach((message) => {
    const previousGroup = groups[groups.length - 1];

    if (previousGroup && previousGroup.senderId === message.sender.id) {
      previousGroup.messages.push(message);
      return;
    }

    groups.push({
      id: `${message.sender.id}-${message.id}`,
      senderId: message.sender.id,
      sender: message.sender,
      messages: [message]
    });
  });

  return groups;
}

function renderAttachment(message, onOpenImage) {
  if (!message.attachment) {
    return null;
  }

  if (message.attachment.mimeType?.startsWith("image/")) {
    return (
      <button
        className="message-image-button"
        type="button"
        onClick={() => onOpenImage(message)}
      >
        <img className="message-image" src={message.attachment.dataUrl} alt={message.attachment.name} />
      </button>
    );
  }

  if (message.attachment.mimeType?.startsWith("audio/")) {
    return (
      <div className="message-attachment-card">
        <strong>{message.attachment.name}</strong>
        <audio controls src={message.attachment.dataUrl} />
      </div>
    );
  }

  return (
    <a
      className="message-attachment-card"
      href={message.attachment.dataUrl}
      download={message.attachment.name}
    >
      <strong>{message.attachment.name}</strong>
      <span>{message.attachment.mimeType || "File attachment"}</span>
    </a>
  );
}

function isMessageExpired(message, currentTime) {
  if (!message?.autoDeleteAt) {
    return false;
  }

  return new Date(message.autoDeleteAt).getTime() <= currentTime;
}

function MessageQuickActions({
  canEdit,
  onCreateEventFromMessage,
  onCreateTaskFromMessage,
  currentUserId,
  message,
  onCopy,
  onDeleteMessage,
  onForwardMessage,
  onReplyToMessage,
  onStartEdit,
  onToggleReaction
}) {
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const actionsRef = useRef(null);

  useEffect(() => {
    if (!showReactionPicker && !showMoreMenu) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (!actionsRef.current?.contains(event.target)) {
        setShowReactionPicker(false);
        setShowMoreMenu(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [showMoreMenu, showReactionPicker]);

  function closeMenus() {
    setShowReactionPicker(false);
    setShowMoreMenu(false);
  }

  return (
    <div className="message-quick-actions" ref={actionsRef}>
      <button
        className="ghost-button subtle-button compact message-action-trigger"
        type="button"
        onClick={() => {
          closeMenus();
          onReplyToMessage(message);
        }}
      >
        Reply
      </button>
      <button
        className="ghost-button subtle-button compact message-action-trigger"
        type="button"
        onClick={() => {
          closeMenus();
          onForwardMessage(message);
        }}
      >
        Forward
      </button>
      <div className={`message-action-slot ${showReactionPicker ? "is-open" : ""}`}>
        <button
          className="ghost-button subtle-button compact message-action-trigger"
          type="button"
          onClick={() => {
            setShowReactionPicker((current) => !current);
            setShowMoreMenu(false);
          }}
        >
          React
        </button>
        {showReactionPicker ? (
          <div className="message-action-popover reaction-popover" role="menu" aria-label="Reactions">
            {reactionPalette.map((emoji) => {
              const reaction = message.reactions.find((entry) => entry.emoji === emoji);
              const isActive = reaction?.users.includes(currentUserId);

              return (
                <button
                  key={emoji}
                  className={`reaction-button compact ${isActive ? "is-active" : ""}`}
                  type="button"
                  onClick={() => {
                    onToggleReaction(message.id, emoji);
                    setShowReactionPicker(false);
                  }}
                >
                  {emoji}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      <div className={`message-action-slot ${showMoreMenu ? "is-open" : ""}`}>
        <button
          className="ghost-button subtle-button compact message-action-trigger"
          type="button"
          onClick={() => {
            setShowMoreMenu((current) => !current);
            setShowReactionPicker(false);
          }}
        >
          More
        </button>
        {showMoreMenu ? (
          <div className="message-action-popover more-popover" role="menu" aria-label="More message actions">
            <button
              className="ghost-button subtle-button compact"
              type="button"
              onClick={() => {
                closeMenus();
                onCopy(message);
              }}
            >
              Copy
            </button>
            <button
              className="ghost-button subtle-button compact"
              type="button"
              onClick={() => {
                closeMenus();
                onCreateEventFromMessage(message);
              }}
            >
              Schedule
            </button>
            <button
              className="ghost-button subtle-button compact"
              type="button"
              onClick={() => {
                closeMenus();
                onCreateTaskFromMessage(message);
              }}
            >
              Task
            </button>
            {canEdit ? (
              <button
                className="ghost-button subtle-button compact"
                type="button"
                onClick={() => {
                  closeMenus();
                  onStartEdit(message);
                }}
              >
                Edit
              </button>
            ) : null}
            {canEdit ? (
              <button
                className="ghost-button subtle-button compact danger"
                type="button"
                onClick={() => {
                  closeMenus();
                  onDeleteMessage(message.id);
                }}
              >
                Delete
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ConversationPane({
  activeContact,
  attachment,
  bondState,
  calendarEvents = [],
  compactComposer = false,
  currentUserId,
  draft,
  editingMessageId,
  editingText,
  error,
  failedSend,
  forwardOptions = [],
  forwardMessage,
  forwardPickerMessage,
  hasMoreMessages,
  isTyping,
  loading,
  loadingOlderMessages,
  messageSearch,
  messages,
  pdfReviewSessions = [],
  onAcceptRequest,
  onAppendEmoji,
  onArchive,
  onAttachmentSelect,
  onBack,
  onBegTrustMode = () => {},
  onCancelEdit,
  onCreateEventFromMessage = () => {},
  onCreateProjectFromText = () => {},
  onCreateTaskFromMessage = () => {},
  onClearForwardMessage,
  onClearReplyTarget,
  onDeleteMessage,
  onDraftChange,
  onEditMessage,
  onEnableTrustMode = () => {},
  onEditingTextChange,
  onExportConversation,
  onForwardMessagePick = () => {},
  onForwardMessage,
  onForwardPickerDismiss = () => {},
  onIgnoreTrustMode = () => {},
  onLoadOlder,
  onOpenActionPanel = () => {},
  onOpenPlannerItem = () => {},
  onOpenSnap = async (message) => message,
  onOpenWorkspacePanel,
  onOpenWorkspaceChat = null,
  onSendSnapFile = async () => {},
  onDeleteCalendarEvent = () => {},
  onRemoveAttachment,
  onReplyToMessage,
  onRestoreFromTrash,
  onRestrict,
  onRetryFailedSend,
  onSearchChange,
  onSend,
  onSendVoiceMessage = async () => false,
  onSetLabels,
  onSetNickname,
  onStartEdit,
  onTrash,
  onToggleBlock,
  onToggleEmojiPicker,
  onToggleFavorite,
  onToggleCoupleMode = () => {},
  onToggleMute,
  onTogglePin,
  onTogglePinnedMessage,
  onToggleReaction,
  onToggleStar,
  onUnavailableAction = () => null,
  onUpdateCalendarEventStatus = () => {},
  onBackLayerChange = () => {},
  isActionPanelDocked = true,
  showBackButton = false,
  pinnedMessages,
  replyTarget,
  showEmojiPicker
}) {
  const messageEndRef = useRef(null);
  const topSentinelRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [viewerAttachment, setViewerAttachment] = useState(null);
  const [viewerSnap, setViewerSnap] = useState(null);
  const [openingSnapId, setOpeningSnapId] = useState(null);
  const [activeTab, setActiveTab] = useState("chat");
  const [showComposerTools, setShowComposerTools] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [activeTouchActionsMessageId, setActiveTouchActionsMessageId] = useState(null);
  const [swipeState, setSwipeState] = useState({ messageId: null, offset: 0 });
  const [desktopForwardPicker, setDesktopForwardPicker] = useState(null);
  const [desktopContextMenu, setDesktopContextMenu] = useState(null);
  const [desktopSwipeState, setDesktopSwipeState] = useState({ messageId: null, offset: 0 });
  const [activeDesktopSwipeMessageId, setActiveDesktopSwipeMessageId] = useState(null);
  const [detailMessageId, setDetailMessageId] = useState(null);
  const [showGhosting, setShowGhosting] = useState(false);
  const [showNotificationMenu, setShowNotificationMenu] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const [voiceSending, setVoiceSending] = useState(false);
  const projectTapRef = useRef({ messageId: null, count: 0, lastTapAt: 0 });
  const replyTapRef = useRef({ messageId: null, count: 0, lastTapAt: 0 });
  const desktopTapRef = useRef({ messageId: null, count: 0, lastTapAt: 0, timerId: null });
  const longPressTimerRef = useRef(null);
  const notificationMenuRef = useRef(null);
  const voiceRecorderRef = useRef(null);
  const voiceChunksRef = useRef([]);
  const voiceStreamRef = useRef(null);
  const voiceTimerRef = useRef(null);
  const desktopSwipeOffsetRef = useRef(0);
  const touchGestureRef = useRef({
    messageId: null,
    startX: 0,
    startY: 0,
    trackingSwipe: false
  });
  const desktopGestureRef = useRef({
    messageId: null,
    startX: 0,
    startY: 0,
    tracking: false
  });
  const visibleMessages = useMemo(
    () => messages.filter((message) => !isMessageExpired(message, now) || message.isSnap),
    [messages, now]
  );
  const groupedMessages = useMemo(() => groupMessages(visibleMessages), [visibleMessages]);
  const lastMessageId = visibleMessages[visibleMessages.length - 1]?.id;
  const notificationsMuted = Boolean(
    activeContact?.isMuted &&
      (activeContact?.muteDisabledForever ||
        !activeContact?.muteUntil ||
        new Date(activeContact.muteUntil).getTime() > Date.now())
  );
  const conversationCalendarItems = useMemo(
    () =>
      activeContact
        ? [...calendarEvents]
            .filter((event) => event.contactId === activeContact.id)
            .sort((first, second) => new Date(`${first.date}T${first.time}`) - new Date(`${second.date}T${second.time}`))
        : [],
    [activeContact, calendarEvents]
  );
  const upcomingConversationItems = useMemo(
    () =>
      conversationCalendarItems
        .filter((event) => event.status !== "cancelled")
        .slice(0, 4),
    [conversationCalendarItems]
  );
  const lastOutgoingMessageId = useMemo(() => {
    const lastOutgoingMessage = [...visibleMessages]
      .reverse()
      .find((message) => message.sender.id === currentUserId);

    return lastOutgoingMessage?.id || null;
  }, [currentUserId, visibleMessages]);

  const composerLocked =
    activeContact?.isBlocked ||
    activeContact?.hasBlockedYou ||
    activeContact?.isTrashed ||
    activeContact?.requestState === "pending" ||
    activeContact?.requestState === "sent";

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lastMessageId, isTyping]);

  useEffect(() => {
    setViewerAttachment(null);
    setViewerSnap(null);
    setOpeningSnapId(null);
    setActiveTab("chat");
    setActiveTouchActionsMessageId(null);
    setSwipeState({ messageId: null, offset: 0 });
    setDesktopForwardPicker(null);
    setDesktopContextMenu(null);
    setDesktopSwipeState({ messageId: null, offset: 0 });
    setActiveDesktopSwipeMessageId(null);
    setDetailMessageId(null);
    setShowGhosting(false);
    setShowNotificationMenu(false);
  }, [activeContact?.id]);

  useEffect(() => {
    const hasBackLayer = Boolean(
      viewerAttachment ||
        viewerSnap ||
        showGhosting ||
        showNotificationMenu
    );

    onBackLayerChange({
      active: hasBackLayer,
      handleBack: () => {
        if (showGhosting) {
          setShowGhosting(false);
          return true;
        }

        if (viewerSnap) {
          setViewerSnap(null);
          return true;
        }

        if (viewerAttachment) {
          setViewerAttachment(null);
          return true;
        }

        if (showNotificationMenu) {
          setShowNotificationMenu(false);
          return true;
        }

        return false;
      }
    });

    return () => {
      onBackLayerChange({
        active: false,
        handleBack: null
      });
    };
  }, [onBackLayerChange, showGhosting, showNotificationMenu, viewerAttachment, viewerSnap]);

  function openGhostingWindow() {
    setShowGhosting(true);
  }

  useEffect(() => {
    if (
      !bondState?.coupleRequestExpiresAt &&
      !bondState?.coupleCooldownUntil &&
      !bondState?.trustRequestExpiresAt &&
      !messages.some((message) => message.autoDeleteAt)
    ) {
      return undefined;
    }

    const timerId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timerId);
    };
  }, [bondState?.coupleCooldownUntil, bondState?.coupleRequestExpiresAt, bondState?.trustRequestExpiresAt, messages]);

  useEffect(() => {
    if (!topSentinelRef.current || !hasMoreMessages || loadingOlderMessages) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          onLoadOlder();
        }
      },
      { rootMargin: "60px" }
    );

    observer.observe(topSentinelRef.current);

    return () => {
      observer.disconnect();
    };
  }, [hasMoreMessages, loadingOlderMessages, onLoadOlder]);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        window.clearTimeout(longPressTimerRef.current);
      }

      if (desktopTapRef.current.timerId) {
        window.clearTimeout(desktopTapRef.current.timerId);
      }

      if (voiceTimerRef.current) {
        window.clearInterval(voiceTimerRef.current);
      }

      if (voiceStreamRef.current) {
        voiceStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    desktopSwipeOffsetRef.current = desktopSwipeState.offset;
  }, [desktopSwipeState.offset]);

  useEffect(() => {
    if (!desktopForwardPicker && !desktopContextMenu && !activeDesktopSwipeMessageId && !detailMessageId) {
      return undefined;
    }

    function handlePointerDown(event) {
      const insideInteractive = event.target.closest?.(
        ".desktop-forward-picker,.message-context-menu,.message-side-actions,.message-hover-reactions"
      );

      if (!insideInteractive) {
        setDesktopForwardPicker(null);
        setDesktopContextMenu(null);
        setActiveDesktopSwipeMessageId(null);
        setDesktopSwipeState({ messageId: null, offset: 0 });
        setDetailMessageId(null);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [activeDesktopSwipeMessageId, desktopContextMenu, desktopForwardPicker, detailMessageId]);

  useEffect(() => {
    if (!showNotificationMenu) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (!notificationMenuRef.current?.contains(event.target)) {
        setShowNotificationMenu(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [showNotificationMenu]);

  async function handleCopyMessage(message) {
    if (!message.text?.trim() || !navigator.clipboard) {
      return;
    }

    try {
      await navigator.clipboard.writeText(message.text);
    } catch (error) {
      console.error(error);
    }
  }

  async function handleOpenMessageAttachment(message) {
    if (message.isSnap) {
      if (message.autoDeleteAt && getSecondsLeft(message.autoDeleteAt, now) <= 0) {
        return;
      }

      try {
        setOpeningSnapId(message.id);
        const openedMessage = await onOpenSnap(message);
        if (openedMessage?.attachment) {
          setViewerSnap(openedMessage);
        }
      } finally {
        setOpeningSnapId(null);
      }
      return;
    }

    if (message.attachment) {
      setViewerAttachment(message.attachment);
    }
  }

  function stopVoiceStream() {
    if (voiceTimerRef.current) {
      window.clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }

    if (voiceStreamRef.current) {
      voiceStreamRef.current.getTracks().forEach((track) => track.stop());
      voiceStreamRef.current = null;
    }
  }

  async function startVoiceRecording() {
    if (voiceSending || isRecordingVoice) {
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType =
        typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      voiceChunksRef.current = [];
      voiceStreamRef.current = stream;
      voiceRecorderRef.current = recorder;

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data?.size) {
          voiceChunksRef.current.push(event.data);
        }
      });

      recorder.start();
      setVoiceSeconds(0);
      setIsRecordingVoice(true);
      voiceTimerRef.current = window.setInterval(() => {
        setVoiceSeconds((current) => current + 1);
      }, 1000);
    } catch (error) {
      onUnavailableAction(error?.message || "Microphone access");
    }
  }

  async function stopVoiceRecording({ discard = false } = {}) {
    const recorder = voiceRecorderRef.current;
    if (!recorder) {
      return;
    }

    setIsRecordingVoice(false);

    const recordedBlob = await new Promise((resolve) => {
      recorder.addEventListener(
        "stop",
        () => {
          const mimeType = voiceChunksRef.current[0]?.type || "audio/webm";
          resolve(new Blob(voiceChunksRef.current, { type: mimeType }));
        },
        { once: true }
      );
      recorder.stop();
    });

    voiceRecorderRef.current = null;
    stopVoiceStream();

    if (discard) {
      voiceChunksRef.current = [];
      setVoiceSeconds(0);
      return;
    }

    const extension = recordedBlob.type.includes("ogg") ? "ogg" : "webm";
    const voiceFile = new File([recordedBlob], `voice-${Date.now()}.${extension}`, {
      type: recordedBlob.type || "audio/webm"
    });

    voiceChunksRef.current = [];
    setVoiceSending(true);
    try {
      await onSendVoiceMessage(voiceFile);
    } finally {
      setVoiceSending(false);
      setVoiceSeconds(0);
    }
  }

  function handleComposerKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function hasDesktopPointer() {
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }

  function isPhoneLayout() {
    return window.innerWidth <= 900 && !hasDesktopPointer();
  }

  function isDesktopLayout() {
    return hasDesktopPointer();
  }

  function clearLongPressTimer() {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function handleMessageTouchStart(event, message) {
    if (!isPhoneLayout() || !message.text?.trim()) {
      return;
    }

    const touch = event.touches?.[0];
    if (!touch) {
      return;
    }

    clearLongPressTimer();
    touchGestureRef.current = {
      messageId: message.id,
      startX: touch.clientX,
      startY: touch.clientY,
      trackingSwipe: true
    };

    longPressTimerRef.current = window.setTimeout(() => {
      setActiveTouchActionsMessageId(message.id);
      setSwipeState({ messageId: null, offset: 0 });
      longPressTimerRef.current = null;
    }, 380);
  }

  function handleMessageTouchMove(event, message) {
    if (!isPhoneLayout()) {
      return;
    }

    const touch = event.touches?.[0];
    const gesture = touchGestureRef.current;
    if (!touch || gesture.messageId !== message.id || !gesture.trackingSwipe) {
      return;
    }

    const deltaX = touch.clientX - gesture.startX;
    const deltaY = touch.clientY - gesture.startY;

    if (Math.abs(deltaY) > 10) {
      clearLongPressTimer();
      touchGestureRef.current.trackingSwipe = false;
      setSwipeState({ messageId: null, offset: 0 });
      return;
    }

    if (Math.abs(deltaX) > 8) {
      clearLongPressTimer();
    }

    if (deltaX > 0) {
      setActiveTouchActionsMessageId(null);
      setSwipeState({
        messageId: message.id,
        offset: Math.min(72, deltaX)
      });
    } else {
      setSwipeState({ messageId: null, offset: 0 });
    }
  }

  function handleMessageTouchEnd(message) {
    if (!isPhoneLayout()) {
      return;
    }

    clearLongPressTimer();

    if (swipeState.messageId === message.id && swipeState.offset >= 54) {
      setSwipeState({ messageId: null, offset: 0 });
      setActiveTouchActionsMessageId(null);
      onReplyToMessage(message);
      return;
    }

    setSwipeState({ messageId: null, offset: 0 });
    touchGestureRef.current = {
      messageId: null,
      startX: 0,
      startY: 0,
      trackingSwipe: false
    };
  }

  if (!activeContact) {
    return (
      <section className="chat-window chat-empty">
        <div className="chat-empty-state">
          <div className="chat-empty-illustration" aria-hidden="true">
            <span className="chat-empty-orb chat-empty-orb-primary" />
            <span className="chat-empty-orb chat-empty-orb-secondary" />
            <span className="chat-empty-bubble chat-empty-bubble-large" />
            <span className="chat-empty-bubble chat-empty-bubble-small" />
          </div>
          <h2>Start a conversation</h2>
          <p>Select a contact from the sidebar to begin messaging.</p>
        </div>
      </section>
    );
  }

  const mediaMessages = visibleMessages.filter((message) => message.attachment?.mimeType?.startsWith("image/"));
  const linkMessages = visibleMessages.filter((message) => Boolean(message.linkPreview));
  const pinnedOnlyMessages = pinnedMessages || [];
  const canUseCoupleMode =
    !activeContact.isGroup &&
    !activeContact.isSelf &&
    !activeContact.isBlocked &&
    !activeContact.hasBlockedYou &&
    activeContact.requestState === "accepted";
  const showCoupleModeButton =
    !activeContact.isGroup &&
    !activeContact.isBlocked && !activeContact.hasBlockedYou && activeContact.requestState !== "pending";
  const coupleRequestSeconds = getSecondsLeft(bondState?.coupleRequestExpiresAt, now);
  const coupleCooldownSeconds = getSecondsLeft(bondState?.coupleCooldownUntil, now);
  const trustRequestSeconds = getSecondsLeft(bondState?.trustRequestExpiresAt, now);
  const isCouplePending = !bondState?.coupleActive && coupleRequestSeconds > 0 && Boolean(bondState?.coupleRequestedBy);
  const isTrustPending = !bondState?.trustActive && trustRequestSeconds > 0 && Boolean(bondState?.trustRequestedBy);
  const requestedCoupleByCurrentUser = bondState?.coupleRequestedBy === currentUserId;
  const requestedTrustByCurrentUser = bondState?.trustRequestedBy === currentUserId;
  const showTrustModal =
    canUseCoupleMode &&
    bondState?.coupleActive &&
    !bondState?.trustActive &&
    bondState?.trustPromptVisible;
  const showBegButton =
    canUseCoupleMode &&
    bondState?.coupleActive &&
    !bondState?.trustActive &&
    !bondState?.trustPromptVisible &&
    bondState?.begEligibleUserId === currentUserId;

  let trustLightTone = "gray";
  let trustLightLabel = `${activeContact.displayName || activeContact.name} is off the phone`;

  if (activeContact.presenceStatus === "online") {
    trustLightTone = "yellow";
    trustLightLabel = `${activeContact.displayName || activeContact.name} is in the inbox`;
  } else if (activeContact.presenceStatus === "away") {
    trustLightTone = "red";
    trustLightLabel = `${activeContact.displayName || activeContact.name} is on the phone away from the app`;
  }

  let coupleButtonLabel = "♡";

  if (bondState?.coupleActive) {
    coupleButtonLabel = "♥";
  } else if (coupleCooldownSeconds > 0) {
    coupleButtonLabel = `♡ ${coupleCooldownSeconds}`;
  } else if (isCouplePending) {
    coupleButtonLabel = requestedCoupleByCurrentUser ? `♡ ${coupleRequestSeconds}` : "♡";
  }

  const tabCounts = {
    chat: visibleMessages.length,
    media: mediaMessages.length,
    links: linkMessages.length,
    pinned: pinnedOnlyMessages.length
  };

  const projectShortcutEnabled =
    !activeContact.isGroup &&
    !activeContact.isArchived &&
    !activeContact.isRestricted &&
    !activeContact.isTrashed &&
    activeContact.requestState === "accepted";

  function handleProjectNameShortcut(event, text) {
    const messageId = event.currentTarget.dataset.messageId;
    if (!projectShortcutEnabled || !text?.trim() || !messageId) {
      return;
    }

    const currentTime = Date.now();
    const previous = projectTapRef.current;
    const isSameMessage = previous.messageId === messageId;
    const withinWindow = currentTime - previous.lastTapAt <= 900;
    const nextCount = isSameMessage && withinWindow ? previous.count + 1 : 1;

    projectTapRef.current = {
      messageId,
      count: nextCount,
      lastTapAt: currentTime
    };

    if (nextCount >= 4) {
      projectTapRef.current = { messageId: null, count: 0, lastTapAt: 0 };
      event.preventDefault();
      onCreateProjectFromText(text.trim());
    }
  }

  function openDesktopForwardPicker(message, anchorElement) {
    const rect = anchorElement.getBoundingClientRect();
    const pickerWidth = 280;
    const left = Math.max(12, Math.min(rect.right - pickerWidth, window.innerWidth - pickerWidth - 12));
    const top = Math.min(window.innerHeight - 20, rect.bottom + 12);

    onForwardMessage(message);
    setDesktopContextMenu(null);
    setActiveDesktopSwipeMessageId(null);
    setDetailMessageId(null);
    setDesktopForwardPicker({
      messageId: message.id,
      top,
      left
    });
  }

  function handleDesktopContextMenu(event, message, canEdit) {
    if (!isDesktopLayout()) {
      return;
    }

    event.preventDefault();
    setDesktopForwardPicker(null);
    setActiveDesktopSwipeMessageId(null);
    setDetailMessageId(null);
    setDesktopContextMenu({
      message,
      canEdit,
      x: Math.min(event.clientX, window.innerWidth - 180),
      y: Math.min(event.clientY, window.innerHeight - 220)
    });
  }

  function handleDesktopMessagePress(event, message) {
    if (!message.text?.trim()) {
      return;
    }

    const messageId = event.currentTarget.dataset.messageId;
    const anchorElement = event.currentTarget;
    const currentTime = Date.now();

    if (isPhoneLayout() && messageId) {
      const previousReplyTap = replyTapRef.current;
      const isSameReplyMessage = previousReplyTap.messageId === messageId;
      const withinReplyWindow = currentTime - previousReplyTap.lastTapAt <= 420;
      const nextReplyCount = isSameReplyMessage && withinReplyWindow ? previousReplyTap.count + 1 : 1;

      replyTapRef.current = {
        messageId,
        count: nextReplyCount,
        lastTapAt: currentTime
      };

      if (nextReplyCount >= 2) {
        replyTapRef.current = { messageId: null, count: 0, lastTapAt: 0 };
        onReplyToMessage(message);
        return;
      }

      handleProjectNameShortcut(event, message.text);
      return;
    }

    if (!isDesktopLayout() || !messageId) {
      return;
    }

    const previous = desktopTapRef.current;
    const isSameMessage = previous.messageId === messageId;
    const withinWindow = currentTime - previous.lastTapAt <= 600;
    const nextCount = isSameMessage && withinWindow ? previous.count + 1 : 1;

    if (previous.timerId) {
      window.clearTimeout(previous.timerId);
    }

    if (nextCount >= 4 && projectShortcutEnabled) {
      desktopTapRef.current = { messageId: null, count: 0, lastTapAt: 0, timerId: null };
      setDesktopForwardPicker(null);
      onCreateProjectFromText(message.text.trim());
      return;
    }

    let timerId = null;
    if (nextCount === 3) {
      timerId = window.setTimeout(() => {
        openDesktopForwardPicker(message, anchorElement);
        desktopTapRef.current = { messageId: null, count: 0, lastTapAt: 0, timerId: null };
      }, 220);
    }

    desktopTapRef.current = {
      messageId,
      count: nextCount,
      lastTapAt: currentTime,
      timerId
    };
  }

  function handleDesktopSwipeStart(event, message) {
    return;
  }

  return (
    <>
      <section
        className={`chat-window ${isDragging ? "is-dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget)) {
            return;
          }
          setIsDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          const file = event.dataTransfer.files?.[0];
          if (file) {
            onAttachmentSelect(file);
          }
        }}
      >
        <header className="chat-header modern-chat-header">
          <div className="chat-contact">
            <button
              className="ghost-button mobile-workspace-button"
              type="button"
              onClick={onOpenWorkspacePanel}
              aria-label="Open menu"
              title="Open menu"
            >
              ☰
            </button>
            {showBackButton ? (
              <button
                className="ghost-button mobile-back-button"
                type="button"
                onClick={onBack}
                aria-label="Go back"
                title="Go back"
              >
                ←
              </button>
            ) : null}
            <span className="avatar-shell">
              <Avatar user={activeContact} />
              <span
                className={`avatar-status avatar-status-${activeContact.presenceStatus === "online" ? "online" : activeContact.presenceStatus === "away" ? "away" : "offline"}`}
                aria-hidden="true"
              />
            </span>
            <div className="chat-contact-copy">
              <span className="chat-breadcrumb">
                <span className="chat-breadcrumb-nav" aria-hidden="true">
                  &lsaquo; &rsaquo;
                </span>
                <span>Messages / {activeContact.displayName || activeContact.name}</span>
              </span>
              <h2>{activeContact.displayName || activeContact.name}</h2>
              <p className={isTyping ? "typing-text" : ""}>{formatHeaderPresence(activeContact, isTyping)}</p>
            </div>
          </div>

          <div className="chat-header-tools">
            {onOpenWorkspaceChat ? (
              <button
                className="ghost-button"
                type="button"
                onClick={onOpenWorkspaceChat}
                aria-label="Open workspace chat"
                title="Open workspace chat"
              >
                Workspace
              </button>
            ) : null}
            <button className="ghost-button icon-button" type="button" onClick={() => onUnavailableAction("Audio calling")} aria-label="Audio call">
              ☎
            </button>
            <button className="ghost-button icon-button" type="button" onClick={() => onUnavailableAction("Video calling")} aria-label="Video call">
              🎥
            </button>
            <div className="notification-bell-shell" ref={notificationMenuRef}>
              <button
                className={`ghost-button icon-button bell-toggle-button ${notificationsMuted ? "is-muted" : ""}`}
                type="button"
                onClick={() => setShowNotificationMenu((current) => !current)}
                aria-label={notificationsMuted ? "Notifications off" : "Notifications on"}
                title={formatMuteStatus(activeContact)}
              >
                <span className="bell-toggle-icon" aria-hidden="true">{notificationsMuted ? "🔕" : "🔔"}</span>
              </button>
              {showNotificationMenu ? (
                <div className="notification-bell-menu">
                  <div className="notification-bell-menu-copy">
                    <strong>{notificationsMuted ? "Turn notifications back on" : "Turn notifications off"}</strong>
                    <span>{formatMuteStatus(activeContact)}</span>
                  </div>
                  {notificationsMuted ? (
                    <button
                      className="notification-bell-option primary"
                      type="button"
                      onClick={() => {
                        setShowNotificationMenu(false);
                        onToggleMute?.({ mode: "on" });
                      }}
                    >
                      Turn on now
                    </button>
                  ) : null}
                  {[1, 3, 8, 24].map((hours) => (
                    <button
                      key={hours}
                      className="notification-bell-option"
                      type="button"
                      onClick={() => {
                        setShowNotificationMenu(false);
                        onToggleMute?.({ mode: "hours", hours });
                      }}
                    >
                      Turn off for {hours} hour{hours > 1 ? "s" : ""}
                    </button>
                  ))}
                  <button
                    className="notification-bell-option"
                    type="button"
                    onClick={() => {
                      const requestedHours = window.prompt("Turn notifications off for how many hours?", "1");
                      const nextHours = Number(requestedHours);
                      if (!requestedHours || !Number.isFinite(nextHours) || nextHours <= 0) {
                        return;
                      }
                      setShowNotificationMenu(false);
                      onToggleMute?.({ mode: "hours", hours: nextHours });
                    }}
                  >
                    Turn off for custom hours
                  </button>
                  <button
                    className="notification-bell-option"
                    type="button"
                    onClick={() => {
                      setShowNotificationMenu(false);
                      onToggleMute?.({ mode: "forever" });
                    }}
                  >
                    Turn off always
                  </button>
                </div>
              ) : null}
            </div>
            {showCoupleModeButton ? (
              <button
                className={`ghost-button icon-button couple-mode-button ${bondState?.coupleActive ? "is-active" : ""}`}
                type="button"
                onClick={canUseCoupleMode ? onToggleCoupleMode : undefined}
                aria-label="Couple sign"
                title={
                  canUseCoupleMode
                    ? "Couple sign"
                    : activeContact.isSelf
                      ? "Couple sign works only with another user."
                      : "Couple sign is unavailable for this conversation."
                }
                disabled={!canUseCoupleMode}
              >
                {coupleButtonLabel}
              </button>
            ) : null}
            {showBegButton ? (
              <button className="ghost-button icon-button beg-mode-button" type="button" onClick={onBegTrustMode}>
                Beg
              </button>
            ) : null}
            <input
              className="chat-search-input"
              type="search"
              placeholder="Search conversation"
              value={messageSearch}
              onChange={(event) => onSearchChange(event.target.value)}
            />
            {!isActionPanelDocked ? (
              <button
                className="ghost-button icon-button compact-header-toggle"
                type="button"
                onClick={onOpenActionPanel}
                aria-label="Conversation tools"
              >
                Tools
              </button>
            ) : null}
            <details className="chat-more-menu">
              <summary className="ghost-button icon-button" aria-label="More options">...</summary>
              <div className="chat-more-sheet">
                <button className="ghost-button subtle-button compact" type="button" onClick={onExportConversation}>
                  Export
                </button>
                <button className="ghost-button subtle-button compact" type="button" onClick={() => onUnavailableAction("Conversation search filters")}>
                  Filter search
                </button>
                <button className="ghost-button subtle-button compact" type="button" onClick={() => onUnavailableAction("Conversation settings")}>
                  Settings
                </button>
              </div>
            </details>
          </div>
        </header>

        {canUseCoupleMode && (bondState?.coupleActive || isCouplePending || coupleCooldownSeconds > 0 || bondState?.trustActive || showBegButton) ? (
          <section className="bond-status-strip">
            <div className="bond-status-copy">
              <strong>Couple sign</strong>
              {coupleCooldownSeconds > 0 ? (
                <span>Retry opens in {coupleCooldownSeconds}s.</span>
              ) : bondState?.coupleActive ? (
                <span>
                  Shared link is active.
                  {bondState?.trustActive ? ` ${trustLightLabel}.` : " Trust mode is still off."}
                </span>
              ) : isCouplePending ? (
                <span>
                  {requestedCoupleByCurrentUser
                    ? `${activeContact.displayName || activeContact.name} has ${coupleRequestSeconds}s to match your couple sign.`
                    : `You have ${coupleRequestSeconds}s to match ${activeContact.displayName || activeContact.name}'s couple sign.`}
                </span>
              ) : null}
            </div>
            {bondState?.trustActive ? (
              <div className={`trust-light-indicator is-${trustLightTone}`}>
                <span className="trust-light-bulb" aria-hidden="true" />
                <span>{trustLightLabel}</span>
              </div>
            ) : null}
          </section>
        ) : null}

        <nav className="chat-content-tabs" aria-label="Chat content tabs">
          {contentTabs.map(([value, label, glyph]) => (
            <button
              key={value}
              type="button"
              className={`chat-content-tab ${activeTab === value ? "is-active" : ""}`}
              onClick={() => setActiveTab(value)}
            >
              <span className="chat-content-tab-icon" aria-hidden="true">
                {glyph}
              </span>
              <span>{label}</span>
              {tabCounts[value] > 0 ? <span className="chat-content-tab-count">{tabCounts[value]}</span> : null}
            </button>
          ))}
        </nav>

        <div
          className={`messages-panel modern-messages-panel ${
            activeTab === "chat" && groupedMessages.length ? "has-thread-messages" : ""
          }`}
        >
          {activeTab === "pinned" && pinnedOnlyMessages.length ? (
            <div className="pinned-stack">
              {pinnedOnlyMessages.map((message) => (
                <div key={message.id} className="pinned-card">
                  <strong>Pinned</strong>
                  <span>{message.text || message.attachment?.name || "Attachment"}</span>
                </div>
              ))}
            </div>
          ) : null}

          {activeTab === "chat" ? <div ref={topSentinelRef} /> : null}
          {activeTab === "chat" && conversationCalendarItems.length ? (
            <section className="conversation-planner-strip">
              <div
                className="conversation-planner-head is-clickable"
                role="button"
                tabIndex={0}
                onClick={() => onOpenPlannerItem(upcomingConversationItems[0]?.id || null)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpenPlannerItem(upcomingConversationItems[0]?.id || null);
                  }
                }}
              >
                <strong>Conversation planner</strong>
                <span>{upcomingConversationItems.length} linked items</span>
              </div>
              <div className="conversation-planner-list">
                {upcomingConversationItems.length ? (
                  upcomingConversationItems.map((entry) => (
                    <article
                      key={entry.id}
                      className={`conversation-planner-card is-${entry.type}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpenPlannerItem(entry.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onOpenPlannerItem(entry.id);
                        }
                      }}
                    >
                      <div className="conversation-planner-copy">
                        <strong>{entry.title}</strong>
                        <span>
                          {formatDisplayDate(entry.date)} at {formatClockTime(entry.time)}
                          {entry.linkedMessageText ? " · from message" : ""}
                        </span>
                        <small>
                          {entry.type} · {entry.status}
                          {entry.recurrence !== "none" ? ` · repeats ${entry.recurrence}` : ""}
                        </small>
                      </div>
                      <div className="conversation-planner-actions">
                        {entry.status !== "done" ? (
                          <button
                            className="ghost-button subtle-button compact"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onUpdateCalendarEventStatus(entry.id, "done");
                            }}
                          >
                            Done
                          </button>
                        ) : null}
                        {entry.status !== "cancelled" ? (
                          <button
                            className="ghost-button subtle-button compact"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onUpdateCalendarEventStatus(entry.id, "cancelled");
                            }}
                          >
                            Cancel
                          </button>
                        ) : null}
                        <button
                          className="ghost-button subtle-button compact"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onDeleteCalendarEvent(entry.id);
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="panel-state">No active linked planner items are visible right now.</p>
                )}
              </div>
            </section>
          ) : null}
          {activeTab === "chat" && pdfReviewSessions.length ? (
            <section className="conversation-review-history">
              <div className="conversation-planner-head">
                <strong>Shared review history</strong>
                <span>{pdfReviewSessions.length} sessions</span>
              </div>
              <div className="conversation-review-list">
                {pdfReviewSessions.slice(0, 4).map((session) => (
                  <article key={session.id} className={`conversation-review-item is-${session.status}`}>
                    <strong>{session.file.name}</strong>
                    <span>{formatPdfReviewHistory(session)}</span>
                    <small>{formatDisplayDate((session.endedAt || session.acceptedAt || session.createdAt || "").slice(0, 10))}</small>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
          {activeTab === "chat" && loadingOlderMessages ? <p className="panel-state">Loading older messages...</p> : null}
          {activeTab === "chat" && forwardPickerMessage && isPhoneLayout() ? (
            <section className="forward-picker-card">
              <div className="forward-picker-head">
                <strong>Forward to inbox</strong>
                <button
                  className="ghost-button subtle-button compact"
                  type="button"
                  onClick={onForwardPickerDismiss}
                >
                  Close
                </button>
              </div>
              <p>
                Pick a friend from your inbox for:
                {" "}
                {forwardPickerMessage.text || forwardPickerMessage.attachment?.name || "this message"}
              </p>
              <div className="forward-picker-list">
                {forwardOptions.length ? (
                  forwardOptions.map((contact) => (
                    <button
                      key={contact.id}
                      className="forward-picker-option"
                      type="button"
                      onClick={() => onForwardMessagePick(contact.id)}
                    >
                      <Avatar user={contact} />
                      <span>
                        <strong>{contact.displayName || contact.name}</strong>
                        <small>{contact.nickname || contact.email || "Inbox contact"}</small>
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="panel-state">No inbox friends are available for forwarding right now.</p>
                )}
              </div>
            </section>
          ) : null}
          {activeTab === "chat" && loading ? (
            <div className="message-skeletons">
              <div className="message-skeleton incoming" />
              <div className="message-skeleton outgoing" />
              <div className="message-skeleton incoming" />
            </div>
          ) : null}
          {activeTab === "chat" && error ? <p className="panel-state panel-error">{error}</p> : null}
          {activeTab === "chat" && !loading && visibleMessages.length === 0 ? (
            messageSearch ? (
              <p className="panel-state">No messages match your search.</p>
            ) : (
              <div className="thread-empty-state">
                <div className="thread-empty-surface">
                  <div className="thread-empty-header">
                    <div className="thread-empty-icon" aria-hidden="true">
                      <span />
                      <span />
                    </div>
                    <div className="thread-empty-copy">
                      <strong>Start the conversation</strong>
                      <p>Share the first update, drop in a file, or use one of the quick actions to begin.</p>
                    </div>
                  </div>
                  <div className="thread-empty-actions">
                    <button className="ghost-button subtle-button compact" type="button" onClick={() => onUnavailableAction("Share a file")}>
                      Share file
                    </button>
                    <button className="ghost-button subtle-button compact" type="button" onClick={onToggleEmojiPicker}>
                      Add emoji
                    </button>
                    <button className="ghost-button subtle-button compact" type="button" onClick={() => onUnavailableAction("Start with a note")}>
                      Quick note
                    </button>
                  </div>
                  <div className="thread-starter-cards" aria-hidden="true">
                    <div className="thread-starter-card">
                      <span>Message</span>
                      <strong>Quick project update</strong>
                    </div>
                    <div className="thread-starter-card">
                      <span>Share</span>
                      <strong>Attach a file or image</strong>
                    </div>
                  </div>
                  <div className="thread-empty-footnote">Recent activity will appear here after the first message.</div>
                </div>
              </div>
            )
          ) : null}

          {activeTab === "media" ? (
            mediaMessages.length ? (
              <div className="media-gallery-grid">
                {mediaMessages.map((message) => (
                  <button
                    key={message.id}
                    type="button"
                    className="media-gallery-card"
                    onClick={() => handleOpenMessageAttachment(message)}
                  >
                    <img src={message.attachment.dataUrl} alt={message.attachment.name} />
                    <span>{message.isSnap ? "Snap" : message.attachment.name}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="panel-state">Shared media will appear here.</p>
            )
          ) : null}

          {activeTab === "links" ? (
            linkMessages.length ? (
              <div className="link-stack">
                {linkMessages.map((message) => (
                  <div
                    key={message.id}
                    className="link-preview expanded is-editable"
                  >
                    <a
                      href={message.linkPreview.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <strong>{message.linkPreview.domain}</strong>
                      <span>{message.linkPreview.url}</span>
                      {message.text ? <small>{message.text}</small> : null}
                    </a>
                    {message.sender.id === currentUserId ? (
                      <button
                        className="ghost-button subtle-button compact"
                        type="button"
                        onClick={() => onStartEdit(message)}
                      >
                        Edit
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="panel-state">Shared links will appear here.</p>
            )
          ) : null}

          {activeTab === "pinned" && !pinnedOnlyMessages.length ? (
            <p className="panel-state">Pinned messages will appear here.</p>
          ) : null}

          {activeTab === "chat" &&
            groupedMessages.map((group) => {
            const outgoing = group.senderId === currentUserId;

            return (
              <article
                key={group.id}
                className={`message-group ${outgoing ? "outgoing" : "incoming"}`}
              >
                {!outgoing ? (
                  <div className="message-group-avatar">
                    <Avatar user={group.sender} />
                  </div>
                ) : null}

                <div className="message-group-stack">
                  {!outgoing ? <span className="message-sender-name">{group.sender.name}</span> : null}

                  {group.messages.map((message) => {
                    const isEditing = editingMessageId === message.id;
                    const showSeenState = outgoing && message.id === lastOutgoingMessageId;
                    const canEdit = outgoing && !message.deletedAt;
                    const isExpiredSnap =
                      Boolean(message.isSnap && message.autoDeleteAt) &&
                      getSecondsLeft(message.autoDeleteAt, now) <= 0;
                    const desktopBubbleOffset =
                      desktopSwipeState.messageId === message.id
                        ? desktopSwipeState.offset
                        : activeDesktopSwipeMessageId === message.id
                          ? -156
                          : 0;

                    return (
                      <div
                        key={message.id}
                        className={`message-card ${activeTouchActionsMessageId === message.id ? "is-touch-actions" : ""} ${swipeState.messageId === message.id ? "is-swiping" : ""}`}
                      >
                        {isEditing ? (
                          <form
                            className="message-edit-form"
                            onSubmit={(event) => {
                              event.preventDefault();
                              onEditMessage(message.id);
                            }}
                          >
                            <textarea
                              rows={3}
                              value={editingText}
                              onChange={(event) => onEditingTextChange(event.target.value)}
                            />
                            <div className="message-edit-actions">
                              <button className="ghost-button subtle-button compact" type="submit">
                                Save
                              </button>
                              <button className="ghost-button subtle-button compact" type="button" onClick={onCancelEdit}>
                                Cancel
                              </button>
                            </div>
                          </form>
                        ) : (
                          <>
                            <div
                              className={`message-bubble ${outgoing ? "outgoing" : "incoming"}`}
                              style={
                                swipeState.messageId === message.id
                                  ? { transform: `translateX(${swipeState.offset}px)` }
                                  : desktopBubbleOffset
                                    ? { transform: `translateX(${desktopBubbleOffset}px)` }
                                    : undefined
                              }
                              onDoubleClick={() => {
                                if (window.innerWidth > 900) {
                                  onReplyToMessage(message);
                                }
                              }}
                              onContextMenu={(event) => handleDesktopContextMenu(event, message, canEdit)}
                              onMouseDown={(event) => handleDesktopSwipeStart(event, message)}
                              onTouchStart={(event) => handleMessageTouchStart(event, message)}
                              onTouchMove={(event) => handleMessageTouchMove(event, message)}
                              onTouchEnd={() => handleMessageTouchEnd(message)}
                              onTouchCancel={() => {
                                clearLongPressTimer();
                                setSwipeState({ messageId: null, offset: 0 });
                              }}
                            >
                              {isDesktopLayout() ? (
                                <div className="message-hover-reactions" role="toolbar" aria-label="Quick reactions">
                                  {reactionPalette.map((emoji) => {
                                    const reaction = message.reactions.find((entry) => entry.emoji === emoji);
                                    const isActive = reaction?.users.includes(currentUserId);

                                    return (
                                      <button
                                        key={emoji}
                                        className={`reaction-button compact ${isActive ? "is-active" : ""}`}
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          onToggleReaction(message.id, emoji);
                                        }}
                                      >
                                        {emoji}
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : null}
                              {message.replyTo ? (
                                <div className="reply-preview">
                                  <strong>{message.replyTo.senderName}</strong>
                                  <span>{message.replyTo.text || message.replyTo.attachmentName || "Attachment"}</span>
                                </div>
                              ) : null}
                              {message.forwardedFrom ? (
                                <small className="message-meta-kicker">Forwarded from {message.forwardedFrom.name}</small>
                              ) : null}
                              {message.isSnap ? <small className="message-meta-kicker snap-kicker">Snap</small> : null}
                              {message.text ? (
                                <p
                                  data-message-id={message.id}
                                  onClick={(event) => handleDesktopMessagePress(event, message)}
                                  onDoubleClick={() => {
                                    if (isDesktopLayout()) {
                                      onReplyToMessage(message);
                                    }
                                  }}
                                  title={
                                    window.innerWidth <= 900
                                      ? "Press 2 times to reply from phone."
                                      : "Hover for reactions, double click to reply, triple click to forward."
                                  }
                                >
                                  {message.text}
                                </p>
                              ) : null}
                              {message.linkPreview ? (
                                <a
                                  className="link-preview"
                                  href={message.linkPreview.url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  <strong>{message.linkPreview.domain}</strong>
                                  <span>{message.linkPreview.url}</span>
                                </a>
                              ) : null}
                              {message.isSnap ? (
                                <button
                                  className={`snap-card ${openingSnapId === message.id ? "is-opening" : ""}`}
                                  type="button"
                                  disabled={isExpiredSnap}
                                  onClick={() => handleOpenMessageAttachment(message)}
                                >
                                  <strong>📷 Snap</strong>
                                  <span>
                                    {isExpiredSnap
                                      ? "Snap expired"
                                      : message.sender.id === currentUserId
                                        ? "Tap to preview"
                                        : message.autoDeleteAt
                                          ? "Opened"
                                          : "New Snap"}
                                  </span>
                                </button>
                              ) : (
                                renderAttachment(message, handleOpenMessageAttachment)
                              )}
                              <time dateTime={message.createdAt}>{formatTimestamp(message.createdAt)}</time>
                            </div>

                            {isPhoneLayout() ? (
                              <MessageQuickActions
                                canEdit={canEdit}
                                onCreateEventFromMessage={onCreateEventFromMessage}
                                onCreateTaskFromMessage={onCreateTaskFromMessage}
                                currentUserId={currentUserId}
                                message={message}
                                onCopy={handleCopyMessage}
                                onDeleteMessage={onDeleteMessage}
                                onForwardMessage={onForwardMessage}
                                onReplyToMessage={onReplyToMessage}
                                onStartEdit={onStartEdit}
                                onToggleReaction={onToggleReaction}
                              />
                            ) : null}
                            {isDesktopLayout() && detailMessageId === message.id ? (
                              <div className="message-detail-card">
                                <strong>{message.sender.name}</strong>
                                <span>{formatTimestamp(message.createdAt)}</span>
                                {message.editedAt ? <span>Edited</span> : null}
                                {message.forwardedFrom ? <span>Forwarded from {message.forwardedFrom.name}</span> : null}
                              </div>
                            ) : null}
                          </>
                        )}

                        {showSeenState ? (
                          <p className="message-status">
                            {message.seenAt ? `Seen ${formatTimestamp(message.seenAt)}` : "Delivered"}
                          </p>
                        ) : null}
                        {message.editedAt && !message.deletedAt ? <p className="message-status">Edited</p> : null}
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })}

          {activeTab === "chat" && isTyping ? (
            <div className="typing-indicator">
              <Avatar user={activeContact} />
              <div className="typing-indicator-bubble">
                <span>{activeContact.displayName || activeContact.name} is typing</span>
                <div className="typing-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === "chat" ? <div ref={messageEndRef} /> : null}
        </div>

        {failedSend ? (
          <div className="composer-banner">
            <span>Last message failed to send.</span>
            <button className="ghost-button subtle-button compact" type="button" onClick={onRetryFailedSend}>
              Retry
            </button>
          </div>
        ) : null}

        {activeContact.requestState === "pending" ? (
          <div className="composer-banner">
            <span>{activeContact.name} sent you a message request.</span>
            <div className="message-edit-actions">
              <button className="ghost-button subtle-button compact" type="button" onClick={onAcceptRequest}>
                Accept
              </button>
              <button className="ghost-button subtle-button compact" type="button" onClick={onTrash}>
                Move to trash
              </button>
            </div>
          </div>
        ) : null}

        {activeContact.requestState === "sent" ? (
          <div className="composer-banner">
            <span>Message request sent. Wait for {activeContact.name} to accept it.</span>
          </div>
        ) : null}

        {activeContact.isTrashed ? (
          <div className="composer-banner">
            <span>This conversation is in trash.</span>
            <button className="ghost-button subtle-button compact" type="button" onClick={onRestoreFromTrash}>
              Restore
            </button>
          </div>
        ) : null}

        {activeContact.isBlocked || activeContact.hasBlockedYou ? (
          <div className="composer-banner panel-error">
            {activeContact.hasBlockedYou
              ? `${activeContact.name} blocked this conversation.`
              : "You blocked this conversation."}
          </div>
        ) : composerLocked ? null : (
          <form className="composer modern-composer" onSubmit={onSend}>
            {replyTarget ? (
              <div className="composer-banner">
                <span>Replying to: {replyTarget.text || replyTarget.attachment?.name || "Attachment"}</span>
                <button className="ghost-button subtle-button compact" type="button" onClick={onClearReplyTarget}>
                  Clear
                </button>
              </div>
            ) : null}

            {forwardMessage ? (
              <div className="composer-banner">
                <span>Forwarding: {forwardMessage.text || forwardMessage.attachment?.name || "Attachment"}</span>
                <button className="ghost-button subtle-button compact" type="button" onClick={onClearForwardMessage}>
                  Clear
                </button>
              </div>
            ) : null}

            {attachment ? (
              <div className="attachment-preview attachment-preview-card">
                {attachment.isSnap ? <span className="attachment-kind-badge">Snap • disappears in 10s</span> : null}
                {attachment.mimeType.startsWith("image/") ? (
                  <img src={attachment.dataUrl} alt={attachment.name} />
                ) : attachment.mimeType.startsWith("video/") ? (
                  <video controls src={attachment.dataUrl} />
                ) : attachment.mimeType.startsWith("audio/") ? (
                  <audio controls src={attachment.dataUrl} />
                ) : (
                  <span>{attachment.name}</span>
                )}
                <button className="ghost-button subtle-button compact" type="button" onClick={onRemoveAttachment}>
                  Remove
                </button>
              </div>
            ) : null}

            {showEmojiPicker ? (
              <div className="emoji-picker">
                {emojiPalette.map((emoji) => (
                  <button key={emoji} type="button" onClick={() => onAppendEmoji(emoji)}>
                    {emoji}
                  </button>
                ))}
              </div>
            ) : null}

            <div className={`composer-toolbar ${compactComposer ? "is-compact" : ""}`}>
              <label className="ghost-button file-button composer-tool">
                  <span aria-hidden="true">📄</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp,.pdf,.txt,audio/*"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      onAttachmentSelect(file);
                    }
                    event.target.value = "";
                  }}
                />
              </label>
              <button className="ghost-button composer-tool" type="button" onClick={onToggleEmojiPicker}>
                <span aria-hidden="true">☺</span>
                <small>Emoji</small>
              </button>
              <button
                className="ghost-button composer-tool composer-tool-snap"
                type="button"
                onClick={openGhostingWindow}
                aria-label="Snap"
                title="Snap"
              >
                <img src={snapToolbarLogo} alt="" />
              </button>
              <button
                className={`ghost-button composer-tool composer-tool-voice ${isRecordingVoice ? "is-recording" : ""}`}
                type="button"
                onClick={() => {
                  if (isRecordingVoice) {
                    stopVoiceRecording();
                    return;
                  }
                  startVoiceRecording();
                }}
                aria-label={isRecordingVoice ? "Stop and send voice message" : "Record voice message"}
                title={isRecordingVoice ? "Stop and send voice message" : "Record voice message"}
                disabled={voiceSending}
              >
                <span aria-hidden="true">{isRecordingVoice ? "■" : "🎙"}</span>
                <small>{isRecordingVoice ? "Send" : "Voice"}</small>
              </button>
              <button className="ghost-button composer-tool" type="button" onClick={() => onUnavailableAction("GIF and media picker")}>
                <span aria-hidden="true">▣</span>
                <small>GIF</small>
              </button>
              <button
                className="ghost-button composer-tool"
                type="button"
                onClick={() => setShowComposerTools((value) => !value)}
                aria-expanded={showComposerTools}
              >
                <span aria-hidden="true">+</span>
                <small>More</small>
              </button>
            </div>

            {showComposerTools ? (
              <div className={`composer-toolbar composer-toolbar-secondary ${compactComposer ? "is-compact" : ""}`}>
                <button className="ghost-button composer-tool" type="button" onClick={() => onUnavailableAction("Bold formatting")}>
                  <span aria-hidden="true">B</span>
                </button>
                <button className="ghost-button composer-tool" type="button" onClick={() => onUnavailableAction("Italic formatting")}>
                  <span aria-hidden="true">I</span>
                </button>
                <button className="ghost-button composer-tool" type="button" onClick={() => onUnavailableAction("Underline formatting")}>
                  <span aria-hidden="true">U</span>
                </button>
                <button className="ghost-button composer-tool" type="button" onClick={() => onUnavailableAction("Bulleted list formatting")}>
                  <span aria-hidden="true">•</span>
                </button>
                <button className="ghost-button composer-tool" type="button" onClick={() => onUnavailableAction("Link insertion")}>
                  <span aria-hidden="true">∞</span>
                </button>
              </div>
            ) : null}

            {isRecordingVoice ? (
              <div className="composer-banner composer-banner-voice">
                <span>Recording voice message • {Math.floor(voiceSeconds / 60)}:{String(voiceSeconds % 60).padStart(2, "0")}</span>
                <button
                  className="ghost-button subtle-button compact"
                  type="button"
                  onClick={() => stopVoiceRecording({ discard: true })}
                >
                  Cancel
                </button>
              </div>
            ) : null}

            <div className="composer-row modern-composer-row">
              <textarea
                rows={1}
                placeholder={`Message ${activeContact.displayName || activeContact.name}`}
                value={draft}
                onChange={(event) => onDraftChange(event.target.value)}
                onKeyDown={handleComposerKeyDown}
              />
              <button
                className="primary-button send-button"
                type="submit"
                disabled={!draft.trim() && !attachment && !forwardMessage}
              >
                Send
              </button>
            </div>
          </form>
        )}
      </section>

      {showTrustModal ? (
        <div className="trust-mode-overlay" role="dialog" aria-modal="true" aria-labelledby="trust-mode-title">
          <div className="trust-mode-card">
            <strong id="trust-mode-title">Trust mode</strong>
            <p>
              Trust mode is a softer shared signal between both sides. If both of you agree, a round
              light appears in the inbox: yellow means the other person is in the inbox, red means
              they are on the phone but away from the app, and gray means they are off the phone.
            </p>
            <div className="trust-mode-status">
              {isTrustPending
                ? requestedTrustByCurrentUser
                  ? `Waiting ${trustRequestSeconds}s for ${activeContact.displayName || activeContact.name} to turn trust mode on.`
                  : `${activeContact.displayName || activeContact.name} asked for trust mode. You have ${trustRequestSeconds}s to turn it on too.`
                : "Turn on trust mode only if you want this softer shared presence signal."}
            </div>
            <div className="trust-mode-actions">
              <button
                className="ghost-button"
                type="button"
                onClick={onEnableTrustMode}
                disabled={requestedTrustByCurrentUser && isTrustPending}
              >
                {requestedTrustByCurrentUser && isTrustPending ? "Waiting..." : "Turn on trust mode"}
              </button>
              <button className="ghost-button subtle-button" type="button" onClick={onIgnoreTrustMode}>
                Ignore
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {desktopForwardPicker && forwardPickerMessage && isDesktopLayout() ? (
        <div
          className="desktop-forward-picker"
          style={{ top: `${desktopForwardPicker.top}px`, left: `${desktopForwardPicker.left}px` }}
        >
          <div className="forward-picker-head">
            <strong>Forward</strong>
            <button className="ghost-button subtle-button compact" type="button" onClick={() => {
              setDesktopForwardPicker(null);
              onForwardPickerDismiss();
            }}>
              Close
            </button>
          </div>
          <div className="forward-picker-list">
            {forwardOptions.length ? (
              forwardOptions.map((contact) => (
                <button
                  key={contact.id}
                  className="forward-picker-option"
                  type="button"
                  onClick={() => {
                    setDesktopForwardPicker(null);
                    onForwardMessagePick(contact.id);
                  }}
                >
                  <Avatar user={contact} />
                  <span>
                    <strong>{contact.displayName || contact.name}</strong>
                    <small>{contact.nickname || contact.email || "Inbox contact"}</small>
                  </span>
                </button>
              ))
            ) : (
              <p className="panel-state">No inbox profiles available.</p>
            )}
          </div>
        </div>
      ) : null}

      {desktopContextMenu && isDesktopLayout() ? (
        <div
          className="message-context-menu"
          style={{ top: `${desktopContextMenu.y}px`, left: `${desktopContextMenu.x}px` }}
        >
          <button
            className="ghost-button subtle-button compact"
            type="button"
            onClick={() => {
              handleCopyMessage(desktopContextMenu.message);
              setDesktopContextMenu(null);
            }}
          >
            Copy
          </button>
          <button
            className="ghost-button subtle-button compact"
            type="button"
            onClick={() => {
              onCreateEventFromMessage(desktopContextMenu.message);
              setDesktopContextMenu(null);
            }}
          >
            Schedule
          </button>
          <button
            className="ghost-button subtle-button compact"
            type="button"
            onClick={() => {
              onCreateTaskFromMessage(desktopContextMenu.message);
              setDesktopContextMenu(null);
            }}
          >
            Task
          </button>
          {desktopContextMenu.canEdit ? (
            <button
              className="ghost-button subtle-button compact"
              type="button"
              onClick={() => {
                onStartEdit(desktopContextMenu.message);
                setDesktopContextMenu(null);
              }}
            >
              Edit
            </button>
          ) : null}
          <button
            className="ghost-button subtle-button compact"
            type="button"
            onClick={() => {
              setDetailMessageId(desktopContextMenu.message.id);
              setDesktopContextMenu(null);
            }}
          >
            Detail
          </button>
          {desktopContextMenu.canEdit ? (
            <button
              className="ghost-button subtle-button compact danger"
              type="button"
              onClick={() => {
                onDeleteMessage(desktopContextMenu.message.id);
                setDesktopContextMenu(null);
              }}
            >
              Delete
            </button>
          ) : null}
        </div>
      ) : null}

      {viewerAttachment ? (
        <div className="media-viewer" role="dialog" aria-modal="true">
          <button className="media-viewer-backdrop" type="button" onClick={() => setViewerAttachment(null)} />
          <div className="media-viewer-card">
            <button className="ghost-button subtle-button compact media-viewer-close" type="button" onClick={() => setViewerAttachment(null)}>
              Close
            </button>
            {viewerAttachment.mimeType?.startsWith("video/") ? (
              <video controls autoPlay src={viewerAttachment.dataUrl} />
            ) : (
              <img src={viewerAttachment.dataUrl} alt={viewerAttachment.name} />
            )}
            <strong>{viewerAttachment.name}</strong>
          </div>
        </div>
      ) : null}

      <Suspense fallback={null}>
        {viewerSnap ? (
          <SnapViewer snap={viewerSnap} onClose={() => setViewerSnap(null)} />
        ) : null}
      </Suspense>

      <Suspense fallback={null}>
        {showGhosting ? (
          <SnapWindowMockup
            isOpen={showGhosting}
            recipientName={activeContact?.displayName || activeContact?.name || ""}
            onClose={() => setShowGhosting(false)}
            onSendSnap={async (payload) => {
              const sent = await onSendSnapFile(payload);
              if (sent !== false) {
                setShowGhosting(false);
              }
              return sent;
            }}
          />
        ) : null}
      </Suspense>
    </>
  );
}
