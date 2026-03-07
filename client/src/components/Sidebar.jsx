import { useEffect, useMemo, useState } from "react";

import { Avatar } from "./Avatar";

const sections = [
  ["inbox", "Inbox"],
  ["requests", "Requests"],
  ["archived", "Archived"],
  ["restricted", "Restricted"],
  ["trash", "Trash"]
];

function getContactSection(contact) {
  if (contact.isTrashed) {
    return "trash";
  }

  if (contact.requestState === "pending") {
    return "requests";
  }

  if (contact.isRestricted) {
    return "restricted";
  }

  if (contact.isArchived) {
    return "archived";
  }

  return "inbox";
}

function formatPreview(contact, currentUserId) {
  if (contact.isTyping) {
    return "Typing...";
  }

  if (contact.requestState === "pending" && !contact.lastMessage) {
    return "Message request";
  }

  if (!contact.lastMessage) {
    return "No messages yet";
  }

  const prefix = contact.lastMessage.sender.id === currentUserId ? "You: " : "";
  return `${prefix}${contact.lastMessage.text}`;
}

function formatRelativeTime(value) {
  if (!value) {
    return "";
  }

  const minutesDifference = Math.round((new Date(value).getTime() - Date.now()) / 60000);
  return new Intl.RelativeTimeFormat([], { numeric: "auto" }).format(minutesDifference, "minute");
}

function formatPresence(contact) {
  if (contact.requestState === "pending") {
    return "Message request";
  }

  if (contact.requestState === "sent") {
    return "Waiting for approval";
  }

  if (contact.isRestricted) {
    return "Restricted";
  }

  if (contact.isArchived) {
    return "Archived";
  }

  if (contact.isTrashed) {
    return "In trash";
  }

  if (contact.presenceStatus === "online") {
    return contact.deviceCount > 1 ? `Online on ${contact.deviceCount} devices` : "Online";
  }

  if (contact.presenceStatus === "away") {
    return "Away";
  }

  if (contact.lastActiveAt) {
    return `Last active ${formatRelativeTime(contact.lastActiveAt)}`;
  }

  return "Offline";
}

