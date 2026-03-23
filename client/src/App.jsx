import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

import { api } from "./api";
import { createPlannerItemFromMessage, readCalendarEvents, sortCalendarEvents, writeCalendarEvents } from "./calendar-utils";
import { calculateInvoiceTotals, readInvoices, sortInvoices, writeInvoices } from "./invoice-utils";
import { AppRail } from "./components/AppRail";
import { AuthForm } from "./components/AuthForm";
import { ChatActionPanel } from "./components/ChatActionPanel";
import { ConversationListPane } from "./components/ConversationListPane";
import { ConversationPane } from "./components/ConversationPane";
import { FloatingGlassOrbs } from "./components/FloatingGlassOrbs";
import { ProjectChatWindow } from "./components/ProjectChatWindow";
import { PROJECT_MANAGER_STORAGE_KEY, ProjectManagerWindow } from "./components/ProjectManagerWindow";
import { RamadanWindow } from "./components/RamadanWindow";
import { TaskManagerWindow } from "./components/TaskManagerWindow";
import { Toasts } from "./components/Toasts";
import { WorkspaceMessenger } from "./components/WorkspaceMessenger";
import { useHistoryBackLayer } from "./useHistoryBackLayer";
import {
  filterInboxGroupMessages,
  mergeInboxGroupContacts,
  readStoredInboxGroups,
  upsertInboxGroup,
  writeStoredInboxGroups
} from "./inbox-group-utils";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://127.0.0.1:5001";
const STORAGE_KEY = "messenger-mvp-auth";
const THEME_KEY = "messenger-mvp-theme";
const WORKSPACE_DEMO_EXITED_KEY = "messenger-mvp-workspace-demo-exited";
const WORKSPACE_SESSION_KEY = "messenger-mvp-workspace-session";
const WORKSPACE_REAL_MODE_KEY = "messenger-mvp-workspace-real-mode";
const PAGE_SIZE = 20;
const COMPACT_RAIL_BREAKPOINT = 1080;
const HIDDEN_RAIL_BREAKPOINT = 920;
const APP_HISTORY_KEY = "__witchAppView";
function normalizeShellSidebarSection(section) {
  return section === "workspace" ? "inbox" : section || "inbox";
}

function buildAppHistorySnapshot({ activeContactId, embeddedWorkspace, sidebarSection }) {
  if (embeddedWorkspace) {
    return {
      kind: "workspace",
      sidebarSection: "workspace",
      embeddedWorkspace: {
        mode: embeddedWorkspace.mode,
        realMode: embeddedWorkspace.realMode || null,
        nav: embeddedWorkspace.nav,
        threadId: embeddedWorkspace.threadId,
        workspaceScope: embeddedWorkspace.workspaceScope,
        preferredWorkspaceUserId: embeddedWorkspace.preferredWorkspaceUserId || null
      }
    };
  }

  if (activeContactId) {
    return {
      kind: "conversation",
      sidebarSection,
      activeContactId
    };
  }

  return {
    kind: "inbox",
    sidebarSection: normalizeShellSidebarSection(sidebarSection)
  };
}

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

function readStoredBoolean(key) {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function persistStoredBoolean(key, value) {
  if (value) {
    window.localStorage.setItem(key, "1");
    return;
  }

  window.localStorage.removeItem(key);
}

function readStoredString(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function persistStoredString(key, value) {
  if (value == null || value === "") {
    window.localStorage.removeItem(key);
    return;
  }

  window.localStorage.setItem(key, value);
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const normalized = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(normalized);
  return Uint8Array.from([...rawData].map((character) => character.charCodeAt(0)));
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
      muteUntil: contact.muteUntil ?? existing?.muteUntil ?? null,
      muteDisabledForever: contact.muteDisabledForever ?? existing?.muteDisabledForever ?? false,
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

function readStoredProjectState() {
  try {
    const rawValue = window.localStorage.getItem(PROJECT_MANAGER_STORAGE_KEY);
    return rawValue ? JSON.parse(rawValue) : { projects: [] };
  } catch {
    return { projects: [] };
  }
}

function writeStoredProjectState(payload) {
  window.localStorage.setItem(PROJECT_MANAGER_STORAGE_KEY, JSON.stringify(payload));
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

function sortPdfReviewSessions(sessions) {
  return [...sessions].sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt));
}

function upsertPdfReviewSession(list, session) {
  const next = list.filter((entry) => entry.id !== session.id);
  next.unshift(session);
  return sortPdfReviewSessions(next);
}

function upsertMemoryCapsule(list, capsule) {
  const next = list.filter((entry) => entry.id !== capsule.id);
  next.unshift(capsule);
  return next.sort((first, second) => new Date(second.updatedAt || second.createdAt) - new Date(first.updatedAt || first.createdAt));
}

function createEmptyBondState() {
  return {
    coupleRequestedBy: null,
    coupleRequestExpiresAt: null,
    coupleCooldownUntil: null,
    coupleActive: false,
    trustPromptVisible: false,
    trustRequestedBy: null,
    trustRequestExpiresAt: null,
    trustActive: false,
    trustIgnoredBy: null,
    begEligibleUserId: null
  };
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

function WorkspaceAccessScreen({ moduleLabel, currentUser, onClose, onSignIn, onUseDemo }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "radial-gradient(circle at top, #10221d 0%, #080d16 28%, #0a0f1a 100%)"
      }}
    >
      <div
        style={{
          width: "min(460px, 100%)",
          borderRadius: 28,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "linear-gradient(180deg,#111827 0%,#0f1623 100%)",
          boxShadow: "0 30px 80px rgba(0,0,0,0.42)",
          padding: 28,
          color: "#f8fafc",
          fontFamily: '"Manrope","DM Sans","Segoe UI",sans-serif'
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 18,
            display: "grid",
            placeItems: "center",
            background: "linear-gradient(135deg,#10b981,#059669)",
            color: "#fff",
            fontFamily: '"Sora","Manrope","DM Sans","Segoe UI",sans-serif',
            fontWeight: 800,
            fontSize: 28,
            boxShadow: "0 0 28px rgba(16,185,129,0.28)"
          }}
        >
          W
        </div>

        <p style={{ margin: "18px 0 0", fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: "#64748b", fontWeight: 700 }}>
          Real Workspace
        </p>
        <h2 style={{ margin: "10px 0 0", fontFamily: '"Sora","Manrope","DM Sans","Segoe UI",sans-serif', fontSize: 28, lineHeight: 1.15, fontWeight: 700 }}>
          Sign in to {moduleLabel}
        </h2>
        <p style={{ margin: "12px 0 0", color: "#94a3b8", lineHeight: 1.7 }}>
          Demo mode has been disabled for this device. Continue into the real workspace with your messenger account.
        </p>

        <div
          style={{
            marginTop: 22,
            borderRadius: 20,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.04)",
            padding: 18
          }}
        >
          <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "#64748b", fontWeight: 700 }}>
            Continue as
          </div>
          <div style={{ marginTop: 10, fontSize: 20, fontWeight: 700, color: "#f8fafc" }}>{currentUser?.name || "Workspace user"}</div>
          <div style={{ marginTop: 4, color: "#94a3b8", fontSize: 14 }}>{currentUser?.email || "No email available"}</div>
        </div>

        <div style={{ display: "grid", gap: 12, marginTop: 22 }}>
          <div style={{ display: "flex", gap: 12 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1,
                height: 46,
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.04)",
                color: "#cbd5e1",
                fontWeight: 700,
                cursor: "pointer"
              }}
            >
              Close
            </button>
            <button
              type="button"
              onClick={onUseDemo}
              style={{
                flex: 1,
                height: 46,
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.04)",
                color: "#cbd5e1",
                fontWeight: 700,
                cursor: "pointer"
              }}
            >
              Use Demo
            </button>
          </div>
          <button
            type="button"
            onClick={onSignIn}
            style={{
              height: 46,
              borderRadius: 14,
              width: "100%",
              border: "1px solid rgba(16,185,129,0.36)",
              background: "linear-gradient(135deg,#10b981,#059669)",
              color: "#fff",
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: "0 14px 30px rgba(5,150,105,0.24)"
            }}
          >
            Sign in
          </button>
        </div>
      </div>
    </div>
  );
}

