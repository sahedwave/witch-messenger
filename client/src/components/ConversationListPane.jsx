import { useMemo, useState } from "react";

import { ChatListItem } from "./ChatListItem";

const listTabs = [
  ["drafts", "Drafts"],
  ["archived", "Archived"]
];

function formatPreview(contact, currentUserId) {
  if (contact.isTyping) {
    return "Typing...";
  }

  if (contact.isGroup && !contact.lastMessage) {
    return "Project group is ready";
  }

  if (contact.requestState === "pending" && !contact.lastMessage) {
    return "Message request";
  }

  if (!contact.lastMessage) {
    return "No messages yet";
  }

  if (
    contact.lastMessage.autoDeleteAt &&
    new Date(contact.lastMessage.autoDeleteAt).getTime() <= Date.now()
  ) {
    return "No messages yet";
  }

  if (contact.lastMessage.isSnap) {
    const prefix = contact.lastMessage.sender.id === currentUserId ? "You sent a snap" : "Snap";
    return prefix;
  }

  const prefix = contact.lastMessage.sender.id === currentUserId ? "You: " : "";
  return `${prefix}${contact.lastMessage.text || contact.lastMessage.attachment?.name || "Attachment"}`;
}

function formatRelativeTime(value) {
  if (!value) {
    return "";
  }

  const deltaMinutes = Math.round((new Date(value).getTime() - Date.now()) / 60000);

  if (Math.abs(deltaMinutes) < 60) {
    return new Intl.RelativeTimeFormat([], { numeric: "auto" }).format(deltaMinutes, "minute");
  }

  if (Math.abs(deltaMinutes) < 1440) {
    return new Intl.RelativeTimeFormat([], { numeric: "auto" }).format(
      Math.round(deltaMinutes / 60),
      "hour"
    );
  }

  return new Intl.RelativeTimeFormat([], { numeric: "auto" }).format(
    Math.round(deltaMinutes / 1440),
    "day"
  );
}

function formatPresence(contact) {
  if (contact.isTyping) {
    return "Typing...";
  }

  if (contact.isGroup) {
    return `${contact.memberCount || contact.memberNames?.length || 0} members`;
  }

  if (contact.requestState === "pending") {
    return "Message request";
  }

  if (contact.presenceStatus === "online") {
    return "Online";
  }

  if (contact.presenceStatus === "away") {
    return "Away";
  }

  if (contact.lastActiveAt) {
    return `Last active ${formatRelativeTime(contact.lastActiveAt)}`;
  }

  return "Offline";
}

function filterContactsByTab(contacts, tab) {
  if (tab === "archived") {
    return contacts.filter((contact) => contact.isArchived && !contact.isTrashed);
  }

  if (tab === "drafts") {
    return contacts.filter((contact) => contact.hasDraft);
  }

  return contacts.filter((contact) => !contact.isArchived && !contact.isTrashed);
}

export function ConversationListPane({
  activeContactId,
  contacts,
  currentUser,
  isRailCollapsed,
  isRailOverlayMode = false,
  isWorkspacePanelOpen = false,
  onOpenWorkspacePanel,
  onSelectContact,
  onToggleWorkspacePanel,
  onToggleRail,
  searchTerm
}) {
  const [activeTab, setActiveTab] = useState("messages");
  const showDesktopRailToggle = !(isRailOverlayMode && isWorkspacePanelOpen);

  const filteredContacts = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const scopedContacts = filterContactsByTab(contacts, activeTab);

    if (!query) {
      return scopedContacts;
    }

    return scopedContacts.filter((contact) =>
      [contact.name, contact.email, contact.nickname || "", contact.displayName || ""].some((value) =>
        value.toLowerCase().includes(query)
      )
    );
  }, [activeTab, contacts, searchTerm]);

  const tabCounts = useMemo(
    () => ({
      messages: filterContactsByTab(contacts, "messages").length,
      drafts: filterContactsByTab(contacts, "drafts").length,
      archived: filterContactsByTab(contacts, "archived").length
    }),
    [contacts]
  );

  return (
    <aside className="conversation-column">
      <div className="conversation-column-head">
        <div className="conversation-column-topline compact is-inline">
          <div className="conversation-head-actions">
            {showDesktopRailToggle ? (
              <button
                className="ghost-button compact icon-button conversation-shell-toggle is-desktop"
                type="button"
                aria-label={
                  isRailOverlayMode
                    ? isWorkspacePanelOpen
                      ? "Close workspace navigation"
                      : "Open workspace navigation"
                    : isRailCollapsed
                      ? "Expand workspace column"
                      : "Collapse workspace column"
                }
                aria-expanded={isRailOverlayMode ? isWorkspacePanelOpen : !isRailCollapsed}
                onClick={isRailOverlayMode ? onToggleWorkspacePanel : onToggleRail}
              >
                ☰
              </button>
            ) : null}
            <button
              className="ghost-button compact icon-button conversation-shell-toggle is-mobile"
              type="button"
              aria-label="Open workspace navigation"
              aria-expanded={isWorkspacePanelOpen}
              onClick={onOpenWorkspacePanel}
            >
              ☰
            </button>
          </div>

          <div className="conversation-header-copy compact inline-compact">
            <span className="eyebrow">Friends</span>
            <div className="conversation-inline-heading">
              <h2>Friends</h2>
              <span>{filteredContacts.length} active</span>
            </div>
          </div>

          <button
            className="ghost-button conversation-new-chat compact relative z-10 shrink-0"
            type="button"
            onClick={() => setActiveTab("messages")}
          >
            Inbox
          </button>
        </div>
      </div>

      <div className="conversation-tabs" role="tablist" aria-label="Conversation views">
        {listTabs.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`conversation-tab ${activeTab === value ? "is-active" : ""}`}
            onClick={() =>
              setActiveTab((current) => (current === value ? "messages" : value))
            }
          >
            <span>{label}</span>
            {tabCounts[value] > 0 ? <span className="conversation-tab-count">{tabCounts[value]}</span> : null}
          </button>
        ))}
      </div>

      <div className="conversation-column-list">
        {filteredContacts.length === 0 ? (
          <div className="conversation-column-empty">
            <strong>{activeTab === "drafts" ? "No drafts yet" : "No conversations found"}</strong>
            <p>
              {activeTab === "drafts"
                ? "Drafted conversations will appear here once you start composing."
                : "Try a different search or pick another conversation view."}
            </p>
          </div>
        ) : null}

        {filteredContacts.map((contact) => (
          <ChatListItem
            key={contact.id}
            active={contact.id === activeContactId}
            contact={contact}
            preview={formatPreview(contact, currentUser.id)}
            subtitle={formatPresence(contact)}
            timeText={contact.lastMessage ? formatRelativeTime(contact.lastMessage.createdAt) : ""}
            onSelect={() => onSelectContact(contact.id)}
          />
        ))}
      </div>
    </aside>
  );
}
