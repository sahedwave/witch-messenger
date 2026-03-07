import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

import { api } from "./api";
import { AuthForm } from "./components/AuthForm";
import { ConversationPane } from "./components/ConversationPane";
import { Sidebar } from "./components/Sidebar";
import { Toasts } from "./components/Toasts";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:5001";
const STORAGE_KEY = "messenger-mvp-auth";
const THEME_KEY = "messenger-mvp-theme";
const PAGE_SIZE = 20;

function getContactCategory(contact) {
  if (contact?.isTrashed) {
    return "trash";
  }

  if (contact?.requestState === "pending") {
    return "requests";
  }

  if (contact?.isRestricted) {
    return "restricted";
  }

  if (contact?.isArchived) {
    return "archived";
  }

  return "inbox";
}

function isComposerLocked(contact) {
  return Boolean(
    !contact ||
      contact.isBlocked ||
      contact.hasBlockedYou ||
      contact.isTrashed ||
      contact.requestState === "pending" ||
      contact.requestState === "sent"
  );
}

function readStoredAuth() {
  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY);
    return rawValue ? JSON.parse(rawValue) : null;
  } catch (error) {
    return null;
  }
}

function persistAuth(payload) {
  if (!payload) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function readStoredTheme() {
  return window.localStorage.getItem(THEME_KEY) || "light";
}

function persistTheme(theme) {
  window.localStorage.setItem(THEME_KEY, theme);
}

function getMessageTime(contact) {
  return contact.lastMessage ? new Date(contact.lastMessage.createdAt).getTime() : 0;
}

function sortContacts(contacts) {
  return [...contacts].sort((first, second) => {
    if (Boolean(first.isFavorite) !== Boolean(second.isFavorite)) {
      return first.isFavorite ? -1 : 1;
    }

    if (Boolean(first.isPinned) !== Boolean(second.isPinned)) {
      return first.isPinned ? -1 : 1;
    }

    const firstTime = getMessageTime(first);
    const secondTime = getMessageTime(second);

    if (firstTime !== secondTime) {
      return secondTime - firstTime;
    }

    return first.name.localeCompare(second.name);
  });
}

function mergeContacts(baseContacts, nextContacts) {
  const existingById = new Map(baseContacts.map((contact) => [contact.id, contact]));
  const nextById = new Map();

  nextContacts.forEach((contact) => {
    nextById.set(contact.id, contact);
  });

  const mergedNext = nextContacts.map((contact) => {
    const existing = existingById.get(contact.id);

    return {
      ...existing,
      ...contact,
      unread: contact.unread ?? existing?.unread ?? 0,
      lastMessage: contact.lastMessage ?? existing?.lastMessage ?? null,
      isTyping: existing?.isTyping || false,
      displayName: contact.displayName ?? existing?.displayName ?? contact.name,
      isSelf: contact.isSelf ?? existing?.isSelf ?? false,
      requestState: contact.requestState ?? existing?.requestState ?? "accepted",
      isArchived: contact.isArchived ?? existing?.isArchived ?? false,
      isTrashed: contact.isTrashed ?? existing?.isTrashed ?? false,
      isRestricted: contact.isRestricted ?? existing?.isRestricted ?? false,
      isPinned: contact.isPinned ?? existing?.isPinned ?? false,
      isFavorite: contact.isFavorite ?? existing?.isFavorite ?? false,
      isMuted: contact.isMuted ?? existing?.isMuted ?? false,
      isBlocked: contact.isBlocked ?? existing?.isBlocked ?? false,
      hasBlockedYou: contact.hasBlockedYou ?? existing?.hasBlockedYou ?? false,
      labels: contact.labels ?? existing?.labels ?? [],
      nickname: contact.nickname ?? existing?.nickname ?? "",
      pinnedMessageIds: contact.pinnedMessageIds ?? existing?.pinnedMessageIds ?? [],
      deviceCount: contact.deviceCount ?? existing?.deviceCount ?? 0,
      presenceStatus: contact.presenceStatus ?? existing?.presenceStatus ?? "offline",
      online: (contact.presenceStatus ?? existing?.presenceStatus) === "online"
    };
  });

  const untouched = baseContacts.filter((contact) => !nextById.has(contact.id));
  return [...untouched, ...mergedNext];
}

function upsertMessage(list, message) {
  const existingIndex = list.findIndex((entry) => entry.id === message.id);

  if (existingIndex === -1) {
    return [...list, message].sort(
      (first, second) => new Date(first.createdAt) - new Date(second.createdAt)
    );
  }

  const next = [...list];
  next[existingIndex] = message;
  return next;
}

function prependOlderMessages(currentMessages, olderMessages) {
  const currentIds = new Set(currentMessages.map((message) => message.id));
  const uniqueOlderMessages = olderMessages.filter((message) => !currentIds.has(message.id));
  return [...uniqueOlderMessages, ...currentMessages];
}

function updateSeenOnMessages(messages, messageIds, seenAt) {
  if (messageIds.length === 0) {
    return messages;
  }

  const ids = new Set(messageIds);
  return messages.map((message) => (ids.has(message.id) ? { ...message, seenAt } : message));
}

function playNotificationTone() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    return;
  }

  const audioContext = new AudioContextClass();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(900, audioContext.currentTime);
  gainNode.gain.setValueAtTime(0.0001, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.08, audioContext.currentTime + 0.02);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.22);

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.22);
  oscillator.onended = () => {
    audioContext.close().catch(() => null);
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });
}