function WorkspaceNoAccessScreen({ currentUser, onClose, onLogout }) {
  return (
    <div
      style={{
        minHeight: "100%",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "linear-gradient(180deg,#eaf3ff 0%,#d8e5ff 100%)"
      }}
    >
      <div
        style={{
          width: "min(560px, 100%)",
          borderRadius: 28,
          border: "1px solid rgba(148,163,184,0.25)",
          background: "rgba(255,255,255,0.88)",
          boxShadow: "0 24px 60px rgba(15,23,42,0.16)",
          padding: 28
        }}
      >
        <div style={{ fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase", color: "#64748b", fontWeight: 700 }}>
          Workspace access
        </div>
        <h2
          style={{
            marginTop: 10,
            fontFamily: '"Sora","Manrope","DM Sans","Segoe UI",sans-serif',
            fontSize: 34,
            lineHeight: 1.05,
            fontWeight: 800,
            color: "#0f172a"
          }}
        >
          No workspace assigned yet
        </h2>
        <p style={{ marginTop: 14, fontSize: 16, lineHeight: 1.7, color: "#475569" }}>
          {currentUser?.email
            ? `${currentUser.email} is signed in, but there is no active finance or warehouse workspace membership attached to this account yet.`
            : "This account does not have an active workspace membership yet."}
        </p>
        <div
          style={{
            marginTop: 18,
            borderRadius: 18,
            border: "1px solid rgba(148,163,184,0.22)",
            background: "rgba(15,23,42,0.04)",
            padding: "14px 16px",
            color: "#475569",
            fontSize: 14,
            lineHeight: 1.6
          }}
        >
          Ask the platform owner to assign this account to a customer workspace and enable Finance, Warehouse, or both.
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 22 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              height: 44,
              borderRadius: 14,
              border: "1px solid rgba(148,163,184,0.3)",
              background: "#fff",
              color: "#0f172a",
              fontWeight: 700,
              padding: "0 18px",
              cursor: "pointer"
            }}
          >
            Back to messenger
          </button>
          {onLogout ? (
            <button
              type="button"
              onClick={onLogout}
              style={{
                height: 44,
                borderRadius: 14,
                border: "1px solid rgba(239,68,68,0.24)",
                background: "rgba(239,68,68,0.08)",
                color: "#b91c1c",
                fontWeight: 700,
                padding: "0 18px",
                cursor: "pointer"
              }}
            >
              Logout
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function normalizeWorkspaceRealMode(value) {
  return ["finance", "warehouse", "both"].includes(value) ? value : null;
}

function deriveWorkspaceRealModeFromMemberships(workspaces = []) {
  const memberships = Array.isArray(workspaces) ? workspaces : [];
  const moduleSet = new Set();

  memberships.forEach((entry) => {
    const modules = Array.isArray(entry?.membership?.modules) ? entry.membership.modules : [];
    modules.forEach((moduleId) => moduleSet.add(moduleId));
  });

  const hasFinance = moduleSet.has("finance");
  const hasWarehouse = moduleSet.has("warehouse");

  if (hasFinance && hasWarehouse) {
    return "both";
  }

  if (hasFinance) {
    return "finance";
  }

  if (hasWarehouse) {
    return "warehouse";
  }

  return null;
}

function getWorkspaceModuleLabel(mode) {
  if (mode === "warehouse") {
    return "Warehouse Workspace";
  }

  if (mode === "both") {
    return "Operations Workspace";
  }

  return "Finance Workspace";
}

function getWorkspaceViewConfig(mode, preferredNav = null, preferredThreadId = null) {
  if (mode === "warehouse") {
    return {
      nav: preferredNav || "warehouse",
      threadId: preferredThreadId || "warebot",
      workspaceScope: "warehouse"
    };
  }

  if (mode === "finance") {
    return {
      nav: preferredNav || "finances",
      threadId: preferredThreadId || "financebot",
      workspaceScope: "finance"
    };
  }

  return {
    nav: preferredNav || "inbox",
    threadId: preferredThreadId || "financebot",
    workspaceScope: "both"
  };
}

function WorkspaceModeSelectionScreen({ currentUser, onClose, onSelectMode, onUseDemo }) {
  const options = [
    {
      id: "finance",
      label: "Finance",
      description: "Invoices, approvals, expenses, and budget controls.",
      accent: "#10b981"
    },
    {
      id: "warehouse",
      label: "Warehouse",
      description: "Stock, reorder flow, shipments, and delivery tracking.",
      accent: "#f59e0b"
    },
    {
      id: "both",
      label: "Both",
      description: "Use finance and warehouse together inside one shared workspace.",
      accent: "#60a5fa"
    }
  ];

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "radial-gradient(circle at top, #10221d 0%, #080d16 28%, #0a0f1a 100%)"
      }}
    >
      <div
        style={{
          width: "min(560px, 100%)",
          borderRadius: 28,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "linear-gradient(180deg,#111827 0%,#0f1623 100%)",
          boxShadow: "0 30px 80px rgba(0,0,0,0.42)",
          padding: 28,
          color: "#f8fafc",
          fontFamily: '"Manrope","DM Sans","Segoe UI",sans-serif'
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 18,
            display: "grid",
            placeItems: "center",
            background: "linear-gradient(135deg,#10b981,#059669)",
            color: "#fff",
            fontFamily: '"Sora","Manrope","DM Sans","Segoe UI",sans-serif',
            fontWeight: 800,
            fontSize: 28,
            boxShadow: "0 0 28px rgba(16,185,129,0.28)"
          }}
        >
          W
        </div>

        <p style={{ margin: "18px 0 0", fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: "#64748b", fontWeight: 700 }}>
          Real Workspace Setup
        </p>
        <h2 style={{ margin: "10px 0 0", fontFamily: '"Sora","Manrope","DM Sans","Segoe UI",sans-serif', fontSize: 28, lineHeight: 1.15, fontWeight: 700 }}>
          Choose the workspace you want to use
        </h2>
        <p style={{ margin: "12px 0 0", color: "#94a3b8", lineHeight: 1.7 }}>
          We’ll save this choice and use it the next time you open Workspace from the messenger shell.
        </p>

        <div
          style={{
            marginTop: 22,
            borderRadius: 20,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.04)",
            padding: 18
          }}
        >
          <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "#64748b", fontWeight: 700 }}>
            Workspace user
          </div>
          <div style={{ marginTop: 10, fontSize: 20, fontWeight: 700, color: "#f8fafc" }}>{currentUser?.name || "Workspace user"}</div>
          <div style={{ marginTop: 4, color: "#94a3b8", fontSize: 14 }}>{currentUser?.email || "No email available"}</div>
        </div>

        <div style={{ display: "grid", gap: 12, marginTop: 22 }}>
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => onSelectMode(option.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                width: "100%",
                minHeight: 74,
                borderRadius: 18,
                border: `1px solid ${option.accent}40`,
                background: "rgba(255,255,255,0.04)",
                color: "#f8fafc",
                padding: "16px 18px",
                textAlign: "left",
                cursor: "pointer"
              }}
            >
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: option.accent,
                  boxShadow: `0 0 18px ${option.accent}66`
                }}
              />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontWeight: 700, fontSize: 18 }}>{option.label}</span>
                <span style={{ display: "block", marginTop: 4, fontSize: 14, color: "#94a3b8", lineHeight: 1.55 }}>
                  {option.description}
                </span>
              </span>
              <span style={{ color: option.accent, fontWeight: 700, flexShrink: 0 }}>Open</span>
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 22 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              flex: 1,
              height: 46,
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.04)",
              color: "#cbd5e1",
              fontWeight: 700,
              cursor: "pointer"
            }}
          >
            Close
          </button>
          <button
            type="button"
            onClick={onUseDemo}
            style={{
              flex: 1,
              height: 46,
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.04)",
              color: "#cbd5e1",
              fontWeight: 700,
              cursor: "pointer"
            }}
          >
            Use Demo
          </button>
        </div>
      </div>
    </div>
  );
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
  const searchParams = new URLSearchParams(window.location.search);
  const viewMode = searchParams.get("view");
  const requestedGroupId = searchParams.get("groupId");
  const isRamadanWindow = viewMode === "ramadan" || viewMode === "quran";
  const isProjectChatWindow = viewMode === "project-chat";
  const isProjectManagerWindow = viewMode === "projects";
  const isTaskManagerWindow = viewMode === "tasks";
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
  const [inboxGroups, setInboxGroups] = useState(readStoredInboxGroups);
  const [sidebarSection, setSidebarSection] = useState("inbox");
  const [activeContactId, setActiveContactId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageSearch, setMessageSearch] = useState("");
  const [contactSearch, setContactSearch] = useState("");
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
  const [forwardPickerMessage, setForwardPickerMessage] = useState(null);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingText, setEditingText] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [theme, setTheme] = useState(readStoredTheme);
  const [calendarEvents, setCalendarEvents] = useState(readCalendarEvents);
  const [invoiceDocuments, setInvoiceDocuments] = useState(readInvoices);
  const [memoryCapsules, setMemoryCapsules] = useState([]);
  const [pdfReviewSessions, setPdfReviewSessions] = useState([]);
  const [bondStates, setBondStates] = useState({});
  const [isRailCollapsed, setIsRailCollapsed] = useState(false);
  const [isWorkspacePanelOpen, setIsWorkspacePanelOpen] = useState(false);
  const [isConversationDrawerOpen, setIsConversationDrawerOpen] = useState(false);
  const [isActionPanelOpen, setIsActionPanelOpen] = useState(false);
  const [actionPanelDock, setActionPanelDock] = useState(null);
  const [calendarFocusEventId, setCalendarFocusEventId] = useState(null);
  const [embeddedWorkspace, setEmbeddedWorkspace] = useState(null);
  const [hasExitedWorkspaceDemo, setHasExitedWorkspaceDemo] = useState(() => readStoredBoolean(WORKSPACE_DEMO_EXITED_KEY));
  const [workspaceSessionActive, setWorkspaceSessionActive] = useState(() => readStoredBoolean(WORKSPACE_SESSION_KEY));
  const [workspaceRealMode, setWorkspaceRealMode] = useState(() =>
    normalizeWorkspaceRealMode(readStoredString(WORKSPACE_REAL_MODE_KEY))
  );
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const activeContactRef = useRef(null);
  const contactsRef = useRef([]);
  const inboxGroupsRef = useRef([]);
  const appHistoryReadyRef = useRef(false);
  const appHistoryRestoringRef = useRef(false);
  const lastAppHistoryRef = useRef("");
  const socketRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const typingTargetRef = useRef(null);
  const seenRequestsRef = useRef(new Set());
  const remindedCapsulesRef = useRef(new Set());
  const searchInputRef = useRef(null);
  const conversationBackHandlerRef = useRef(null);
  const [hasConversationBackLayer, setHasConversationBackLayer] = useState(false);

  function handleOpenRamadanWindow() {
    const quranUrl = new URL(window.location.href);
    quranUrl.searchParams.set("view", "ramadan");
    const popup = window.open(
      quranUrl.toString(),
      "witch-ramadan-window",
      "popup=yes,width=1180,height=860,left=80,top=60,resizable=yes,scrollbars=yes"
    );

    if (popup) {
      popup.focus();
      return;
    }

    window.location.href = quranUrl.toString();
  }

  function handleOpenTaskManagerWindow() {
    const taskUrl = new URL(window.location.href);
    taskUrl.searchParams.set("view", "tasks");
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
  }

  function handleOpenProjectManagerWindow(initialProjectName = "") {
    const projectUrl = new URL(window.location.href);
    projectUrl.searchParams.set("view", "projects");
    if (initialProjectName.trim()) {
      projectUrl.searchParams.set("composer", "new");
      projectUrl.searchParams.set("projectName", initialProjectName.trim());
    } else {
      projectUrl.searchParams.delete("composer");
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
  }

  function getBusinessWorkspaceRole() {
    const role = authState?.user?.role;
    return ["finance", "warehouse", "owner", "manager"].includes(role) ? role : "manager";
  }

  function handleOpenBusinessWorkspaceWindow({ nav, threadId, windowName }) {
    const workspaceUrl = new URL(window.location.href);
    workspaceUrl.searchParams.set("view", "workspace-messenger");
    workspaceUrl.searchParams.set("userRole", getBusinessWorkspaceRole());
    if (nav) {
      workspaceUrl.searchParams.set("nav", nav);
    }
    if (threadId) {
      workspaceUrl.searchParams.set("thread", threadId);
    }

    const popup = window.open(
      workspaceUrl.toString(),
      windowName,
      "popup=yes,width=1480,height=920,left=90,top=50,resizable=yes,scrollbars=yes"
    );

    if (popup) {
      popup.focus();
      return;
    }

    window.location.href = workspaceUrl.toString();
  }

  function getNextWorkspaceMode(requestedRealMode = null) {
    if (!hasExitedWorkspaceDemo) {
      return "demo";
    }

    const nextRealMode = normalizeWorkspaceRealMode(requestedRealMode) || workspaceRealMode;
    if (!nextRealMode) {
      return "select";
    }

    if (workspaceSessionActive) {
      return "real";
    }

    return "auth";
  }

  function openEmbeddedWorkspace(requestedRealMode = null, preferredNav = null, preferredThreadId = null, options = {}) {
    const mode = getNextWorkspaceMode(requestedRealMode);
    const effectiveRealMode = mode === "demo" ? "both" : normalizeWorkspaceRealMode(requestedRealMode) || workspaceRealMode || "both";
    const nextView = getWorkspaceViewConfig(effectiveRealMode, preferredNav, preferredThreadId);

    setSidebarSection("workspace");
    setEmbeddedWorkspace({
      ...nextView,
      mode,
      realMode: mode === "demo" ? null : effectiveRealMode,
      preferredWorkspaceUserId: options.preferredWorkspaceUserId || null
    });
  }

  function handleOpenWorkspaceWindow() {
    openEmbeddedWorkspace();
  }

  function handleOpenFinanceWindow() {
    openEmbeddedWorkspace("finance", "finances", "financebot");
  }

  function handleOpenWarehouseWindow() {
    openEmbeddedWorkspace("warehouse", "warehouse", "warebot");
  }

  function handleOpenWorkspaceChatForContact(contactId) {
    if (!contactId) {
      return;
    }

    openEmbeddedWorkspace(workspaceRealMode || "both", "inbox", null, {
      preferredWorkspaceUserId: contactId
    });
  }

  function handleOpenPersonalChatFromWorkspace(contactId) {
    if (!contactId) {
      return;
    }

    const matchingContact = contactsRef.current.find((contact) => contact.id === contactId && !contact.isGroup);
    if (!matchingContact) {
      pushToast({
        title: "Personal chat unavailable",
        body: "This workspace member is not available in your personal messenger contacts."
      });
      return;
    }

    openConversation(contactId);
  }

  function handleOpenCalendarEvent(eventId = null) {
    setActionPanelDock("calendar");
    setCalendarFocusEventId(eventId);
    if (!showDockedActionPanel) {
      setIsActionPanelOpen(true);
    }
  }

  if (isRamadanWindow) {
    return <RamadanWindow />;
  }

  if (isProjectChatWindow) {
    return <ProjectChatWindow currentUser={authState?.user} />;
  }

  if (isProjectManagerWindow) {
    return <ProjectManagerWindow currentUser={authState?.user} authToken={authState?.token} />;
  }

  if (isTaskManagerWindow) {
    return <TaskManagerWindow currentUser={authState?.user} authToken={authState?.token} />;
  }

  useEffect(() => {
    activeContactRef.current = activeContactId;
  }, [activeContactId]);

  useEffect(() => {
    persistStoredBoolean(WORKSPACE_DEMO_EXITED_KEY, hasExitedWorkspaceDemo);
  }, [hasExitedWorkspaceDemo]);

  useEffect(() => {
    persistStoredBoolean(WORKSPACE_SESSION_KEY, workspaceSessionActive);
  }, [workspaceSessionActive]);

  useEffect(() => {
    persistStoredString(WORKSPACE_REAL_MODE_KEY, workspaceRealMode);
  }, [workspaceRealMode]);

  useEffect(() => {
    contactsRef.current = contacts;
  }, [contacts]);

  useEffect(() => {
    inboxGroupsRef.current = inboxGroups;
  }, [inboxGroups]);

  useEffect(() => {
    persistAuth(authState);
  }, [authState]);

  function getVisibleInboxGroups(groups = inboxGroupsRef.current, userId = authState?.user?.id) {
    if (!userId) {
      return [];
    }

    return groups
      .map((group) => filterInboxGroupMessages(group))
      .filter((group) => !group.memberIds.length || group.memberIds.includes(userId));
  }

  function syncInboxGroupContacts(nextGroups, userId = authState?.user?.id) {
    setContacts((current) => sortContacts(mergeInboxGroupContacts(current, getVisibleInboxGroups(nextGroups, userId))));
  }

  function persistInboxGroups(nextGroups) {
    setInboxGroups(nextGroups);
    writeStoredInboxGroups(nextGroups);
    syncInboxGroupContacts(nextGroups);
  }

  function mirrorInboxGroupToProjectState(group) {
    if (!group?.projectId) {
      return;
    }

    const projectState = readStoredProjectState();
    const nextProjects = (projectState.projects || []).map((project) =>
      project.id === group.projectId
        ? {
            ...project,
            chatRoom: {
              ...(project.chatRoom || {}),
              name: group.name,
              disappearingMode: group.disappearingMode,
              inboxGroupId: group.id,
              pinnedMessageIds: group.pinnedMessageIds || [],
              messages: group.messages,
              updatedAt: group.updatedAt
            }
          }
        : project
    );

    writeStoredProjectState({
      ...projectState,
      projects: nextProjects
    });
  }

  useEffect(() => {
    persistTheme(theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    writeCalendarEvents(calendarEvents);
  }, [calendarEvents]);

  useEffect(() => {
    writeInvoices(invoiceDocuments);
  }, [invoiceDocuments]);

  useEffect(() => {
    function syncInboxGroupsFromStorage(event) {
      if (event.key && event.key !== "witch-inbox-groups") {
        return;
      }

      const nextGroups = readStoredInboxGroups();
      setInboxGroups(nextGroups);
      syncInboxGroupContacts(nextGroups, authState?.user?.id);
    }

    window.addEventListener("storage", syncInboxGroupsFromStorage);
    return () => window.removeEventListener("storage", syncInboxGroupsFromStorage);
  }, [authState?.user?.id]);

  useEffect(() => {
    function handleResize() {
      setViewportWidth(window.innerWidth);
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const isHiddenRail = viewportWidth <= HIDDEN_RAIL_BREAKPOINT && viewportWidth > 900;
  const isCompactRail =
    viewportWidth <= COMPACT_RAIL_BREAKPOINT && viewportWidth > HIDDEN_RAIL_BREAKPOINT;
  const shouldAutoCollapseRail = isCompactRail || isHiddenRail;
  const isRailOverlayMode = isCompactRail || isHiddenRail;
  const effectiveRailCollapsed = isRailCollapsed || shouldAutoCollapseRail;
  const showDockedActionPanel = viewportWidth > 1280;
  const compactComposer = viewportWidth <= 1180;
  const isCompactConversationMode = viewportWidth <= 900;
  const supportsWorkspaceOverlay = isRailOverlayMode || isCompactConversationMode;

  useEffect(() => {
    if (showDockedActionPanel && isActionPanelOpen) {
      setIsActionPanelOpen(false);
    }
  }, [isActionPanelOpen, showDockedActionPanel]);

  useEffect(() => {
    if (!supportsWorkspaceOverlay && isWorkspacePanelOpen) {
      setIsWorkspacePanelOpen(false);
    }
  }, [isWorkspacePanelOpen, supportsWorkspaceOverlay]);

  useEffect(() => {
    if (!isCompactConversationMode && isConversationDrawerOpen) {
      setIsConversationDrawerOpen(false);
    }
  }, [isCompactConversationMode, isConversationDrawerOpen]);

  useEffect(() => {
    if (isCompactConversationMode && !activeContactId) {
      setIsConversationDrawerOpen(true);
    }
  }, [activeContactId, isCompactConversationMode]);

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

  function handleUnavailableAction(feature) {
    pushToast({
      title: `${feature} coming soon`,
      body: `${feature} is not wired into this build yet.`
    });
  }

  function clearAuthState(nextError = "") {
    stopTyping();
    remindedCapsulesRef.current.clear();
    setWorkspaceSessionActive(false);
    setEmbeddedWorkspace(null);
    setAuthState(null);
    setAuthMode("login");
    setAuthLoading(false);
    setAuthBootstrapping(false);
    setContacts([]);
    setSidebarSection("inbox");
    setActiveContactId(null);
    setMessages([]);
    setMessageSearch("");
    setContactSearch("");
    setHasMoreMessages(false);
    setOldestCursor(null);
    setDraft("");
    setAttachment(null);
    setFailedSend(null);
    setReplyTarget(null);
    setForwardMessage(null);
    setForwardPickerMessage(null);
    setEditingMessageId(null);
    setEditingText("");
    setShowEmojiPicker(false);
    setInvoiceDocuments([]);
    setMemoryCapsules([]);
    setPdfReviewSessions([]);
    setBondStates({});
    setIsWorkspacePanelOpen(false);
    setIsConversationDrawerOpen(false);
    setAuthError(nextError);
    setAuthNotice("");
    setRecoveryCode("");
    setTwoFactorChallenge(null);
    setTwoFactorCode("");
    setTwoFactorSetupCode("");
    setTwoFactorSetupInput("");
  }

  function handleCloseEmbeddedWorkspace() {
    setEmbeddedWorkspace(null);
    setSidebarSection(activeContact ? getContactCategory(activeContact) : "inbox");
  }

  const applyHistorySnapshot = useCallback((snapshot) => {
    if (!snapshot) {
      return;
    }

    appHistoryRestoringRef.current = true;
    stopTyping();
    setShowEmojiPicker(false);
    setReplyTarget(null);
    setForwardMessage(null);
    setForwardPickerMessage(null);
    setEditingMessageId(null);
    setEditingText("");
    setIsActionPanelOpen(false);
    setIsWorkspacePanelOpen(false);

    if (snapshot.kind === "workspace" && snapshot.embeddedWorkspace) {
      setIsConversationDrawerOpen(false);
      setActiveContactId(null);
      setSidebarSection("workspace");
      setEmbeddedWorkspace(snapshot.embeddedWorkspace);
    } else if (snapshot.kind === "conversation" && snapshot.activeContactId) {
      const nextContact = contactsRef.current.find((contact) => contact.id === snapshot.activeContactId);
      setEmbeddedWorkspace(null);
      setActiveContactId(snapshot.activeContactId);
      setSidebarSection(nextContact ? getContactCategory(nextContact) : snapshot.sidebarSection || "inbox");
      setIsConversationDrawerOpen(false);
    } else {
      const nextSidebarSection = normalizeShellSidebarSection(snapshot.sidebarSection);
      setEmbeddedWorkspace(null);
      setActiveContactId(null);
      setSidebarSection(nextSidebarSection);
      setIsConversationDrawerOpen(true);
    }

    window.setTimeout(() => {
      appHistoryRestoringRef.current = false;
    }, 0);
  }, []);

  function handleUpgradeWorkspaceFromDemo() {
    setHasExitedWorkspaceDemo(true);
    setEmbeddedWorkspace((current) => (current ? { ...current, mode: "select", realMode: null } : current));
  }

  function handleSelectWorkspaceRealMode(nextMode) {
    const normalizedMode = normalizeWorkspaceRealMode(nextMode);
    if (!normalizedMode) {
      return;
    }

    const nextView = getWorkspaceViewConfig(normalizedMode);
    setHasExitedWorkspaceDemo(true);
    setWorkspaceRealMode(normalizedMode);
    setSidebarSection("workspace");
    setEmbeddedWorkspace((current) =>
      current
        ? {
            ...current,
            ...nextView,
            mode: workspaceSessionActive ? "real" : "auth",
            realMode: normalizedMode
          }
        : {
            ...nextView,
            mode: workspaceSessionActive ? "real" : "auth",
            realMode: normalizedMode
          }
    );
  }

  async function handleWorkspaceSignIn() {
    if (!authState?.token) {
      return;
    }

    try {
      const payload = await api.getWorkspaces(authState.token);
      const memberships = Array.isArray(payload?.workspaces) ? payload.workspaces : [];
      const derivedMode = authState.user?.isAdmin
        ? "both"
        : deriveWorkspaceRealModeFromMemberships(memberships);

      if (!derivedMode) {
        setWorkspaceSessionActive(false);
        setHasExitedWorkspaceDemo(true);
        setWorkspaceRealMode(null);
        setEmbeddedWorkspace({
          ...getWorkspaceViewConfig("both", "users", "financebot"),
          mode: "no-access",
          realMode: null,
          workspaceScope: "none"
        });
        return;
      }

      setWorkspaceSessionActive(true);
      setWorkspaceRealMode(derivedMode);
      setEmbeddedWorkspace((current) => {
        const preferredNav = authState.user?.isAdmin ? "users" : current?.nav || null;
        const preferredThreadId =
          authState.user?.isAdmin ? "financebot" : current?.threadId || null;

        return {
          ...getWorkspaceViewConfig(
            derivedMode,
            authState.user?.isAdmin ? preferredNav : null,
            authState.user?.isAdmin ? preferredThreadId : null
          ),
          mode: "real",
          realMode: derivedMode,
          preferredWorkspaceUserId: current?.preferredWorkspaceUserId || null
        };
      });
    } catch (error) {
      pushToast({
        title: "Workspace access unavailable",
        body: error.message || "Unable to enter the workspace right now."
      });
    }
  }

  function handleRestoreWorkspaceDemo() {
    setHasExitedWorkspaceDemo(false);
    setWorkspaceSessionActive(false);
    setWorkspaceRealMode(null);
    setEmbeddedWorkspace((current) =>
      current
        ? {
            ...current,
            ...getWorkspaceViewConfig("both"),
            mode: "demo",
            realMode: null
          }
        : current
    );
  }

  function handleWorkspaceLogout() {
    setWorkspaceSessionActive(false);
    handleCloseEmbeddedWorkspace();
  }

  const appHistorySnapshot = useMemo(
    () =>
      buildAppHistorySnapshot({
        activeContactId,
        embeddedWorkspace,
        sidebarSection
      }),
    [activeContactId, embeddedWorkspace, sidebarSection]
  );

  useEffect(() => {
    if (!authState?.token || authBootstrapping) {
      return;
    }

    const stateWithSnapshot = {
      ...(window.history.state || {}),
      [APP_HISTORY_KEY]: appHistorySnapshot
    };
    const snapshotKey = JSON.stringify(appHistorySnapshot);

    if (!appHistoryReadyRef.current) {
      window.history.replaceState(stateWithSnapshot, "", window.location.href);
      appHistoryReadyRef.current = true;
      lastAppHistoryRef.current = snapshotKey;
      return;
    }

    if (appHistoryRestoringRef.current) {
      lastAppHistoryRef.current = snapshotKey;
      return;
    }

    if (lastAppHistoryRef.current === snapshotKey) {
      return;
    }

    window.history.pushState(stateWithSnapshot, "", window.location.href);
    lastAppHistoryRef.current = snapshotKey;
  }, [appHistorySnapshot, authBootstrapping, authState?.token]);

  useEffect(() => {
    function handleAppHistoryPopState(event) {
      const snapshot = event.state?.[APP_HISTORY_KEY];
      if (!snapshot) {
        return;
      }

      lastAppHistoryRef.current = JSON.stringify(snapshot);
      applyHistorySnapshot(snapshot);
    }

    window.addEventListener("popstate", handleAppHistoryPopState);
    return () => {
      window.removeEventListener("popstate", handleAppHistoryPopState);
    };
  }, [applyHistorySnapshot]);

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

  async function refreshPdfReviewSessions(contactId = activeContactRef.current) {
    if (!authState?.token || !contactId) {
      setPdfReviewSessions([]);
      return;
    }

    try {
      const response = await api.getPdfReviewSessions(authState.token, contactId);
      setPdfReviewSessions(sortPdfReviewSessions(response.sessions || []));
    } catch (error) {
      console.error(error);
    }
  }

  async function refreshMemoryCapsules(contactId = activeContactRef.current) {
    if (!authState?.token || !contactId) {
      setMemoryCapsules([]);
      return;
    }

    try {
      const response = await api.getMemoryCapsules(authState.token, contactId);
      setMemoryCapsules(response.capsules || []);
    } catch (error) {
      console.error(error);
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

        const nextVisibleGroups = getVisibleInboxGroups(inboxGroupsRef.current, authState.user.id);
        const nextContacts = sortContacts(
          mergeInboxGroupContacts(mergeContacts(contactsRef.current, users), nextVisibleGroups)
        );

        setContacts(nextContacts);
        setActiveContactId((current) =>
          current ||
          (requestedGroupId && nextContacts.some((contact) => contact.id === requestedGroupId)
            ? requestedGroupId
            : window.innerWidth > 960
              ? nextContacts[0]?.id || null
              : null)
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
  }, [authBootstrapping, authState?.token, authState?.user?.id, requestedGroupId]);

  useEffect(() => {
    if (!authState?.token || !activeContactId) {
      setMessages([]);
      setPdfReviewSessions([]);
      setReplyTarget(null);
      setForwardMessage(null);
      setForwardPickerMessage(null);
      setHasMoreMessages(false);
      setOldestCursor(null);
      return;
    }

    let cancelled = false;
    setMessagesLoading(true);
    setChatError("");

    async function loadMessages() {
      const selectedContact = contactsRef.current.find((contact) => contact.id === activeContactId);

      if (!selectedContact) {
        if (!cancelled) {
          setMessages([]);
          setHasMoreMessages(false);
          setOldestCursor(null);
          setMessagesLoading(false);
        }
        return;
      }

      if (selectedContact?.isGroup) {
        const activeGroup = getVisibleInboxGroups(inboxGroupsRef.current, authState.user.id).find(
          (group) => group.id === activeContactId
        );
        const scopedMessages = messageSearch.trim()
          ? (activeGroup?.messages || []).filter((message) =>
              [message.text || "", message.sender?.name || ""]
                .join(" ")
                .toLowerCase()
                .includes(messageSearch.trim().toLowerCase())
            )
          : activeGroup?.messages || [];

        if (!cancelled) {
          setMessages(scopedMessages);
          setHasMoreMessages(false);
          setOldestCursor(null);
          setMessagesLoading(false);
        }
        return;
      }

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
  }, [activeContactId, authState?.token, authState?.user?.id, inboxGroups, messageSearch]);

  useEffect(() => {
    const selectedContact = contactsRef.current.find((contact) => contact.id === activeContactId);

    if (!authState?.token || !activeContactId || selectedContact?.isGroup) {
      setPdfReviewSessions([]);
      setMemoryCapsules([]);
      return;
    }

    void refreshPdfReviewSessions(activeContactId);
    void refreshMemoryCapsules(activeContactId);
  }, [activeContactId, authState?.token]);

  useEffect(() => {
    const selectedContact = contactsRef.current.find((contact) => contact.id === activeContactId);

    if (!socketRef.current || !activeContactId || selectedContact?.isGroup) {
      return;
    }

    socketRef.current.emit("bond:sync-request", {
      contactId: activeContactId
    });
  }, [activeContactId, authState?.token]);

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

    socket.on("connect", () => {
      const selectedContact = contactsRef.current.find((contact) => contact.id === activeContactRef.current);
      if (activeContactRef.current && !selectedContact?.isGroup) {
        socket.emit("bond:sync-request", {
          contactId: activeContactRef.current
        });
      }
    });

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

    socket.on("pdf-review:changed", ({ action, contactId, fileName, status, title }) => {
      if (contactId && activeContactRef.current === contactId) {
        void refreshPdfReviewSessions(contactId);
      }

      if (action === "created") {
        pushToast({
          title: "PDF review update",
          body: `${title || fileName} is ready for shared review.`
        });
      }

      if (action === "accepted") {
        pushToast({
          title: "PDF review accepted",
          body: `${title || fileName} is now open for live review.`
        });
      }

      if (action === "declined") {
        pushToast({
          title: "PDF review declined",
          body: `${title || fileName} was declined.`
        });
      }

      if (action === "completed") {
        pushToast({
          title: "PDF review ended",
          body: `${title || fileName} was cleared and moved into review history.`
        });
      }
    });

    socket.on("memory-capsule:changed", ({ action, contactId, title, state }) => {
      if (contactId && activeContactRef.current === contactId) {
        void refreshMemoryCapsules(contactId);
      }

      if (action === "created") {
        pushToast({
          title: "Memory capsule sealed",
          body: `${title} was added to this conversation.`
        });
      }

      if (action === "open-requested") {
        pushToast({
          title: "Capsule opening request",
          body: `${title} is waiting for both sides to open it together.`
        });
      }

      if (action === "opened") {
        pushToast({
          title: "Capsule opened",
          body: `${title} is open now.`
        });
      }

      if (action === "reacted" || action === "replied") {
        pushToast({
          title: "Capsule updated",
          body: `${title} has new activity.`
        });
      }

      if (action === "deleted") {
        pushToast({
          title: "Capsule removed",
          body: `${title} was deleted.`
        });
      }
    });

    socket.on("bond:state", ({ contactId, state }) => {
      if (!contactId) {
        return;
      }

      setBondStates((current) => ({
        ...current,
        [contactId]: {
          ...createEmptyBondState(),
          ...state
        }
      }));
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

      const selectedContact = contactsRef.current.find((contact) => contact.id === activeContactRef.current);
      if (document.visibilityState === "visible" && activeContactRef.current && !selectedContact?.isGroup) {
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
  const activeBondState = activeContact
    ? {
        ...createEmptyBondState(),
        ...(bondStates[activeContact.id] || {})
      }
    : createEmptyBondState();
  const inboxForwardContacts = useMemo(
    () =>
      contacts.filter(
        (contact) =>
          getContactCategory(contact) === "inbox" &&
          !contact.isGroup &&
          !contact.isSelf &&
          contact.requestState === "accepted"
      ),
    [contacts]
  );
  const showCompactBackButton =
    isCompactConversationMode &&
    Boolean(activeContact) &&
    getContactCategory(activeContact) === "inbox";

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
      setContactSearch("");
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
    if (
      !authState?.token ||
      !activeContactId ||
      !hasMoreMessages ||
      !oldestCursor ||
      contactsRef.current.find((contact) => contact.id === activeContactId)?.isGroup
    ) {
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

  function updateInboxGroup(groupId, updater) {
    const targetGroup = inboxGroupsRef.current.find((group) => group.id === groupId);
    if (!targetGroup) {
      return null;
    }

    const updatedGroup = filterInboxGroupMessages(updater(targetGroup));
    const nextGroups = upsertInboxGroup(inboxGroupsRef.current, updatedGroup);
    persistInboxGroups(nextGroups);
    mirrorInboxGroupToProjectState(updatedGroup);
    return updatedGroup;
  }

  function buildLocalGroupMessage(group, payload) {
    const baseMessage = {
      id: crypto.randomUUID(),
      text: payload.text || "",
      attachment: payload.attachment || null,
      isSnap: Boolean(payload.isSnap),
      snapOpenedAt: null,
      snapViewSeconds: payload.isSnap ? Math.min(Math.max(payload.autoDeleteSeconds || 10, 1), 60) : 0,
      createdAt: new Date().toISOString(),
      editedAt: null,
      deletedAt: null,
      autoDeleteAt: payload.isSnap
        ? null
        : payload.autoDeleteSeconds > 0
          ? new Date(Date.now() + payload.autoDeleteSeconds * 1000).toISOString()
          : null,
      seenAt: new Date().toISOString(),
      sender: {
        id: authState.user.id,
        name: authState.user.name,
        avatarUrl: authState.user.avatarUrl || ""
      },
      recipient: {
        id: group.id,
        name: group.name
      },
      reactions: []
    };

    if (payload.replyToMessage) {
      baseMessage.replyTo = {
        id: payload.replyToMessage.id,
        senderName: payload.replyToMessage.sender?.name || payload.replyToMessage.senderName || "Unknown",
        text: payload.replyToMessage.text || "",
        attachmentName: payload.replyToMessage.attachment?.name || null
      };
    }

    if (payload.forwardedMessage) {
      baseMessage.forwardedFrom = {
        id: payload.forwardedMessage.sender?.id || null,
        name: payload.forwardedMessage.sender?.name || "Forwarded message"
      };
    }

    return baseMessage;
  }

  async function sendLocalGroupPayload(groupId, payload) {
    const group = inboxGroupsRef.current.find((entry) => entry.id === groupId);
    if (!group) {
      throw new Error("Inbox group could not be found.");
    }

    const nextMessage = buildLocalGroupMessage(group, payload);
    const updatedGroup = updateInboxGroup(groupId, (currentGroup) => ({
      ...currentGroup,
      updatedAt: nextMessage.createdAt,
      messages: [...currentGroup.messages, nextMessage]
    }));

    if (updatedGroup) {
      setMessages(updatedGroup.messages);
      updateContactState(groupId, (contact) => ({
        ...contact,
        lastMessage: nextMessage,
        lastActiveAt: nextMessage.createdAt
      }));
    }

    setFailedSend(null);
  }

  function updateLocalGroupMessage(messageId, updater) {
    const groupId = activeContactRef.current;
    const selectedContact = contactsRef.current.find((contact) => contact.id === groupId);
    if (!groupId || !selectedContact?.isGroup) {
      return null;
    }

    return updateInboxGroup(groupId, (currentGroup) => ({
      ...currentGroup,
      updatedAt: new Date().toISOString(),
      messages: currentGroup.messages.map((message) =>
        message.id === messageId ? updater(message) : message
      )
    }));
  }

  async function handleOpenSnap(message) {
    if (!message?.isSnap) {
      return message;
    }

    const selectedContact = contactsRef.current.find((contact) => contact.id === activeContactRef.current);

    if (selectedContact?.isGroup) {
      const shouldStartExpiry =
        message.sender.id !== authState.user.id &&
        !message.autoDeleteAt;

      if (!shouldStartExpiry) {
        return message;
      }

      const openedAt = new Date().toISOString();
      const seconds =
        typeof message.snapViewSeconds === "number" ? message.snapViewSeconds : 10;
      const normalizedSeconds =
        seconds <= 0 ? 0 : Math.min(Math.max(seconds, 1), 60);
      const updatedGroup = updateLocalGroupMessage(message.id, (currentMessage) => ({
        ...currentMessage,
        snapOpenedAt: currentMessage.snapOpenedAt || openedAt,
        autoDeleteAt:
          currentMessage.autoDeleteAt ||
          (normalizedSeconds > 0
            ? new Date(Date.now() + normalizedSeconds * 1000).toISOString()
            : null)
      }));

      if (updatedGroup) {
        setMessages(updatedGroup.messages);
        const lastMessage = updatedGroup.messages[updatedGroup.messages.length - 1] || null;
        updateContactState(selectedContact.id, (contact) => ({
          ...contact,
          lastMessage,
          lastActiveAt: lastMessage?.createdAt || contact.lastActiveAt
        }));
      }

      const updatedMessage = updatedGroup?.messages.find((entry) => entry.id === message.id);
      return updatedMessage || message;
    }

    if (message.sender.id === authState.user.id || message.autoDeleteAt) {
      return message;
    }

    const updatedMessage = await api.openSnap(authState.token, message.id);
    setMessages((current) => upsertMessage(current, updatedMessage));
    applyMessageToContacts(updatedMessage);
    return updatedMessage;
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

  async function prepareAttachment(file, options = {}) {
    const isSnap = Boolean(options.isSnap);
    const maxSize = isSnap ? 8 * 1024 * 1024 : 1024 * 1024;
    const fileName =
      file.name ||
      `attachment-${Date.now()}${
        file.type === "image/jpeg"
          ? ".jpg"
          : file.type === "video/webm"
            ? ".webm"
            : file.type?.startsWith("image/")
              ? ".png"
              : ""
      }`;

    if (isSnap && !file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      throw new Error("Snaps support photo or video.");
    }

    if (!isSnap && file.size > maxSize) {
      throw new Error("Attachments must be 1 MB or smaller.");
    }

    const dataUrl = file.type.startsWith("image/")
      ? await compressImageFile(file)
      : await readFileAsDataUrl(file);
    const base64Payload = typeof dataUrl === "string" ? dataUrl.split(",")[1] || "" : "";
    const nextSize = Math.round((base64Payload.length * 3) / 4);

    if (nextSize > maxSize) {
      throw new Error(
        isSnap ? "Snaps must be 8 MB or smaller." : "Attachments must be 1 MB or smaller."
      );
    }

    return {
      dataUrl,
      mimeType: file.type || "application/octet-stream",
      name: fileName,
      size: nextSize,
      isSnap,
      autoDeleteSeconds:
        isSnap
          ? typeof file.snapViewSeconds === "number"
            ? file.snapViewSeconds
            : 10
          : 0
    };
  }

  async function handleAttachmentSelect(file, options = {}) {
    try {
      setAttachment(await prepareAttachment(file, options));
    } catch (error) {
      pushToast({
        title: options.isSnap ? "Snap failed" : "Attachment failed",
        body: error.message
      });
    }
  }

  async function handleSendSnapFile(file) {
    if (!authState?.token || !activeContactId || isComposerLocked(activeContact)) {
      return false;
    }

    try {
      const isSnapPayload =
        file &&
        typeof file === "object" &&
        file.type === "snap" &&
        typeof file.mediaUrl === "string";
      const snapAttachment = isSnapPayload
        ? {
            dataUrl: file.mediaUrl,
            mimeType: file.mimeType || "image/jpeg",
            name:
              file.fileName ||
              `snap-${Date.now()}${
                file.mimeType?.startsWith("video/") ? ".webm" : ".jpg"
              }`,
            size:
              typeof file.size === "number"
                ? file.size
                : Math.round(((file.mediaUrl.split(",")[1] || "").length * 3) / 4),
            isSnap: true,
            autoDeleteSeconds: Math.max(1, Math.min(10, file.duration || 10))
          }
        : await prepareAttachment(file, { isSnap: true });
      await sendPayload(activeContactId, {
        text: isSnapPayload ? file.caption || "" : "",
        attachment: snapAttachment,
        isSnap: true,
        autoDeleteSeconds: snapAttachment.autoDeleteSeconds,
        replyToId: null,
        forwardMessageId: null,
        replyToMessage: null,
        forwardedMessage: null
      });
      return true;
    } catch (error) {
      pushToast({
        title: "Snap failed",
        body: error.message
      });
      return false;
    }
  }

  async function handleSendVoiceMessage(file) {
    if (!authState?.token || !activeContactId || isComposerLocked(activeContact)) {
      return false;
    }

    try {
      const voiceAttachment = await prepareAttachment(file);
      await sendPayload(activeContactId, {
        text: "",
        attachment: voiceAttachment,
        isSnap: false,
        autoDeleteSeconds: 0,
        replyToId: null,
        forwardMessageId: null,
        replyToMessage: null,
        forwardedMessage: null
      });
      return true;
    } catch (error) {
      pushToast({
        title: "Voice message failed",
        body: error.message
      });
      return false;
    }
  }

  async function sendPayload(contactId, payload) {
    const selectedContact = contactsRef.current.find((contact) => contact.id === contactId);
    if (selectedContact?.isGroup) {
      await sendLocalGroupPayload(contactId, payload);
      return;
    }

    const message = await api.sendMessage(authState.token, contactId, {
      text: payload.text,
      attachment: payload.attachment,
      replyToId: payload.replyToId,
      forwardMessageId: payload.forwardMessageId,
      autoDeleteSeconds: payload.autoDeleteSeconds || 0,
      isSnap: Boolean(payload.isSnap)
    });
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
      isSnap: Boolean(attachment?.isSnap),
      autoDeleteSeconds: attachment?.isSnap ? attachment.autoDeleteSeconds || 10 : 0,
      replyToId: replyTarget?.id || null,
      forwardMessageId: forwardMessage?.id || null,
      replyToMessage: replyTarget || null,
      forwardedMessage: forwardMessage || null
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
    setForwardPickerMessage(null);

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

  function handleSaveInvoiceDocument(nextDocument) {
    if (!activeContact) {
      return;
    }

    const totals = calculateInvoiceTotals(nextDocument);
    const now = new Date().toISOString();
    const savedDocument = {
      ...nextDocument,
      id: nextDocument.id || `invoice-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
      contactId: activeContact.id,
      contactName: activeContact.displayName || activeContact.name,
      status: nextDocument.status || "draft",
      lineItems: totals.lineItems,
      subtotal: totals.subtotal,
      total: totals.total,
      createdAt: nextDocument.createdAt || now,
      updatedAt: now
    };

    setInvoiceDocuments((current) => {
      const next = current.filter((entry) => entry.id !== savedDocument.id);
      next.unshift(savedDocument);
      return sortInvoices(next);
    });

    pushToast({
      title: `${savedDocument.type === "invoice" ? "Invoice" : "Quotation"} saved`,
      body: `${savedDocument.title || savedDocument.docNumber || "Document"} is now linked to this conversation.`
    });
  }

  function handleUpdateInvoiceStatus(documentId, status) {
    setInvoiceDocuments((current) =>
      sortInvoices(
        current.map((entry) =>
          entry.id === documentId
            ? {
                ...entry,
                status,
                updatedAt: new Date().toISOString()
              }
            : entry
        )
      )
    );
  }

  function handleDeleteInvoiceDocument(documentId) {
    setInvoiceDocuments((current) => current.filter((entry) => entry.id !== documentId));
    pushToast({
      title: "Document removed",
      body: "The saved invoice or quotation was deleted."
    });
  }

  function handleDeleteCalendarEvent(eventId) {
    setCalendarEvents((current) => current.filter((entry) => entry.id !== eventId));
  }

  async function handleSaveMemoryCapsule(nextCapsule) {
    if (!authState?.token || !activeContactId || !activeContact) {
      return;
    }

    const unlockAt = `${nextCapsule.unlockDate}T${nextCapsule.unlockTime || "00:00"}:00.000Z`;
    const payload = {
      title: nextCapsule.title,
      note: nextCapsule.note,
      tone: nextCapsule.tone,
      openMode: nextCapsule.openMode,
      privacyMode: nextCapsule.privacyMode,
      retentionMode: nextCapsule.retentionMode,
      unlockAt,
      attachment: nextCapsule.attachment || null,
      linkUrl: nextCapsule.linkUrl || ""
    };

    const response = nextCapsule.id
      ? await api.updateMemoryCapsule(authState.token, nextCapsule.id, {
          action: "edit",
          ...payload
        })
      : await api.createMemoryCapsule(authState.token, activeContactId, payload);

    setMemoryCapsules((current) => upsertMemoryCapsule(current, response.capsule));
    pushToast({
      title: nextCapsule.id ? "Capsule updated" : "Capsule sealed",
      body: `${response.capsule.title || "Memory capsule"} is stored for ${activeContact.displayName || activeContact.name}.`
    });
  }

  async function handleOpenMemoryCapsule(capsuleId) {
    if (!authState?.token) {
      return;
    }

    const response = await api.updateMemoryCapsule(authState.token, capsuleId, {
      action: "open"
    });
    setMemoryCapsules((current) => upsertMemoryCapsule(current, response.capsule));
  }

  async function handleDeleteMemoryCapsule(capsuleId) {
    if (!authState?.token) {
      return;
    }

    await api.updateMemoryCapsule(authState.token, capsuleId, {
      action: "delete"
    });
    setMemoryCapsules((current) => current.filter((entry) => entry.id !== capsuleId));
  }

  async function handleReactMemoryCapsule(capsuleId, emoji) {
    if (!authState?.token) {
      return;
    }

    const response = await api.updateMemoryCapsule(authState.token, capsuleId, {
      action: "react",
      emoji
    });
    setMemoryCapsules((current) => upsertMemoryCapsule(current, response.capsule));
  }

  async function handleReplyMemoryCapsule(capsuleId, text) {
    if (!authState?.token) {
      return;
    }

    const response = await api.updateMemoryCapsule(authState.token, capsuleId, {
      action: "reply",
      text
    });
    setMemoryCapsules((current) => upsertMemoryCapsule(current, response.capsule));
  }

  async function handleCreatePdfReviewSession({ file, title, note }) {
    if (!authState?.token || !activeContactId || !file) {
      return;
    }

    if (file.size > 100 * 1024 * 1024) {
      throw new Error("PDF review files must be 100 MB or smaller.");
    }

    const dataUrl = await readFileAsDataUrl(file);
    const response = await api.createPdfReviewSession(authState.token, activeContactId, {
      title,
      note,
      file: {
        dataUrl,
        mimeType: file.type || "application/pdf",
        name: file.name,
        size: file.size
      }
    });

    setPdfReviewSessions((current) => upsertPdfReviewSession(current, response.session));
    pushToast({
      title: "Review request sent",
      body: `${file.name} is waiting for ${activeContact?.displayName || activeContact?.name || "the other user"} to accept.`
    });
  }

  async function handleRespondPdfReviewSession(sessionId, decision) {
    if (!authState?.token || !sessionId) {
      return;
    }

    const response = await api.respondPdfReviewSession(authState.token, sessionId, decision);
    setPdfReviewSessions((current) => upsertPdfReviewSession(current, response.session));
  }

  async function handleUpdatePdfReviewSession(sessionId, payload, options = {}) {
    if (!authState?.token || !sessionId) {
      return;
    }

    const response = await api.updatePdfReviewSession(authState.token, sessionId, payload);
    setPdfReviewSessions((current) => upsertPdfReviewSession(current, response.session));

    if (!options.silent && payload.status === "completed") {
      pushToast({
        title: "Review session ended",
        body: `${response.session.file.name} moved into compact history.`
      });
    }
  }

  async function handleToggleReaction(messageId, emoji) {
    if (activeContact?.isGroup) {
      const updatedGroup = updateLocalGroupMessage(messageId, (message) => {
        const existingReaction = message.reactions.find((reaction) => reaction.emoji === emoji);

        if (!existingReaction) {
          return {
            ...message,
            reactions: [...message.reactions, { emoji, users: [authState.user.id] }]
          };
        }

        const hasUser = existingReaction.users.includes(authState.user.id);
        const nextReactions = message.reactions
          .map((reaction) =>
            reaction.emoji === emoji
              ? {
                  ...reaction,
                  users: hasUser
                    ? reaction.users.filter((userId) => userId !== authState.user.id)
                    : [...reaction.users, authState.user.id]
                }
              : reaction
          )
          .filter((reaction) => reaction.users.length);

        return {
          ...message,
          reactions: nextReactions
        };
      });

      if (updatedGroup) {
        setMessages(updatedGroup.messages);
      }
      return;
    }

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
    if (activeContact?.isGroup) {
      const updatedGroup = updateLocalGroupMessage(messageId, (message) => ({
        ...message,
        text: editingText.trim(),
        editedAt: new Date().toISOString()
      }));
      if (updatedGroup) {
        setMessages(updatedGroup.messages);
      }
      setEditingMessageId(null);
      setEditingText("");
      return;
    }

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
    if (activeContact?.isGroup) {
      const updatedGroup = updateLocalGroupMessage(messageId, (message) => ({
        ...message,
        text: "",
        deletedAt: new Date().toISOString(),
        attachment: null,
        linkPreview: null,
        replyTo: null,
        forwardedFrom: null
      }));
      if (updatedGroup) {
        setMessages(updatedGroup.messages);
        const lastMessage = updatedGroup.messages[updatedGroup.messages.length - 1] || null;
        updateContactState(updatedGroup.id, (contact) => ({
          ...contact,
          lastMessage,
          lastActiveAt: lastMessage?.createdAt || contact.lastActiveAt
        }));
      }
      return;
    }

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
    if (activeContact?.isGroup) {
      pushToast({
        title: "Saved locally",
        body: "Starred state is not shown for project inbox groups yet."
      });
      return;
    }

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
    if (activeContact?.isGroup) {
      const groupId = activeContact.id;
      const updatedGroup = updateInboxGroup(groupId, (group) => {
        const pinnedMessageIds = group.pinnedMessageIds.includes(messageId)
          ? group.pinnedMessageIds.filter((id) => id !== messageId)
          : [...group.pinnedMessageIds, messageId];

        return {
          ...group,
          pinnedMessageIds
        };
      });

      if (updatedGroup) {
        updateContactState(groupId, (contact) => ({
          ...contact,
          pinnedMessageIds: updatedGroup.pinnedMessageIds
        }));
      }
      return;
    }

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
    if (activeContact?.isGroup) {
      const groupId = activeContact.id;
      const updatedGroup = updateInboxGroup(groupId, (group) => ({
        ...group,
        [key]: !group[key]
      }));

      if (updatedGroup) {
        updateContactState(groupId, (contact) => ({
          ...contact,
          [key]: updatedGroup[key]
        }));
      }
      return;
    }

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

  async function handleToggleMute(setting) {
    if (!activeContact) {
      return;
    }

    const option =
      setting && typeof setting === "object" && !("preventDefault" in setting)
        ? setting
        : { mode: "toggle" };

    const isCurrentlyMuted = Boolean(
      activeContact.isMuted &&
        (activeContact.muteDisabledForever ||
          !activeContact.muteUntil ||
          new Date(activeContact.muteUntil).getTime() > Date.now())
    );

    let nextState;
    if (option.mode === "hours") {
      nextState = {
        isMuted: true,
        muteUntil: new Date(Date.now() + option.hours * 60 * 60 * 1000).toISOString(),
        muteDisabledForever: false
      };
    } else if (option.mode === "forever") {
      nextState = {
        isMuted: true,
        muteUntil: null,
        muteDisabledForever: true
      };
    } else if (option.mode === "on") {
      nextState = {
        isMuted: false,
        muteUntil: null,
        muteDisabledForever: false
      };
    } else {
      nextState = isCurrentlyMuted
        ? {
            isMuted: false,
            muteUntil: null,
            muteDisabledForever: false
          }
        : {
            isMuted: true,
            muteUntil: null,
            muteDisabledForever: true
          };
    }

    if (activeContact?.isGroup) {
      const groupId = activeContact.id;
      const updatedGroup = updateInboxGroup(groupId, (group) => ({
        ...group,
        ...nextState
      }));

      if (updatedGroup) {
        updateContactState(groupId, (contact) => ({
          ...contact,
          ...nextState
        }));
      }
      return;
    }

    if (!authState?.token) {
      updateContactState(activeContact.id, (contact) => ({
        ...contact,
        ...nextState
      }));
      return;
    }

    try {
      const response = await api.updatePreferences(authState.token, activeContact.id, {
        isMuted: nextState.isMuted
      });
      mergeSingleContact({
        ...response,
        muteUntil: nextState.muteUntil,
        muteDisabledForever: nextState.muteDisabledForever
      });
    } catch (error) {
      pushToast({
        title: "Update failed",
        body: error.message
      });
    }
  }

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const expiredContacts = contactsRef.current.filter(
        (contact) =>
          contact.isMuted &&
          contact.muteUntil &&
          new Date(contact.muteUntil).getTime() <= Date.now()
      );

      expiredContacts.forEach((contact) => {
        if (contact.isGroup) {
          updateInboxGroup(contact.id, (group) => ({
            ...group,
            isMuted: false,
            muteUntil: null,
            muteDisabledForever: false
          }));
        }

        updateContactState(contact.id, (current) => ({
          ...current,
          isMuted: false,
          muteUntil: null,
          muteDisabledForever: false
        }));

        if (authState?.token && !contact.isGroup) {
          api
            .updatePreferences(authState.token, contact.id, { isMuted: false })
            .then((response) => {
              mergeSingleContact({
                ...response,
                muteUntil: null,
                muteDisabledForever: false
              });
            })
            .catch(() => {});
        }
      });
    }, 30000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [authState?.token]);

  async function handleSetNickname() {
    if (!activeContact) {
      return;
    }

    const nextNickname = window.prompt("Set nickname", activeContact.nickname || "") ?? null;
    if (nextNickname === null) {
      return;
    }

    if (activeContact.isGroup) {
      const updatedGroup = updateInboxGroup(activeContact.id, (group) => ({
        ...group,
        nickname: nextNickname
      }));

      if (updatedGroup) {
        updateContactState(activeContact.id, (contact) => ({
          ...contact,
          nickname: updatedGroup.nickname,
          displayName: updatedGroup.nickname || updatedGroup.name
        }));
      }
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

    if (activeContact.isGroup) {
      const labels = nextValue
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const updatedGroup = updateInboxGroup(activeContact.id, (group) => ({
        ...group,
        labels
      }));

      if (updatedGroup) {
        updateContactState(activeContact.id, (contact) => ({
          ...contact,
          labels: updatedGroup.labels
        }));
      }
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
    if (activeContact?.isGroup) {
      const updatedGroup = updateInboxGroup(activeContact.id, (group) => ({
        ...group,
        ...payload
      }));

      if (updatedGroup) {
        updateContactState(activeContact.id, (contact) => ({
          ...contact,
          ...payload
        }));
        setSidebarSection(options.section || "inbox");
      }

      if (options.toastTitle) {
        pushToast({
          title: options.toastTitle,
          body: options.toastBody || `${activeContact.name} was updated.`
        });
      }
      return;
    }

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
    if (activeContact?.isGroup) {
      const group = inboxGroupsRef.current.find((entry) => entry.id === activeContact.id);
      if (!group) {
        return;
      }

      const blob = new Blob([JSON.stringify(group, null, 2)], {
        type: "application/json"
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${(activeContact.displayName || activeContact.name).replace(/\s+/g, "-").toLowerCase()}-group.json`;
      link.click();
      URL.revokeObjectURL(url);
      return;
    }

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
      await removeCurrentPushSubscription(authState.token).catch(() => null);
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
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);

      if (permission === "granted") {
        await ensurePushSubscription();
        pushToast({
          title: "Notifications enabled",
          body: "Push notifications are now active, even when the app is closed."
        });
      }
    } catch (error) {
      pushToast({
        title: "Notifications failed",
        body: error.message || "Push notifications could not be enabled."
      });
    }
  }

  function handleSelectContact(contactId) {
    if (contactId === activeContactId) {
      if (isCompactConversationMode) {
        setIsConversationDrawerOpen(false);
      }
      return;
    }

    openConversation(contactId);
  }

  function openConversation(contactId, { stagedForwardMessage = null } = {}) {
    const nextContact = contactsRef.current.find((contact) => contact.id === contactId);
    stopTyping();
    setEmbeddedWorkspace(null);
    setActiveContactId(contactId);
    if (nextContact) {
      setSidebarSection(getContactCategory(nextContact));
    }
    setDraft("");
    setAttachment(null);
    setFailedSend(null);
    setReplyTarget(null);
    setForwardMessage(stagedForwardMessage);
    setForwardPickerMessage(null);
    setEditingMessageId(null);
    setEditingText("");
    setShowEmojiPicker(false);
    setIsWorkspacePanelOpen(false);
    setIsConversationDrawerOpen(false);
  }

  function handleRequestForwardMessage(message) {
    setReplyTarget(null);
    setForwardMessage(null);
    setForwardPickerMessage(message);
    setShowEmojiPicker(false);
  }

  function handleForwardMessageToContact(contactId) {
    if (!forwardPickerMessage) {
      return;
    }

    openConversation(contactId, { stagedForwardMessage: forwardPickerMessage });
  }

  function handleBackToContacts() {
    stopTyping();
    setActiveContactId(null);
    setIsConversationDrawerOpen(true);
    setShowEmojiPicker(false);
    setReplyTarget(null);
    setForwardMessage(null);
    setForwardPickerMessage(null);
    setEditingMessageId(null);
    setEditingText("");
  }

  function handleCloseWorkspacePanel() {
    setIsWorkspacePanelOpen(false);

    if (isCompactConversationMode && !activeContactId) {
      setIsConversationDrawerOpen(true);
    }
  }

  function handleOpenWorkspacePanel() {
    if (isCompactConversationMode) {
      setIsConversationDrawerOpen(false);
    }

    setIsWorkspacePanelOpen(true);
  }

  function handleToggleWorkspacePanel() {
    if (isWorkspacePanelOpen) {
      handleCloseWorkspacePanel();
      return;
    }

    handleOpenWorkspacePanel();
  }

  function handleToggleTheme() {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }

  const handleConversationBackLayerChange = useCallback(({ active, handleBack }) => {
    setHasConversationBackLayer(Boolean(active));
    conversationBackHandlerRef.current = active ? handleBack : null;
  }, []);

  const handleAppBackLayer = useCallback(() => {
    if (isActionPanelOpen && !showDockedActionPanel) {
      setIsActionPanelOpen(false);
      return true;
    }

    if (isWorkspacePanelOpen) {
      handleCloseWorkspacePanel();
      return true;
    }

    if (showEmojiPicker) {
      setShowEmojiPicker(false);
      return true;
    }

    if (forwardPickerMessage) {
      setForwardPickerMessage(null);
      return true;
    }

    if (forwardMessage) {
      setForwardMessage(null);
      return true;
    }

    if (replyTarget) {
      setReplyTarget(null);
      return true;
    }

    if (editingMessageId) {
      setEditingMessageId(null);
      setEditingText("");
      return true;
    }

    if (isCompactConversationMode && isConversationDrawerOpen) {
      setIsConversationDrawerOpen(false);
      return true;
    }

    return false;
  }, [
    editingMessageId,
    forwardMessage,
    forwardPickerMessage,
    handleCloseWorkspacePanel,
    isActionPanelOpen,
    isCompactConversationMode,
    isConversationDrawerOpen,
    isWorkspacePanelOpen,
    replyTarget,
    showCompactBackButton,
    showDockedActionPanel,
    showEmojiPicker
  ]);

  const hasAppBackLayer = Boolean(
    (isActionPanelOpen && !showDockedActionPanel) ||
      isWorkspacePanelOpen ||
      showEmojiPicker ||
      forwardPickerMessage ||
      forwardMessage ||
      replyTarget ||
      editingMessageId ||
      (isCompactConversationMode && isConversationDrawerOpen)
  );

  useHistoryBackLayer(hasConversationBackLayer || hasAppBackLayer, () => {
    if (conversationBackHandlerRef.current?.()) {
      return;
    }

    handleAppBackLayer();
  });

  function handleCalendarEventsChange(nextValue) {
    setCalendarEvents((current) =>
      typeof nextValue === "function" ? sortCalendarEvents(nextValue(current)) : sortCalendarEvents(nextValue)
    );
  }

  function handleCreatePlannerItemFromMessage(message, kind) {
    if (!activeContact) {
      return;
    }

    const suggestedDate =
      kind === "task"
        ? new Date().toISOString().slice(0, 10)
        : new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const chosenDate =
      window.prompt(
        kind === "task"
          ? "Enter a date for this task (YYYY-MM-DD)"
          : "Enter a date for this meeting (YYYY-MM-DD)",
        suggestedDate
      )?.trim() || "";

    if (!chosenDate) {
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(chosenDate)) {
      pushToast({
        title: "Invalid date",
        body: "Use the format YYYY-MM-DD."
      });
      return;
    }

    const nextItem = createPlannerItemFromMessage({
      message,
      contact: activeContact,
      kind,
      date: chosenDate
    });

    handleCalendarEventsChange((current) => [...current, nextItem]);
    pushToast({
      title: kind === "task" ? "Task created" : "Event created",
      body: `${nextItem.title} was added to the calendar.`
    });
  }

  function handleUpdateCalendarEventStatus(eventId, status) {
    handleCalendarEventsChange((current) =>
      current.map((event) => (event.id === eventId ? { ...event, status } : event))
    );
  }

  function emitBondEvent(eventName) {
    if (!socketRef.current || !activeContactId || !activeContact || activeContact.isSelf) {
      return;
    }

    socketRef.current.emit(eventName, {
      contactId: activeContactId
    });
  }

  async function ensurePushSubscription(token = authState?.token) {
    if (
      !token ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window) ||
      Notification.permission !== "granted"
    ) {
      return false;
    }

    const registration = await navigator.serviceWorker.register("/push-sw.js");
    const config = await api.getPushConfig(token);
    const publicKey = urlBase64ToUint8Array(config.publicKey);
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey
      });
    }

    await api.savePushSubscription(token, subscription.toJSON());
    return true;
  }

  async function removeCurrentPushSubscription(token = authState?.token) {
    if (!token || !("serviceWorker" in navigator)) {
      return;
    }

    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();

    if (!subscription) {
      return;
    }

    await api.removePushSubscription(token, subscription.endpoint);
    await subscription.unsubscribe();
  }

  useEffect(() => {
    memoryCapsules.forEach((capsule) => {
      if (!capsule.isReminderWindow || capsule.state === "opened") {
        return;
      }

      if (remindedCapsulesRef.current.has(capsule.id)) {
        return;
      }

      remindedCapsulesRef.current.add(capsule.id);
      pushToast({
        title: "Capsule opening soon",
        body: `${capsule.title || "Memory capsule"} is close to opening.`
      });
    });
  }, [memoryCapsules]);

  useEffect(() => {
    if (!authState?.token || notificationPermission !== "granted") {
      return;
    }

    void ensurePushSubscription(authState.token).catch((error) => {
      console.error(error);
    });
  }, [authState?.token, notificationPermission]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const authScrollView = authBootstrapping || !authState?.token || !authState?.user;
    const root = document.getElementById("root");

    document.documentElement.classList.toggle("auth-scroll-view", authScrollView);
    document.body.classList.toggle("auth-scroll-view", authScrollView);
    root?.classList.toggle("auth-scroll-view", authScrollView);

    return () => {
      document.documentElement.classList.remove("auth-scroll-view");
      document.body.classList.remove("auth-scroll-view");
      root?.classList.remove("auth-scroll-view");
    };
  }, [authBootstrapping, authState?.token, authState?.user]);

  if (authBootstrapping) {
    return (
      <>
        <div className="auth-shell auth-shell-glass">
          <FloatingGlassOrbs />
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
        <div
          className={`app-frame ${activeContact ? "mobile-chat-open" : ""} ${effectiveRailCollapsed ? "rail-collapsed" : ""} ${isWorkspacePanelOpen ? "workspace-panel-open" : ""} ${isCompactRail ? "compact-rail-mode" : ""} ${isHiddenRail ? "hidden-rail-mode" : ""} ${isConversationDrawerOpen ? "conversation-drawer-open" : ""} ${showDockedActionPanel && actionPanelDock ? "action-panel-expanded" : ""}`}
        >
          <button
            className={`workspace-panel-backdrop ${isWorkspacePanelOpen ? "is-visible" : ""}`}
            type="button"
            aria-label="Close workspace navigation"
            onClick={handleCloseWorkspacePanel}
          />
          <button
            className={`conversation-drawer-backdrop ${isConversationDrawerOpen && activeContact ? "is-visible" : ""}`}
            type="button"
            aria-label="Close friends list"
            onClick={() => setIsConversationDrawerOpen(false)}
          />
          {embeddedWorkspace ? (
            <div className="embedded-workspace-shell" style={{ gridColumn: "1 / -1" }}>
              {embeddedWorkspace.mode === "select" ? (
                <WorkspaceModeSelectionScreen
                  currentUser={authState.user}
                  onClose={handleCloseEmbeddedWorkspace}
                  onSelectMode={handleSelectWorkspaceRealMode}
                  onUseDemo={handleRestoreWorkspaceDemo}
                />
              ) : embeddedWorkspace.mode === "no-access" ? (
                <WorkspaceNoAccessScreen
                  currentUser={authState.user}
                  onClose={handleCloseEmbeddedWorkspace}
                  onLogout={() => clearAuthState()}
                />
              ) : embeddedWorkspace.mode === "auth" ? (
                <WorkspaceAccessScreen
                  moduleLabel={getWorkspaceModuleLabel(embeddedWorkspace.realMode)}
                  currentUser={authState.user}
                  onClose={handleCloseEmbeddedWorkspace}
                  onSignIn={handleWorkspaceSignIn}
                  onUseDemo={handleRestoreWorkspaceDemo}
                />
              ) : (
                <WorkspaceMessenger
                  embedded
                  initialNav={embeddedWorkspace.nav}
                  initialThreadId={embeddedWorkspace.threadId}
                  onCloseWorkspace={handleCloseEmbeddedWorkspace}
                  onUpgradeToRealWorkspace={embeddedWorkspace.mode === "demo" ? handleUpgradeWorkspaceFromDemo : null}
                  onWorkspaceLogout={embeddedWorkspace.mode === "real" ? handleWorkspaceLogout : null}
                  userRole={getBusinessWorkspaceRole()}
                  workspaceMode={embeddedWorkspace.mode}
                  workspaceScope={embeddedWorkspace.workspaceScope}
                  authToken={embeddedWorkspace.mode === "real" ? authState.token : null}
                  currentUserOverride={embeddedWorkspace.mode === "real" ? authState.user : null}
                  preferredWorkspaceUserId={embeddedWorkspace.preferredWorkspaceUserId || null}
                  onOpenPersonalChat={handleOpenPersonalChatFromWorkspace}
                />
              )}
            </div>
          ) : (
            <>
              <AppRail
                activeContactId={activeContactId}
                activeSection={sidebarSection}
                contacts={contacts}
                currentUser={authState.user}
                isCollapsed={isRailOverlayMode ? !isWorkspacePanelOpen : effectiveRailCollapsed}
                isCompact={isCompactRail}
                isHiddenMode={isHiddenRail}
                isMobileOpen={isWorkspacePanelOpen}
                notificationPermission={notificationPermission}
                onAvatarChange={handleAvatarChange}
                onCloseMobilePanel={handleCloseWorkspacePanel}
                onContactSearchChange={setContactSearch}
                onEnableNotifications={handleEnableNotifications}
                onFocusSearch={() => setSidebarSection("inbox")}
                onLogout={handleLogout}
                onLogoutAll={handleLogoutAll}
                onOpenWorkspaceWindow={handleOpenWorkspaceWindow}
                onOpenProjectManagerWindow={handleOpenProjectManagerWindow}
                onOpenFinanceWindow={handleOpenFinanceWindow}
                onOpenRamadanWindow={handleOpenRamadanWindow}
                onOpenTaskManagerWindow={handleOpenTaskManagerWindow}
                onOpenWarehouseWindow={handleOpenWarehouseWindow}
                onRequestExpandPanel={handleOpenWorkspacePanel}
                onSelectContact={handleSelectContact}
                onToggleTheme={handleToggleTheme}
                contactSearch={contactSearch}
                searchInputRef={searchInputRef}
                theme={theme}
                uploadingAvatar={uploadingAvatar}
              />
              <ConversationListPane
                activeContactId={activeContactId}
                contacts={contacts}
                currentUser={authState.user}
                isRailCollapsed={effectiveRailCollapsed}
                isRailOverlayMode={isRailOverlayMode}
                isWorkspacePanelOpen={isWorkspacePanelOpen}
                onOpenWorkspacePanel={handleOpenWorkspacePanel}
                onSelectContact={handleSelectContact}
                onToggleWorkspacePanel={handleToggleWorkspacePanel}
                onToggleRail={() => setIsRailCollapsed((current) => !current)}
                searchTerm={contactSearch}
              />
              <ConversationPane
                activeContact={activeContact}
                attachment={attachment}
                bondState={activeBondState}
                calendarEvents={calendarEvents}
                compactComposer={compactComposer}
                currentUserId={authState.user.id}
                draft={draft}
                editingMessageId={editingMessageId}
                editingText={editingText}
                error={chatError}
                failedSend={failedSend}
                forwardOptions={inboxForwardContacts}
                hasMoreMessages={hasMoreMessages}
                isTyping={Boolean(activeContact?.isTyping)}
                loading={messagesLoading}
                loadingOlderMessages={loadingOlderMessages}
                messageSearch={messageSearch}
                messages={messages}
                pdfReviewSessions={pdfReviewSessions}
                onAppendEmoji={(emoji) => setDraft((current) => `${current}${emoji}`)}
                onAttachmentSelect={handleAttachmentSelect}
                onSendSnapFile={handleSendSnapFile}
                onBack={handleBackToContacts}
                onBegTrustMode={() => emitBondEvent("bond:trust-beg")}
                onCancelEdit={() => {
                  setEditingMessageId(null);
                  setEditingText("");
                }}
                onDeleteMessage={handleDeleteMessage}
                onDraftChange={handleDraftChange}
                onDeleteCalendarEvent={handleDeleteCalendarEvent}
                onEditMessage={handleEditMessage}
                onEnableTrustMode={() => emitBondEvent("bond:trust-enable")}
                onEditingTextChange={setEditingText}
                onExportConversation={handleExportConversation}
                onForwardMessage={handleRequestForwardMessage}
                onForwardMessagePick={handleForwardMessageToContact}
                onForwardPickerDismiss={() => setForwardPickerMessage(null)}
                onIgnoreTrustMode={() => emitBondEvent("bond:trust-ignore")}
                onLoadOlder={handleLoadOlderMessages}
                onReplyToMessage={setReplyTarget}
                onRemoveAttachment={() => setAttachment(null)}
                onRetryFailedSend={handleRetryFailedSend}
                onSend={handleSendMessage}
                onSendVoiceMessage={handleSendVoiceMessage}
                onSetLabels={handleSetLabels}
                onSetNickname={handleSetNickname}
                onOpenActionPanel={() => setIsActionPanelOpen(true)}
                onOpenPlannerItem={handleOpenCalendarEvent}
                onOpenSnap={handleOpenSnap}
                onOpenWorkspacePanel={handleOpenWorkspacePanel}
                onOpenWorkspaceChat={
                  activeContact &&
                  !activeContact.isGroup &&
                  !activeContact.isSelf &&
                  !activeContact.isArchived &&
                  !activeContact.isRestricted &&
                  !activeContact.isTrashed &&
                  activeContact.requestState === "accepted" &&
                  activeContact.workspaceEnabled !== false
                    ? () => handleOpenWorkspaceChatForContact(activeContact.id)
                    : null
                }
                onCreateEventFromMessage={(message) => handleCreatePlannerItemFromMessage(message, "meeting")}
                onCreateTaskFromMessage={(message) => handleCreatePlannerItemFromMessage(message, "task")}
                onCreateProjectFromText={(text) => handleOpenProjectManagerWindow(text)}
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
                onToggleMute={handleToggleMute}
                onTogglePin={() => handleTogglePreference("isPinned")}
                onTogglePinnedMessage={handleTogglePinnedMessage}
                onToggleReaction={handleToggleReaction}
                onToggleStar={handleToggleStar}
                onToggleEmojiPicker={() => setShowEmojiPicker((current) => !current)}
                onToggleCoupleMode={() => emitBondEvent("bond:couple-toggle")}
                onUnavailableAction={handleUnavailableAction}
                isActionPanelDocked={showDockedActionPanel}
                pinnedMessages={messages.filter((message) => activeContact?.pinnedMessageIds?.includes(message.id))}
                replyTarget={replyTarget}
                forwardMessage={forwardMessage}
                forwardPickerMessage={forwardPickerMessage}
                onClearReplyTarget={() => setReplyTarget(null)}
                onClearForwardMessage={() => setForwardMessage(null)}
                onSearchChange={setMessageSearch}
                showEmojiPicker={showEmojiPicker}
                showBackButton={showCompactBackButton}
                onUpdateCalendarEventStatus={handleUpdateCalendarEventStatus}
                onBackLayerChange={handleConversationBackLayerChange}
              />
              <ChatActionPanel
                activeDock={actionPanelDock}
                activeContact={activeContact}
                calendarFocusEventId={calendarFocusEventId}
                calendarEvents={calendarEvents}
                currentUserId={authState.user.id}
                invoiceDocuments={invoiceDocuments}
                memoryCapsules={memoryCapsules}
                isOpen={showDockedActionPanel || isActionPanelOpen}
                isOverlay={!showDockedActionPanel}
                messages={messages}
            pdfReviewSessions={pdfReviewSessions}
            onActiveDockChange={setActionPanelDock}
            onArchive={() =>
              handleConversationAction(
                { isArchived: !activeContact?.isArchived },
                {
                  section: activeContact?.isArchived ? "inbox" : "archived",
                  toastTitle: activeContact?.isArchived ? "Conversation restored" : "Conversation archived"
                }
              )
            }
            onExportConversation={handleExportConversation}
            onRestrict={() =>
              handleConversationAction(
                { isRestricted: !activeContact?.isRestricted },
                {
                  section: activeContact?.isRestricted ? "inbox" : "restricted",
                  toastTitle: activeContact?.isRestricted ? "Restriction removed" : "Conversation restricted"
                }
              )
            }
            onSetLabels={handleSetLabels}
            onSetNickname={handleSetNickname}
            onClose={() => setIsActionPanelOpen(false)}
            onCalendarEventsChange={handleCalendarEventsChange}
            onCalendarFocusHandled={() => setCalendarFocusEventId(null)}
            onDeleteInvoiceDocument={handleDeleteInvoiceDocument}
            onDeleteMemoryCapsule={handleDeleteMemoryCapsule}
            onOpenMemoryCapsule={handleOpenMemoryCapsule}
            onReactMemoryCapsule={handleReactMemoryCapsule}
            onReplyMemoryCapsule={handleReplyMemoryCapsule}
            onSaveInvoiceDocument={handleSaveInvoiceDocument}
            onSaveMemoryCapsule={handleSaveMemoryCapsule}
            onCreatePdfReviewSession={handleCreatePdfReviewSession}
            onRespondPdfReviewSession={handleRespondPdfReviewSession}
            onToggleBlock={() => handleTogglePreference("isBlocked")}
            onToggleFavorite={() => handleTogglePreference("isFavorite")}
            onToggleMute={handleToggleMute}
            onTogglePin={() => handleTogglePreference("isPinned")}
	            onUpdateInvoiceStatus={handleUpdateInvoiceStatus}
	            onUpdatePdfReviewSession={handleUpdatePdfReviewSession}
	          />
	            </>
	          )}
	        </div>
	      </main>
	      <Toasts toasts={toasts} />
	    </>
	  );
	}