export function Sidebar({
  activeContactId,
  contacts,
  currentUser,
  logoutAllLoading,
  notificationPermission,
  onAvatarChange,
  onDisableTwoFactor,
  onEnableNotifications,
  onEnableTwoFactor,
  onLogout,
  onLogoutAll,
  onRequestTwoFactorSetup,
  onSaveProfile,
  onSelectContact,
  onSelectSection,
  onTwoFactorSetupInputChange,
  onToggleTheme,
  searchInputRef,
  securityActionLoading,
  section,
  theme,
  twoFactorSetupCode,
  twoFactorSetupInput,
  uploadingAvatar
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [profileForm, setProfileForm] = useState({
    name: currentUser.name || "",
    statusMessage: currentUser.statusMessage || "",
    language: currentUser.language || "en",
    showLastSeen: currentUser.showLastSeen !== false
  });

  useEffect(() => {
    setProfileForm({
      name: currentUser.name || "",
      statusMessage: currentUser.statusMessage || "",
      language: currentUser.language || "en",
      showLastSeen: currentUser.showLastSeen !== false
    });
  }, [currentUser]);

  const filteredContacts = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    if (!query) {
      return contacts;
    }

    return contacts.filter((contact) =>
      [contact.name, contact.email].some((value) => value.toLowerCase().includes(query))
    );
  }, [contacts, searchTerm]);

  const visibleContacts = useMemo(
    () => filteredContacts.filter((contact) => getContactSection(contact) === section),
    [filteredContacts, section]
  );

  const sectionCounts = useMemo(
    () =>
      contacts.reduce(
        (counts, contact) => {
          counts[getContactSection(contact)] += 1;
          return counts;
        },
        {
          inbox: 0,
          requests: 0,
          archived: 0,
          restricted: 0,
          trash: 0
        }
      ),
    [contacts]
  );

  const notificationLabel =
    notificationPermission === "granted"
      ? "Alerts on"
      : notificationPermission === "denied"
        ? "Alerts blocked"
        : "Enable alerts";

  return (
    <aside className="sidebar">
      <header className="sidebar-header sidebar-profile">
        <div className="sidebar-profile-main">
          <Avatar user={currentUser} size="large" />
          <div>
            <span className="eyebrow">Chats</span>
            <h2>{currentUser.name}</h2>
            <p>{currentUser.email}</p>
            {currentUser.statusMessage ? <p>{currentUser.statusMessage}</p> : null}
          </div>
        </div>

        <div className="sidebar-toolbar">
          <label className="ghost-button file-button">
            {uploadingAvatar ? "Uploading..." : "Photo"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  onAvatarChange(file);
                }
                event.target.value = "";
              }}
            />
          </label>
          <button className="ghost-button" type="button" onClick={onToggleTheme}>
            {theme === "dark" ? "Light" : "Dark"}
          </button>
          <button className="ghost-button" type="button" onClick={onLogout}>
            Logout
          </button>
        </div>
      </header>

      <div className="sidebar-utilities">
        <button
          className={`status-button ${notificationPermission === "granted" ? "is-active" : ""}`}
          type="button"
          onClick={onEnableNotifications}
          disabled={notificationPermission === "unsupported"}
        >
          {notificationLabel}
        </button>
        <button
          className="ghost-button subtle-button"
          type="button"
          onClick={onLogoutAll}
          disabled={logoutAllLoading}
        >
          {logoutAllLoading ? "Logging out..." : "Logout all"}
        </button>
      </div>

      <div className="security-panel">
        <div className="profile-editor">
          <input
            className="security-input"
            type="text"
            placeholder="Profile name"
            value={profileForm.name}
            onChange={(event) =>
              setProfileForm((current) => ({ ...current, name: event.target.value }))
            }
          />
          <input
            className="security-input"
            type="text"
            placeholder="Custom status"
            value={profileForm.statusMessage}
            onChange={(event) =>
              setProfileForm((current) => ({ ...current, statusMessage: event.target.value }))
            }
          />
          <div className="sidebar-toolbar">
            <select
              className="security-input security-select"
              value={profileForm.language}
              onChange={(event) =>
                setProfileForm((current) => ({ ...current, language: event.target.value }))
              }
            >
              <option value="en">English</option>
              <option value="bn">Bangla</option>
            </select>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={profileForm.showLastSeen}
                onChange={(event) =>
                  setProfileForm((current) => ({
                    ...current,
                    showLastSeen: event.target.checked
                  }))
                }
              />
              Show last seen
            </label>
          </div>
          <button
            className="ghost-button subtle-button"
            type="button"
            onClick={() => onSaveProfile(profileForm)}
          >
            Save profile
          </button>
        </div>

        <p className="security-copy">
          Security: {currentUser.twoFactorEnabled ? "2-step verification on" : "2-step verification off"}
        </p>
        <p className="security-copy">Active sessions: {currentUser.activeSessionCount || 1}</p>
        <div className="sidebar-toolbar">
          {currentUser.twoFactorEnabled ? (
            <button
              className="ghost-button subtle-button"
              type="button"
              onClick={onDisableTwoFactor}
              disabled={securityActionLoading}
            >
              {securityActionLoading ? "Updating..." : "Disable 2-step"}
            </button>
          ) : (
            <>
              <button
                className="ghost-button subtle-button"
                type="button"
                onClick={onRequestTwoFactorSetup}
                disabled={securityActionLoading}
              >
                {securityActionLoading ? "Preparing..." : "Get 2-step code"}
              </button>
              <input
                type="text"
                className="security-input"
                placeholder="Enter security code"
                value={twoFactorSetupInput}
                onChange={(event) => onTwoFactorSetupInputChange(event.target.value)}
              />
              <button
                className="ghost-button subtle-button"
                type="button"
                onClick={onEnableTwoFactor}
                disabled={securityActionLoading || !twoFactorSetupInput.trim()}
              >
                Enable 2-step
              </button>
            </>
          )}
        </div>
        {twoFactorSetupCode ? (
          <p className="security-copy">
            Local setup code: <strong>{twoFactorSetupCode}</strong>
          </p>
        ) : null}
      </div>

      <div className="sidebar-search">
        <input
          ref={searchInputRef}
          type="search"
          placeholder="Search contacts"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
        />
      </div>

      <div className="sidebar-sections">
        {sections.map(([value, label]) => (
          <button
            key={value}
            className={`section-chip ${section === value ? "is-active" : ""}`}
            type="button"
            onClick={() => onSelectSection(value)}
          >
            {label}
            {sectionCounts[value] > 0 ? <span>{sectionCounts[value]}</span> : null}
          </button>
        ))}
      </div>

      <div className="contact-list">
        {contacts.length === 0 ? <p className="panel-state">No other registered users yet.</p> : null}
        {contacts.length > 0 && filteredContacts.length === 0 ? (
          <p className="panel-state">No contacts match your search.</p>
        ) : null}
        {filteredContacts.length > 0 && visibleContacts.length === 0 ? (
          <p className="panel-state">Nothing in this section right now.</p>
        ) : null}

        {visibleContacts.map((contact) => (
          <button
            key={contact.id}
            type="button"
            className={`contact-card ${contact.id === activeContactId ? "is-active" : ""}`}
            onClick={() => onSelectContact(contact.id)}
          >
            <Avatar user={contact} />

            <span className="contact-body">
              <span className="contact-topline">
                <strong>{contact.displayName || contact.name}</strong>
                {contact.isFavorite ? <span className="contact-flag">Favorite</span> : null}
                {contact.requestState === "pending" ? <span className="contact-flag">Request</span> : null}
                {contact.requestState === "sent" ? <span className="contact-flag">Sent</span> : null}
                {contact.isArchived ? <span className="contact-flag">Archived</span> : null}
                {contact.isRestricted ? <span className="contact-flag">Restricted</span> : null}
                {contact.isTrashed ? <span className="contact-flag">Trash</span> : null}
                {contact.isPinned && !contact.isArchived && !contact.isRestricted && !contact.isTrashed ? (
                  <span className="contact-flag">Pinned</span>
                ) : null}
                {contact.isVerified ? <span className="contact-flag">Verified</span> : null}
                {contact.online ? <span className="online-dot" /> : null}
              </span>
              <span className={`contact-preview ${contact.isTyping ? "is-typing" : ""}`}>
                {formatPreview(contact, currentUser.id)}
              </span>
              <span className="contact-subtitle">
                {contact.isBlocked ? "Blocked" : contact.isMuted ? "Muted" : formatPresence(contact)}
              </span>
              {contact.labels?.length ? (
                <span className="contact-subtitle">{contact.labels.join(" • ")}</span>
              ) : null}
            </span>

            <span className="contact-meta">
              {contact.lastMessage ? (
                <span className="contact-time">
                  {formatRelativeTime(contact.lastMessage.createdAt)}
                </span>
              ) : null}
              {contact.unread > 0 ? <span className="unread-badge">{contact.unread}</span> : null}
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}