async function cropAvatarToSquare(file) {
  const dataUrl = await readFileAsDataUrl(file);

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const size = Math.min(image.width, image.height);
      const offsetX = (image.width - size) / 2;
      const offsetY = (image.height - size) / 2;
      const canvas = document.createElement("canvas");
      const outputSize = 256;
      canvas.width = outputSize;
      canvas.height = outputSize;
      const context = canvas.getContext("2d");

      if (!context) {
        reject(new Error("Unable to prepare image crop."));
        return;
      }

      context.drawImage(image, offsetX, offsetY, size, size, 0, 0, outputSize, outputSize);
      resolve(canvas.toDataURL("image/webp", 0.92));
    };
    image.onerror = () => reject(new Error("Unable to load selected image."));
    image.src = dataUrl;
  });
}

async function compressImageFile(file) {
  const dataUrl = await readFileAsDataUrl(file);

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const maxSide = 1440;
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      const context = canvas.getContext("2d");

      if (!context) {
        reject(new Error("Unable to compress image."));
        return;
      }

      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    image.onerror = () => reject(new Error("Unable to process image."));
    image.src = dataUrl;
  });
}

export default function App() {
  const storedAuth = readStoredAuth();
  const [authMode, setAuthMode] = useState("login");
  const [authState, setAuthState] = useState(storedAuth);
  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [twoFactorChallenge, setTwoFactorChallenge] = useState(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [authBootstrapping, setAuthBootstrapping] = useState(Boolean(storedAuth?.token));
  const [contacts, setContacts] = useState([]);
  const [sidebarSection, setSidebarSection] = useState("inbox");
  const [activeContactId, setActiveContactId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageSearch, setMessageSearch] = useState("");
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [oldestCursor, setOldestCursor] = useState(null);
  const [chatError, setChatError] = useState("");
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [securityActionLoading, setSecurityActionLoading] = useState(false);
  const [twoFactorSetupCode, setTwoFactorSetupCode] = useState("");
  const [twoFactorSetupInput, setTwoFactorSetupInput] = useState("");
  const [logoutAllLoading, setLogoutAllLoading] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [notificationPermission, setNotificationPermission] = useState(
    "Notification" in window ? Notification.permission : "unsupported"
  );
  const [failedSend, setFailedSend] = useState(null);
  const [replyTarget, setReplyTarget] = useState(null);
  const [forwardMessage, setForwardMessage] = useState(null);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingText, setEditingText] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [theme, setTheme] = useState(readStoredTheme);
  const activeContactRef = useRef(null);
  const contactsRef = useRef([]);
  const socketRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const typingTargetRef = useRef(null);
  const seenRequestsRef = useRef(new Set());
  const searchInputRef = useRef(null);

  useEffect(() => {
    activeContactRef.current = activeContactId;
  }, [activeContactId]);

  useEffect(() => {
    contactsRef.current = contacts;
  }, [contacts]);

  useEffect(() => {
    persistAuth(authState);
  }, [authState]);

  useEffect(() => {
    persistTheme(theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  function pushToast({ title, body, tone = false }) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((current) => [...current, { id, title, body }]);

    if (tone) {
      playNotificationTone();
    }

    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4500);
  }

  function clearAuthState(nextError = "") {
    stopTyping();
    setAuthState(null);
    setAuthMode("login");
    setAuthLoading(false);
    setAuthBootstrapping(false);
    setContacts([]);
    setSidebarSection("inbox");
    setActiveContactId(null);
    setMessages([]);
    setMessageSearch("");
    setHasMoreMessages(false);
    setOldestCursor(null);
    setDraft("");
    setAttachment(null);
    setFailedSend(null);
    setReplyTarget(null);
    setEditingMessageId(null);
    setEditingText("");
    setShowEmojiPicker(false);
    setAuthError(nextError);
    setAuthNotice("");
    setRecoveryCode("");
    setTwoFactorChallenge(null);
    setTwoFactorCode("");
    setTwoFactorSetupCode("");
    setTwoFactorSetupInput("");
  }

  function handleAuthModeChange(nextMode) {
    setAuthMode(nextMode);
    setAuthError("");
    setAuthNotice("");

    if (nextMode !== "reset") {
      setRecoveryCode("");
    }

    if (nextMode !== "twoFactor") {
      setTwoFactorChallenge(null);
      setTwoFactorCode("");
    }
  }

  function syncCurrentUser(nextUser) {
    setAuthState((current) => (current ? { ...current, user: nextUser } : current));
    setContacts((current) =>
      sortContacts(
        current.map((contact) =>
          contact.id === nextUser.id
            ? {
                ...contact,
                ...nextUser,
                displayName: contact.isSelf ? "Notes to self" : contact.nickname || nextUser.name
              }
            : contact
        )
      )
    );
    setMessages((current) =>
      current.map((message) => ({
        ...message,
        sender: message.sender.id === nextUser.id ? nextUser : message.sender,
        recipient: message.recipient.id === nextUser.id ? nextUser : message.recipient
      }))
    );
  }

  function updateContactState(contactId, updater) {
    setContacts((current) =>
      sortContacts(
        current.map((contact) => (contact.id === contactId ? updater(contact) : contact))
      )
    );
  }

  function mergeSingleContact(nextContact) {
    setContacts((current) => sortContacts(mergeContacts(current, [nextContact])));
  }

  function applyPresenceUpdate(update) {
    setContacts((current) =>
      current.map((contact) =>
        contact.id === update.userId
          ? {
              ...contact,
              deviceCount: update.deviceCount,
              presenceStatus: update.status,
              lastActiveAt: update.lastActiveAt,
              online: update.status === "online"
            }
          : contact
      )
    );
  }

  function applyMessageToContacts(message, options = {}) {
    const actorId = authState?.user?.id;
    const otherUserId = message.sender.id === actorId ? message.recipient.id : message.sender.id;
    const incrementUnread = Boolean(options.incrementUnread);

    setContacts((current) =>
      sortContacts(
        current.map((contact) => {
          if (contact.id !== otherUserId) {
            return contact;
          }

          const shouldReplaceLastMessage =
            !contact.lastMessage ||
            contact.lastMessage.id === message.id ||
            new Date(message.createdAt).getTime() >= new Date(contact.lastMessage.createdAt).getTime();

          return {
            ...contact,
            isTyping: false,
            lastMessage: shouldReplaceLastMessage ? message : contact.lastMessage,
            unread: incrementUnread ? contact.unread + 1 : contact.unread
          };
        })
      )
    );
  }

  function stopTyping(targetUserId = typingTargetRef.current) {
    if (!targetUserId || !socketRef.current) {
      return;
    }

    socketRef.current.emit("typing:stop", { toUserId: targetUserId });
    typingTargetRef.current = null;

    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
  }

  async function markConversationSeen(contactId) {
    if (!authState?.token || !contactId || seenRequestsRef.current.has(contactId)) {
      return;
    }

    seenRequestsRef.current.add(contactId);

    try {
      const result = await api.markConversationSeen(authState.token, contactId);
      setMessages((current) => updateSeenOnMessages(current, result.updatedIds || [], result.seenAt));
      updateContactState(contactId, (contact) => ({
        ...contact,
        unread: 0,
        lastMessage:
          contact.lastMessage && (result.updatedIds || []).includes(contact.lastMessage.id)
            ? { ...contact.lastMessage, seenAt: result.seenAt }
            : contact.lastMessage
      }));
    } catch (error) {
      console.error(error);
    } finally {
      seenRequestsRef.current.delete(contactId);
    }
  }

  useEffect(() => {
    if (!authState?.token) {
      setAuthBootstrapping(false);
      return;
    }

    let cancelled = false;
    setAuthBootstrapping(true);

    async function bootstrapSession() {
      try {
        const response = await api.getMe(authState.token);

        if (!cancelled) {
          syncCurrentUser(response.user);
        }
      } catch (error) {
        if (!cancelled) {
          clearAuthState("Your session expired. Please log in again.");
        }
      } finally {
        if (!cancelled) {
          setAuthBootstrapping(false);
        }
      }
    }

    bootstrapSession();

    return () => {
      cancelled = true;
    };
  }, [authState?.token]);

  useEffect(() => {
    if (!authState?.token || authBootstrapping) {
      if (!authState?.token) {
        setContacts([]);
        setActiveContactId(null);
        setMessages([]);
      }
      return;
    }

    let cancelled = false;

    async function loadContacts() {
      try {
        const users = await api.getUsers(authState.token);

        if (cancelled) {
          return;
        }

        setContacts((current) => sortContacts(mergeContacts(current, users)));
        setActiveContactId((current) =>
          current || (window.innerWidth > 960 ? users[0]?.id || null : null)
        );
      } catch (error) {
        if (!cancelled) {
          setChatError(error.message);
        }
      }
    }

    loadContacts();

    return () => {
      cancelled = true;
    };
  }, [authBootstrapping, authState?.token]);

  useEffect(() => {
    if (!authState?.token || !activeContactId) {
      setMessages([]);
      setReplyTarget(null);
      setForwardMessage(null);
      setHasMoreMessages(false);
      setOldestCursor(null);
      return;
    }

    let cancelled = false;
    setMessagesLoading(true);
    setChatError("");

    async function loadMessages() {
      try {
        const response = await api.getMessages(authState.token, activeContactId, {
          limit: PAGE_SIZE,
          q: messageSearch
        });

        if (cancelled) {
          return;
        }

        setMessages(response.messages);
        setHasMoreMessages(response.hasMore);
        setOldestCursor(response.nextCursor);
        updateContactState(activeContactId, (contact) => ({
          ...contact,
          unread: 0,
          isTyping: false,
          lastMessage: response.messages[response.messages.length - 1] || contact.lastMessage
        }));

        if (document.visibilityState === "visible") {
          markConversationSeen(activeContactId);
        }
      } catch (error) {
        if (!cancelled) {
          setChatError(error.message);
        }
      } finally {
        if (!cancelled) {
          setMessagesLoading(false);
        }
      }
    }

    loadMessages();

    return () => {
      cancelled = true;
    };
  }, [activeContactId, authState?.token, messageSearch]);

  useEffect(() => {
    if (!authState?.token || authBootstrapping) {
      return undefined;
    }

    const socket = io(SOCKET_URL, {
      auth: {
        token: authState.token
      }
    });

    socketRef.current = socket;

    socket.on("presence:snapshot", (snapshot) => {
      snapshot.forEach(applyPresenceUpdate);
    });

    socket.on("presence:update", applyPresenceUpdate);

    socket.on("typing:start", ({ fromUserId }) => {
      updateContactState(fromUserId, (contact) => ({ ...contact, isTyping: true }));
    });

    socket.on("typing:stop", ({ fromUserId }) => {
      updateContactState(fromUserId, (contact) => ({ ...contact, isTyping: false }));
    });

    socket.on("message:new", (message) => {
      const isIncoming = message.sender.id !== authState.user.id;
      const contactId = isIncoming ? message.sender.id : message.recipient.id;
      const isActive = activeContactRef.current === contactId;
      const currentContact = contactsRef.current.find((contact) => contact.id === contactId);
      const isSilentConversation =
        currentContact?.isRestricted || currentContact?.isTrashed || currentContact?.isArchived;

      applyMessageToContacts(message, {
        incrementUnread: isIncoming && !isActive
      });

      if (isActive) {
        setMessages((current) => upsertMessage(current, message));
        if (isIncoming && document.visibilityState === "visible") {
          markConversationSeen(contactId);
        }
      }

      if (isIncoming && !isSilentConversation && (!isActive || document.visibilityState !== "visible")) {
        pushToast({
          title: message.sender.name,
          body: message.attachment ? `${message.text} ${message.attachment.name}`.trim() : message.text,
          tone: true
        });
      }
    });

    socket.on("conversation:updated", (contact) => {
      mergeSingleContact(contact);

      if (activeContactRef.current === contact.id) {
        setSidebarSection(getContactCategory(contact));
      }
    });

    socket.on("message:updated", (message) => {
      setMessages((current) => upsertMessage(current, message));
      applyMessageToContacts(message);
    });

    socket.on("conversation:seen", ({ contactId, messageIds, seenAt }) => {
      setMessages((current) => updateSeenOnMessages(current, messageIds || [], seenAt));
      updateContactState(contactId, (contact) => ({
        ...contact,
        unread: 0,
        lastMessage:
          contact.lastMessage && (messageIds || []).includes(contact.lastMessage.id)
            ? { ...contact.lastMessage, seenAt }
            : contact.lastMessage
      }));
    });

    socket.on("notification:new", ({ message, fromUserId }) => {
      if (fromUserId === authState.user.id) {
        return;
      }

      const activeConversation = activeContactRef.current;
      const currentContact = contactsRef.current.find((contact) => contact.id === fromUserId);
      if (activeConversation === fromUserId && document.visibilityState === "visible") {
        return;
      }

      if (currentContact?.isRestricted || currentContact?.isTrashed || currentContact?.isArchived) {
        return;
      }

      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(message.sender.name || "New message", {
          body: message.attachment ? `${message.text} ${message.attachment.name}`.trim() : message.text,
          tag: message.id
        });
      }
    });

    socket.on("session:expired", ({ message }) => {
      clearAuthState(message || "Your session expired. Please log in again.");
    });

    socket.on("connect_error", () => {
      setChatError("Realtime connection failed. Refresh after checking the server.");
    });

    return () => {
      stopTyping();
      socketRef.current = null;
      socket.disconnect();
    };
  }, [authBootstrapping, authState?.token, authState?.user?.id]);

  useEffect(() => {
    function handleVisibilityChange() {
      setNotificationPermission("Notification" in window ? Notification.permission : "unsupported");

      if (socketRef.current && authState?.token) {
        socketRef.current.emit("presence:update", {
          status: document.visibilityState === "visible" ? "online" : "away"
        });
      }

      if (document.visibilityState === "visible" && activeContactRef.current) {
        markConversationSeen(activeContactRef.current);
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [authState?.token]);

  useEffect(() => {
    function handleKeyDown(event) {
      const isMeta = event.metaKey || event.ctrlKey;

      if (isMeta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }

      if (isMeta && event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        setTheme((current) => (current === "dark" ? "light" : "dark"));
      }

      if (isMeta && event.shiftKey && event.key.toLowerCase() === "e" && activeContactId) {
        event.preventDefault();
        setShowEmojiPicker((current) => !current);
      }

      if (event.key === "Escape") {
        if (editingMessageId) {
          setEditingMessageId(null);
          setEditingText("");
          return;
        }

        if (showEmojiPicker) {
          setShowEmojiPicker(false);
          return;
        }

        if (activeContactId && window.innerWidth <= 960) {
          setActiveContactId(null);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeContactId, editingMessageId, showEmojiPicker]);

  const activeContact = useMemo(
    () => contacts.find((contact) => contact.id === activeContactId) || null,
    [activeContactId, contacts]
  );

  async function handleAuthSubmit(credentials) {
    try {
      setAuthLoading(true);
      setAuthError("");
      setAuthNotice("");

      if (authMode === "forgot") {
        const response = await api.forgotPassword(credentials.email);
        setRecoveryCode(response.devResetCode || "");
        setAuthNotice(response.message);
        setAuthMode("reset");
        return;
      }

      if (authMode === "reset") {
        const response = await api.resetPassword({
          email: credentials.email,
          resetCode: credentials.resetCode,
          newPassword: credentials.password
        });
        setRecoveryCode("");
        setAuthNotice(response.message);
        setAuthMode("login");
        return;
      }

      if (authMode === "twoFactor") {
        if (!twoFactorChallenge) {
          throw new Error("Two-step verification challenge expired. Please log in again.");
        }

        const payload = await api.verifyTwoFactor({
          email: credentials.email,
          code: credentials.securityCode,
          challengeToken: twoFactorChallenge
        });

        setAuthState(payload);
        setAuthBootstrapping(true);
        setAuthMode("login");
        setTwoFactorChallenge(null);
        setTwoFactorCode("");
        return;
      }

      const payload =
        authMode === "login"
          ? await api.login(credentials)
          : await api.register(credentials);

      if (payload.requiresTwoFactor) {
        setTwoFactorChallenge(payload.challengeToken);
        setTwoFactorCode(payload.devTwoFactorCode || "");
        setAuthNotice(payload.message);
        setAuthMode("twoFactor");
        return;
      }

      setAuthState(payload);
      setAuthBootstrapping(true);
      setAuthNotice("");
      setRecoveryCode("");
      setTwoFactorChallenge(null);
      setTwoFactorCode("");
      setContacts([]);
      setSidebarSection("inbox");
      setMessages([]);
      setDraft("");
      setAttachment(null);
      setFailedSend(null);
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLoadOlderMessages() {
    if (!authState?.token || !activeContactId || !hasMoreMessages || !oldestCursor) {
      return;
    }

    try {
      setLoadingOlderMessages(true);
      const response = await api.getMessages(authState.token, activeContactId, {
        before: oldestCursor,
        limit: PAGE_SIZE,
        q: messageSearch
      });

      setMessages((current) => prependOlderMessages(current, response.messages));
      setHasMoreMessages(response.hasMore);
      setOldestCursor(response.nextCursor);
    } catch (error) {
      setChatError(error.message);
    } finally {
      setLoadingOlderMessages(false);
    }
  }

  function handleDraftChange(value) {
    setDraft(value);

    if (!activeContactId || !socketRef.current || isComposerLocked(activeContact)) {
      return;
    }

    if (!value.trim()) {
      stopTyping(activeContactId);
      return;
    }

    if (typingTargetRef.current !== activeContactId) {
      if (typingTargetRef.current && typingTargetRef.current !== activeContactId) {
        stopTyping(typingTargetRef.current);
      }

      socketRef.current.emit("typing:start", { toUserId: activeContactId });
      typingTargetRef.current = activeContactId;
    }

    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = window.setTimeout(() => {
      stopTyping(activeContactId);
    }, 1200);
  }

  async function handleAttachmentSelect(file) {
    try {
      if (file.size > 1024 * 1024) {
        throw new Error("Attachments must be 1 MB or smaller.");
      }

      const dataUrl = file.type.startsWith("image/")
        ? await compressImageFile(file)
        : await readFileAsDataUrl(file);
      const base64Payload = typeof dataUrl === "string" ? dataUrl.split(",")[1] || "" : "";
      setAttachment({
        dataUrl,
        mimeType: file.type || "application/octet-stream",
        name: file.name,
        size: Math.round((base64Payload.length * 3) / 4)
      });
    } catch (error) {
      pushToast({
        title: "Attachment failed",
        body: error.message
      });
    }
  }

  async function sendPayload(contactId, payload) {
    const message = await api.sendMessage(authState.token, contactId, payload);
    setMessages((current) => upsertMessage(current, message));
    applyMessageToContacts(message);
    setFailedSend(null);
  }

  async function handleSendMessage(event) {
    event.preventDefault();

    if (!authState?.token || !activeContactId || isComposerLocked(activeContact)) {
      return;
    }

    const payload = {
      text: draft.trim(),
      attachment,
      replyToId: replyTarget?.id || null,
      forwardMessageId: forwardMessage?.id || null
    };

    if (!payload.text && !payload.attachment && !payload.forwardMessageId) {
      return;
    }

    setDraft("");
    setAttachment(null);
    setChatError("");
    stopTyping(activeContactId);
    setShowEmojiPicker(false);
    setReplyTarget(null);
    setForwardMessage(null);

    try {
      await sendPayload(activeContactId, payload);
    } catch (error) {
      setDraft(payload.text);
      setAttachment(payload.attachment);
      setReplyTarget(replyTarget);
      setForwardMessage(forwardMessage);
      setFailedSend({
        contactId: activeContactId,
        payload,
        error: error.message
      });
      setChatError(error.message);
      pushToast({
        title: "Message not sent",
        body: error.message
      });
    }
  }

  async function handleRetryFailedSend() {
    if (!failedSend) {
      return;
    }

    try {
      await sendPayload(failedSend.contactId, failedSend.payload);
    } catch (error) {
      setChatError(error.message);
    }
  }

  async function handleToggleReaction(messageId, emoji) {
    if (!authState?.token) {
      return;
    }

    try {
      const updated = await api.toggleReaction(authState.token, messageId, emoji);
      setMessages((current) => upsertMessage(current, updated));
      applyMessageToContacts(updated);
    } catch (error) {
      pushToast({
        title: "Reaction failed",
        body: error.message
      });
    }
  }

  function handleStartEdit(message) {
    setEditingMessageId(message.id);
    setEditingText(message.deletedAt ? "" : message.text);
    setShowEmojiPicker(false);
  }

  async function handleEditMessage(messageId) {
    if (!authState?.token || !editingText.trim()) {
      return;
    }

    try {
      const updated = await api.editMessage(authState.token, messageId, editingText.trim());
      setMessages((current) => upsertMessage(current, updated));
      applyMessageToContacts(updated);
      setEditingMessageId(null);
      setEditingText("");
    } catch (error) {
      pushToast({
        title: "Edit failed",
        body: error.message
      });
    }
  }

  async function handleDeleteMessage(messageId) {
    if (!authState?.token) {
      return;
    }

    try {
      const updated = await api.deleteMessage(authState.token, messageId);
      setMessages((current) => upsertMessage(current, updated));
      applyMessageToContacts(updated);
    } catch (error) {
      pushToast({
        title: "Delete failed",
        body: error.message
      });
    }
  }

  async function handleToggleStar(messageId) {
    if (!authState?.token) {
      return;
    }

    try {
      const updated = await api.toggleStar(authState.token, messageId);
      setMessages((current) => upsertMessage(current, updated));
      applyMessageToContacts(updated);
    } catch (error) {
      pushToast({
        title: "Star failed",
        body: error.message
      });
    }
  }

  async function handleTogglePinnedMessage(messageId) {
    if (!authState?.token || !activeContact) {
      return;
    }

    try {
      const response = await api.togglePinnedMessage(authState.token, messageId);
      updateContactState(activeContact.id, (contact) => ({
        ...contact,
        pinnedMessageIds: response.pinnedMessageIds || []
      }));
    } catch (error) {
      pushToast({
        title: "Pin failed",
        body: error.message
      });
    }
  }

  async function handleTogglePreference(key) {
    if (!authState?.token || !activeContact) {
      return;
    }

    try {
      const nextValue = !activeContact[key];
      const response = await api.updatePreferences(authState.token, activeContact.id, {
        [key]: nextValue
      });
      mergeSingleContact(response);
      setSidebarSection(getContactCategory(response));
    } catch (error) {
      pushToast({
        title: "Update failed",
        body: error.message
      });
    }
  }

  async function handleSetNickname() {
    if (!activeContact) {
      return;
    }

    const nextNickname = window.prompt("Set nickname", activeContact.nickname || "") ?? null;
    if (nextNickname === null) {
      return;
    }

    await handleConversationAction(
      { nickname: nextNickname },
      {
        toastTitle: "Nickname updated"
      }
    );
  }

  async function handleSetLabels() {
    if (!activeContact) {
      return;
    }

    const currentValue = (activeContact.labels || []).join(", ");
    const nextValue = window.prompt("Set labels (comma separated)", currentValue) ?? null;
    if (nextValue === null) {
      return;
    }

    await handleConversationAction(
      {
        labels: nextValue
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      },
      {
        toastTitle: "Labels updated"
      }
    );
  }

  async function handleConversationAction(payload, options = {}) {
    if (!authState?.token || !activeContact) {
      return;
    }

    try {
      const response = await api.updatePreferences(authState.token, activeContact.id, payload);
      mergeSingleContact(response);
      setSidebarSection(options.section || getContactCategory(response));

      if (options.toastTitle) {
        pushToast({
          title: options.toastTitle,
          body: options.toastBody || `${activeContact.name} was updated.`
        });
      }
    } catch (error) {
      pushToast({
        title: "Update failed",
        body: error.message
      });
    }
  }

  async function handleExportConversation() {
    if (!authState?.token || !activeContact) {
      return;
    }

    try {
      const response = await api.exportMessages(authState.token, activeContact.id);
      const blob = new Blob([JSON.stringify(response, null, 2)], {
        type: "application/json"
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${(activeContact.displayName || activeContact.name).replace(/\s+/g, "-").toLowerCase()}-chat.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      pushToast({
        title: "Export failed",
        body: error.message
      });
    }
  }

  async function handleProfileUpdate(payload) {
    if (!authState?.token) {
      return;
    }

    try {
      const response = await api.updateProfile(authState.token, payload);
      syncCurrentUser(response.user);
      pushToast({
        title: "Profile updated",
        body: "Your profile settings were saved."
      });
    } catch (error) {
      pushToast({
        title: "Profile update failed",
        body: error.message
      });
    }
  }

  async function handleAvatarChange(file) {
    if (!authState?.token) {
      return;
    }

    try {
      setUploadingAvatar(true);
      const croppedImageData = await cropAvatarToSquare(file);
      const response = await api.uploadAvatar(authState.token, croppedImageData);
      syncCurrentUser(response.user);
      pushToast({
        title: "Profile updated",
        body: "Your profile picture was updated."
      });
    } catch (error) {
      pushToast({
        title: "Upload failed",
        body: error.message
      });
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleLogoutAll() {
    if (!authState?.token) {
      return;
    }

    try {
      setLogoutAllLoading(true);
      await api.logoutAll(authState.token);
      clearAuthState("Logged out from all sessions.");
    } catch (error) {
      pushToast({
        title: "Logout failed",
        body: error.message
      });
    } finally {
      setLogoutAllLoading(false);
    }
  }

  async function handleLogout() {
    if (!authState?.token) {
      clearAuthState();
      return;
    }

    try {
      await api.logout(authState.token);
    } catch (error) {
      pushToast({
        title: "Logout failed",
        body: error.message
      });
    } finally {
      clearAuthState("Logged out from this device.");
    }
  }

  async function handleRequestTwoFactorSetup() {
    if (!authState?.token) {
      return;
    }

    try {
      setSecurityActionLoading(true);
      const response = await api.requestTwoFactorSetup(authState.token);
      setTwoFactorSetupCode(response.devTwoFactorCode || "");
      pushToast({
        title: "Security code generated",
        body: response.message
      });
    } catch (error) {
      pushToast({
        title: "2-step setup failed",
        body: error.message
      });
    } finally {
      setSecurityActionLoading(false);
    }
  }

  async function handleEnableTwoFactor() {
    if (!authState?.token || !twoFactorSetupInput.trim()) {
      return;
    }

    try {
      setSecurityActionLoading(true);
      const response = await api.enableTwoFactor(authState.token, twoFactorSetupInput.trim());
      syncCurrentUser(response.user);
      setTwoFactorSetupCode("");
      setTwoFactorSetupInput("");
      pushToast({
        title: "2-step verification enabled",
        body: response.message
      });
    } catch (error) {
      pushToast({
        title: "2-step verification failed",
        body: error.message
      });
    } finally {
      setSecurityActionLoading(false);
    }
  }

  async function handleDisableTwoFactor() {
    if (!authState?.token) {
      return;
    }

    try {
      setSecurityActionLoading(true);
      const response = await api.disableTwoFactor(authState.token);
      syncCurrentUser(response.user);
      setTwoFactorSetupCode("");
      setTwoFactorSetupInput("");
      pushToast({
        title: "2-step verification disabled",
        body: response.message
      });
    } catch (error) {
      pushToast({
        title: "2-step verification failed",
        body: error.message
      });
    } finally {
      setSecurityActionLoading(false);
    }
  }

  async function handleEnableNotifications() {
    if (!("Notification" in window)) {
      return;
    }

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);

    if (permission === "granted") {
      pushToast({
        title: "Notifications enabled",
        body: "Browser alerts are now active."
      });
    }
  }

  function handleSelectContact(contactId) {
    if (contactId === activeContactId) {
      return;
    }

    const nextContact = contactsRef.current.find((contact) => contact.id === contactId);
    stopTyping();
    setActiveContactId(contactId);
    if (nextContact) {
      setSidebarSection(getContactCategory(nextContact));
    }
    setDraft("");
    setAttachment(null);
    setFailedSend(null);
    setReplyTarget(null);
    setForwardMessage(null);
    setEditingMessageId(null);
    setEditingText("");
    setShowEmojiPicker(false);
  }

  function handleBackToContacts() {
    stopTyping();
    setActiveContactId(null);
    setShowEmojiPicker(false);
    setReplyTarget(null);
    setEditingMessageId(null);
    setEditingText("");
  }

  function handleToggleTheme() {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }

  if (authBootstrapping) {
    return (
      <>
        <div className="auth-shell">
          <div className="auth-card auth-status-card">
            <span className="eyebrow">ALLIED</span>
            <h1>WITCH</h1>
            <p className="auth-copy">Restoring your saved login and conversations.</p>
            <p className="auth-copy">Created by S rahman from NE-09.</p>
          </div>
        </div>
        <Toasts toasts={toasts} />
      </>
    );
  }

  if (!authState?.token || !authState?.user) {
    return (
      <>
        <AuthForm
          mode={authMode}
          notice={authNotice}
          onModeChange={handleAuthModeChange}
          onSubmit={handleAuthSubmit}
          loading={authLoading}
          error={authError}
          recoveryCode={authMode === "twoFactor" ? twoFactorCode : recoveryCode}
        />
        <Toasts toasts={toasts} />
      </>
    );
  }

  return (
    <>
      <main className="app-shell">
        <div className={`app-frame ${activeContact ? "mobile-chat-open" : ""}`}>
          <Sidebar
            activeContactId={activeContactId}
            contacts={contacts}
            currentUser={authState.user}
            logoutAllLoading={logoutAllLoading}
            notificationPermission={notificationPermission}
            onAvatarChange={handleAvatarChange}
            onDisableTwoFactor={handleDisableTwoFactor}
            onEnableNotifications={handleEnableNotifications}
            onEnableTwoFactor={handleEnableTwoFactor}
            onLogout={handleLogout}
            onLogoutAll={handleLogoutAll}
            onRequestTwoFactorSetup={handleRequestTwoFactorSetup}
            onSaveProfile={handleProfileUpdate}
            onSelectContact={handleSelectContact}
            onSelectSection={setSidebarSection}
            onToggleTheme={handleToggleTheme}
            searchInputRef={searchInputRef}
            securityActionLoading={securityActionLoading}
            section={sidebarSection}
            theme={theme}
            twoFactorSetupCode={twoFactorSetupCode}
            twoFactorSetupInput={twoFactorSetupInput}
            onTwoFactorSetupInputChange={setTwoFactorSetupInput}
            uploadingAvatar={uploadingAvatar}
          />
          <ConversationPane
            activeContact={activeContact}
            attachment={attachment}
            currentUserId={authState.user.id}
            draft={draft}
            editingMessageId={editingMessageId}
            editingText={editingText}
            error={chatError}
            failedSend={failedSend}
            hasMoreMessages={hasMoreMessages}
            isTyping={Boolean(activeContact?.isTyping)}
            loading={messagesLoading}
            loadingOlderMessages={loadingOlderMessages}
            messageSearch={messageSearch}
            messages={messages}
            onAppendEmoji={(emoji) => setDraft((current) => `${current}${emoji}`)}
            onAttachmentSelect={handleAttachmentSelect}
            onBack={handleBackToContacts}
            onCancelEdit={() => {
              setEditingMessageId(null);
              setEditingText("");
            }}
            onDeleteMessage={handleDeleteMessage}
            onDraftChange={handleDraftChange}
            onEditMessage={handleEditMessage}
            onEditingTextChange={setEditingText}
            onExportConversation={handleExportConversation}
            onForwardMessage={setForwardMessage}
            onLoadOlder={handleLoadOlderMessages}
            onReplyToMessage={setReplyTarget}
            onRemoveAttachment={() => setAttachment(null)}
            onRetryFailedSend={handleRetryFailedSend}
            onSend={handleSendMessage}
            onSetLabels={handleSetLabels}
            onSetNickname={handleSetNickname}
            onStartEdit={handleStartEdit}
            onToggleFavorite={() => handleTogglePreference("isFavorite")}
            onAcceptRequest={() =>
              handleConversationAction(
                { acceptRequest: true },
                {
                  section: "inbox",
                  toastTitle: "Request accepted",
                  toastBody: `${activeContact.name} moved to your inbox.`
                }
              )
            }
            onArchive={() =>
              handleConversationAction(
                { isArchived: !activeContact?.isArchived },
                {
                  section: activeContact?.isArchived ? "inbox" : "archived",
                  toastTitle: activeContact?.isArchived ? "Conversation restored" : "Conversation archived"
                }
              )
            }
            onRestrict={() =>
              handleConversationAction(
                { isRestricted: !activeContact?.isRestricted },
                {
                  section: activeContact?.isRestricted ? "inbox" : "restricted",
                  toastTitle: activeContact?.isRestricted ? "Restriction removed" : "Conversation restricted"
                }
              )
            }
            onRestoreFromTrash={() =>
              handleConversationAction(
                { isTrashed: false },
                {
                  section:
                    activeContact?.requestState === "pending"
                      ? "requests"
                      : activeContact?.isArchived
                        ? "archived"
                        : activeContact?.isRestricted
                          ? "restricted"
                          : "inbox",
                  toastTitle: "Conversation restored"
                }
              )
            }
            onTrash={() =>
              handleConversationAction(
                { isTrashed: !activeContact?.isTrashed },
                {
                  section: activeContact?.isTrashed ? "inbox" : "trash",
                  toastTitle: activeContact?.isTrashed ? "Conversation restored" : "Moved to trash"
                }
              )
            }
            onToggleBlock={() => handleTogglePreference("isBlocked")}
            onToggleMute={() => handleTogglePreference("isMuted")}
            onTogglePin={() => handleTogglePreference("isPinned")}
            onTogglePinnedMessage={handleTogglePinnedMessage}
            onToggleReaction={handleToggleReaction}
            onToggleStar={handleToggleStar}
            onToggleEmojiPicker={() => setShowEmojiPicker((current) => !current)}
            pinnedMessages={messages.filter((message) => activeContact?.pinnedMessageIds?.includes(message.id))}
            replyTarget={replyTarget}
            forwardMessage={forwardMessage}
            onClearReplyTarget={() => setReplyTarget(null)}
            onClearForwardMessage={() => setForwardMessage(null)}
            onSearchChange={setMessageSearch}
            showEmojiPicker={showEmojiPicker}
          />
        </div>
      </main>
      <Toasts toasts={toasts} />
    </>
  );
}
