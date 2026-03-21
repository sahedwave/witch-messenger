import { useEffect, useMemo, useState } from "react";

import { Avatar } from "./Avatar";

const navSections = [
  { id: "favorites", label: "Favourite links", icon: "🔗", badge: null },
  { id: "tasks", label: "Task manager", icon: "📋", badge: null },
  { id: "projects", label: "Project management", icon: "📁", badge: null },
  { id: "messages", label: "Users", icon: "💬", badge: 3 },
  { id: "workspace", label: "Workspace", icon: "🏢", badge: null },
  { id: "ramadan", label: "Ramadan", icon: "🌙", badge: null },
  { id: "quality", label: "Quality audit", icon: "✅", badge: "PRO" }
];

export function AppRail({
  activeContactId,
  activeSection = "messages",
  contactSearch,
  contacts,
  currentUser,
  isCompact = false,
  isHiddenMode = false,
  isCollapsed = false,
  isMobileOpen = false,
  notificationPermission,
  onAvatarChange,
  onCloseMobilePanel,
  onContactSearchChange,
  onEnableNotifications,
  onFocusSearch,
  onLogout,
  onLogoutAll,
  onOpenWorkspaceWindow = () => {},
  onOpenFinanceWindow = () => {},
  onOpenProjectManagerWindow = () => {},
  onOpenRamadanWindow = () => {},
  onOpenTaskManagerWindow = () => {},
  onOpenWarehouseWindow = () => {},
  onRequestExpandPanel = () => {},
  onSelectContact,
  onToggleTheme,
  searchInputRef,
  theme,
  uploadingAvatar
}) {
  const [activeNav, setActiveNav] = useState("messages");
  const [showProfileSettings, setShowProfileSettings] = useState(false);

  useEffect(() => {
    if (activeSection === "workspace" || activeSection === "finances" || activeSection === "warehouse") {
      setActiveNav("workspace");
      return;
    }

    setActiveNav("messages");
  }, [activeSection]);

  const messageContacts = useMemo(
    () => contacts.filter((contact) => !contact.isArchived && !contact.isTrashed).slice(0, 5),
    [contacts]
  );

  const messageUnreadCount = useMemo(
    () => messageContacts.reduce((count, contact) => count + (contact.unread || 0), 0),
    [messageContacts]
  );

  const notificationLabel =
    notificationPermission === "granted"
      ? "Alerts on"
      : notificationPermission === "denied"
        ? "Alerts blocked"
        : "Enable alerts";

  function handleNavClick(sectionId) {
    if (sectionId === "projects") {
      setActiveNav(sectionId);
      onOpenProjectManagerWindow();
      return;
    }

    if (sectionId === "tasks") {
      setActiveNav(sectionId);
      onOpenTaskManagerWindow();
      return;
    }

    if (sectionId === "ramadan") {
      setActiveNav(sectionId);
      onOpenRamadanWindow();
      return;
    }

    if (sectionId === "workspace") {
      setActiveNav(sectionId);
      onOpenWorkspaceWindow();
      return;
    }

    if (isCompact && !isMobileOpen) {
      setActiveNav(sectionId);
      onRequestExpandPanel();
      return;
    }

    if (sectionId === "messages") {
      setActiveNav((current) => (current === "messages" ? null : "messages"));
      return;
    }

    setActiveNav(sectionId);
  }

  return (
    <aside
      className={`workspace-rail ${isCollapsed ? "is-collapsed" : ""} ${isCompact ? "is-compact" : ""} ${isHiddenMode ? "is-hidden-mode" : ""} ${isMobileOpen ? "is-mobile-open" : ""}`}
    >
      <div className="workspace-rail-top">
        <div className="workspace-rail-mobile-head">
          <strong>Workspace</strong>
          <button className="ghost-button compact icon-button" type="button" onClick={onCloseMobilePanel}>
            Close
          </button>
        </div>
        <div className="workspace-brand">
          <span className="workspace-brand-mark">W</span>
          <div>
            <strong>WITCH</strong>
            <span>Workspace messenger</span>
          </div>
        </div>
      </div>
      <div className="workspace-rail-scroll">
        <label className="workspace-global-search">
          <span className="workspace-search-icon" aria-hidden="true">
            o
          </span>
          <input
            ref={searchInputRef}
            type="search"
            placeholder="Search in WITCH"
            value={contactSearch}
            onFocus={onFocusSearch}
            onChange={(event) => onContactSearchChange(event.target.value)}
          />
        </label>

        <nav className="workspace-nav" aria-label="Workspace navigation">
          {navSections.map((section) => (
            <div key={section.id} className="workspace-nav-group">
              <button
                type="button"
                className={`workspace-nav-item ${activeNav === section.id ? "is-active" : ""}`}
                onClick={() => handleNavClick(section.id)}
                aria-label={section.label}
                title={section.label}
              >
                <span className="workspace-nav-icon" aria-hidden="true">
                  {section.icon}
                </span>
                <span className="workspace-nav-label">{section.label}</span>
                {section.id === "messages" && messageUnreadCount > 0 ? (
                  <span className="workspace-nav-badge">{messageUnreadCount}</span>
                ) : null}
                {section.id !== "messages" && section.badge ? (
                  <span className={`workspace-nav-badge ${section.badge === "PRO" ? "is-pill" : ""}`}>
                    {section.badge}
                  </span>
                ) : null}
              </button>

              {section.id === "messages" && activeNav === "messages" ? (
                <div className="workspace-people-list nested">
                  {messageContacts.map((contact) => (
                    <button
                      key={contact.id}
                      type="button"
                      className={`workspace-person-row ${contact.id === activeContactId ? "is-active" : ""}`}
                      onClick={() => onSelectContact(contact.id)}
                    >
                      <span className="avatar-shell">
                        <Avatar user={contact} />
                        <span
                          className={`avatar-status avatar-status-${contact.presenceStatus === "online" ? "online" : contact.presenceStatus === "away" ? "away" : "offline"}`}
                          aria-hidden="true"
                        />
                      </span>
                      <span className="workspace-person-copy">
                        <strong>{contact.displayName || contact.name}</strong>
                      </span>
                      {contact.unread > 0 ? <span className="workspace-contact-badge">{contact.unread}</span> : null}
                    </button>
                  ))}

                  <div className="workspace-people-actions">
                    <button className="workspace-inline-link" type="button" onClick={onFocusSearch}>
                      View all
                    </button>
                    <button className="workspace-inline-link is-strong" type="button" onClick={onFocusSearch}>
                      New Chat
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </nav>

        <div className="workspace-profile-anchor">
          <button
            className={`ghost-button compact icon-button is-soft workspace-settings-trigger workspace-settings-fab ${showProfileSettings ? "is-active" : ""}`}
            type="button"
            onClick={() => setShowProfileSettings((value) => !value)}
            aria-label="Open profile settings"
            aria-expanded={showProfileSettings}
          >
            ⚙
          </button>

          {showProfileSettings ? (
            <div className="workspace-profile-popover">
              <div className="workspace-profile-card compact compact-inline compact-popover">
                <div className="workspace-profile-main compact-inline">
                  <div className="workspace-profile-head compact-inline">
                    <Avatar user={currentUser} size="large" />
                    <div>
                      <strong>{currentUser.name}</strong>
                      <p>Workspace profile</p>
                    </div>
                  </div>
                </div>

                <div className="workspace-profile-menu" role="menu" aria-label="Profile settings">
                  <div className="workspace-profile-actions compact-stack">
                    <button className="ghost-button compact is-soft" type="button" onClick={onToggleTheme}>
                      {theme === "dark" ? "Light mode" : "Dark mode"}
                    </button>
                    <button className="ghost-button compact is-soft" type="button" onClick={onEnableNotifications}>
                      {notificationLabel}
                    </button>
                  </div>

                  <details className="workspace-profile-more">
                    <summary>More settings</summary>
                    <div className="workspace-profile-actions compact-stack secondary">
                      <label className="ghost-button file-button compact">
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
                      <button className="ghost-button compact" type="button" onClick={onLogout}>
                        Logout
                      </button>
                      <button className="ghost-button subtle-button compact" type="button" onClick={onLogoutAll}>
                        Logout all
                      </button>
                    </div>
                  </details>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
