import { useEffect, useMemo, useState } from "react";

import { PROJECT_MANAGER_STORAGE_KEY } from "./ProjectManagerWindow";
import {
  buildInboxGroupFromProject,
  readStoredInboxGroups,
  removeInboxGroup,
  upsertInboxGroup,
  writeStoredInboxGroups
} from "../inbox-group-utils";
import { canUseProjectChat, getExternalTeamMemberCount } from "../project-chat-utils";

function readProjectState() {
  try {
    const raw = window.localStorage.getItem(PROJECT_MANAGER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : { projects: [] };
  } catch {
    return { projects: [] };
  }
}

function chatRetentionMs(mode) {
  if (mode === "1d") {
    return 24 * 60 * 60 * 1000;
  }
  if (mode === "7d") {
    return 7 * 24 * 60 * 60 * 1000;
  }
  if (mode === "30d") {
    return 30 * 24 * 60 * 60 * 1000;
  }
  return null;
}

function filterExpiredMessages(chatRoom) {
  if (!chatRoom) {
    return chatRoom;
  }

  const retention = chatRetentionMs(chatRoom.disappearingMode);
  if (!retention) {
    return chatRoom;
  }

  const cutoff = Date.now() - retention;
  return {
    ...chatRoom,
    messages: (chatRoom.messages || []).filter((message) => new Date(message.createdAt).getTime() >= cutoff)
  };
}

export function ProjectChatWindow({ currentUser }) {
  const projectId = new URLSearchParams(window.location.search).get("projectId");
  const [projectState, setProjectState] = useState(readProjectState);
  const [inboxGroups, setInboxGroups] = useState(readStoredInboxGroups);
  const [draft, setDraft] = useState("");
  const project = useMemo(
    () => {
      const entry = (projectState.projects || []).find((projectEntry) => projectEntry.id === projectId) || null;
      if (!entry) {
        return null;
      }

      return {
        ...entry,
        chatRoom: filterExpiredMessages(entry.chatRoom)
      };
    },
    [projectId, projectState.projects]
  );
  const messages = project?.chatRoom?.messages || [];
  const currentUserName = currentUser?.name?.trim() || "User";
  const currentUserId = currentUser?.id || `local-${currentUserName.toLowerCase().replace(/\s+/g, "-")}`;
  const chatAllowed = canUseProjectChat(project?.team || []);
  const externalMemberCount = getExternalTeamMemberCount(project?.team || []);
  const linkedInboxGroup = useMemo(
    () =>
      project?.chatRoom?.inboxGroupId
        ? inboxGroups.find((group) => group.id === project.chatRoom.inboxGroupId) || null
        : null,
    [inboxGroups, project?.chatRoom?.inboxGroupId]
  );

  useEffect(() => {
    function syncFromStorage() {
      setProjectState(readProjectState());
      setInboxGroups(readStoredInboxGroups());
    }

    window.addEventListener("storage", syncFromStorage);
    return () => window.removeEventListener("storage", syncFromStorage);
  }, []);

  useEffect(() => {
    if (!project?.chatRoom) {
      return;
    }

    const cleanedChat = filterExpiredMessages(project.chatRoom);
    if ((cleanedChat.messages || []).length === (project.chatRoom.messages || []).length) {
      return;
    }

    const nextState = {
      ...projectState,
      projects: projectState.projects.map((entry) =>
        entry.id === project.id
          ? {
              ...entry,
              chatRoom: cleanedChat
            }
          : entry
      )
    };

    window.localStorage.setItem(PROJECT_MANAGER_STORAGE_KEY, JSON.stringify(nextState));
    setProjectState(nextState);
  }, [project, projectState]);

  function sendMessage() {
    const body = draft.trim();
    if (!body || !project || !chatAllowed) {
      return;
    }

    const nextMessage = {
      id: crypto.randomUUID(),
      text: body,
      createdAt: new Date().toISOString(),
      editedAt: null,
      deletedAt: null,
      seenAt: null,
      sender: {
        id: currentUserId,
        name: currentUserName,
        avatarUrl: currentUser?.avatarUrl || ""
      },
      recipient: {
        id: project.id,
        name: project.chatRoom?.name || project.name
      },
      reactions: []
    };

    const nextState = {
      ...projectState,
      projects: projectState.projects.map((entry) =>
        entry.id === project.id
          ? {
              ...entry,
              chatRoom: {
                ...filterExpiredMessages(entry.chatRoom),
                updatedAt: nextMessage.createdAt,
                messages: [
                  ...(filterExpiredMessages(entry.chatRoom)?.messages || []),
                  nextMessage
                ]
              }
            }
          : entry
      )
    };

    window.localStorage.setItem(PROJECT_MANAGER_STORAGE_KEY, JSON.stringify(nextState));
    setProjectState(nextState);

    if (project.chatRoom?.inboxGroupId) {
      const nextGroups = upsertInboxGroup(
        inboxGroups,
        buildInboxGroupFromProject(
          nextState.projects.find((entry) => entry.id === project.id),
          currentUser
        )
      );
      writeStoredInboxGroups(nextGroups);
      setInboxGroups(nextGroups);
    }

    setDraft("");
  }

  function updateProjectAndGroups(transformProject) {
    if (!project) {
      return null;
    }

    const nextProjects = projectState.projects.map((entry) =>
      entry.id === project.id ? transformProject(entry) : entry
    );
    const nextState = {
      ...projectState,
      projects: nextProjects
    };

    window.localStorage.setItem(PROJECT_MANAGER_STORAGE_KEY, JSON.stringify(nextState));
    setProjectState(nextState);

    const updatedProject = nextProjects.find((entry) => entry.id === project.id) || null;
    if (updatedProject?.chatRoom?.inboxGroupId) {
      const nextGroups = upsertInboxGroup(
        inboxGroups,
        buildInboxGroupFromProject(updatedProject, currentUser)
      );
      writeStoredInboxGroups(nextGroups);
      setInboxGroups(nextGroups);
    }

    return updatedProject;
  }

  function promoteToInboxGroup() {
    if (!project?.chatRoom || !chatAllowed) {
      return;
    }

    const nextInboxGroupId = project.chatRoom.inboxGroupId || `group-${project.id}`;
    const updatedProject = updateProjectAndGroups((entry) => ({
      ...entry,
      chatRoom: {
        ...entry.chatRoom,
        inboxGroupId: nextInboxGroupId,
        updatedAt: new Date().toISOString()
      }
    }));

    if (!updatedProject) {
      return;
    }

    const nextGroups = upsertInboxGroup(inboxGroups, buildInboxGroupFromProject(updatedProject, currentUser));
    writeStoredInboxGroups(nextGroups);
    setInboxGroups(nextGroups);
  }

  function removeFromInboxGroup() {
    if (!project?.chatRoom?.inboxGroupId) {
      return;
    }

    updateProjectAndGroups((entry) => ({
      ...entry,
      chatRoom: {
        ...entry.chatRoom,
        inboxGroupId: null
      }
    }));

    const nextGroups = removeInboxGroup(inboxGroups, project.chatRoom.inboxGroupId);
    writeStoredInboxGroups(nextGroups);
    setInboxGroups(nextGroups);
  }

  function openInboxGroup() {
    const inboxUrl = new URL(window.location.href);
    inboxUrl.searchParams.delete("view");
    inboxUrl.searchParams.delete("projectId");
    if (project?.chatRoom?.inboxGroupId) {
      inboxUrl.searchParams.set("groupId", project.chatRoom.inboxGroupId);
    }
    const popup = window.open(inboxUrl.toString(), "witch-main-inbox");
    popup?.focus();
  }

  function updateDisappearingMode(mode) {
    if (!project?.chatRoom) {
      return;
    }

    const updatedProject = updateProjectAndGroups((entry) => ({
      ...entry,
      chatRoom: {
        ...entry.chatRoom,
        disappearingMode: mode,
        updatedAt: new Date().toISOString()
      }
    }));

    if (!updatedProject) {
      return;
    }

    if (updatedProject.chatRoom?.inboxGroupId) {
      const nextGroups = upsertInboxGroup(
        inboxGroups,
        buildInboxGroupFromProject(updatedProject, currentUser)
      );
      writeStoredInboxGroups(nextGroups);
      setInboxGroups(nextGroups);
    }
  }

  return (
    <main className="project-chat-shell">
      <section className="project-chat-frame">
        <header className="project-chat-head">
          <div>
            <span className="project-window-badge">Project chat</span>
            <h1>{project?.chatRoom?.name || "Project group inbox"}</h1>
            <p>
              {project
                ? `Temporary project chat for ${project.name}${project.chatRoom?.disappearingMode && project.chatRoom.disappearingMode !== "off" ? ` • disappears ${project.chatRoom.disappearingMode === "1d" ? "after 1 day" : project.chatRoom.disappearingMode === "7d" ? "after 7 days" : "after 30 days"}` : ""}`
                : "No project chat found."}
            </p>
            {project ? (
              <div className="project-chat-mode-toggle">
                <label className="project-chat-inbox-choice">
                  <input
                    type="checkbox"
                    checked={Boolean(project.chatRoom?.inboxGroupId)}
                    disabled={!chatAllowed}
                    onChange={(event) =>
                      event.target.checked ? promoteToInboxGroup() : removeFromInboxGroup()
                    }
                  />
                  <span>Show this as a real inbox group</span>
                </label>
                {linkedInboxGroup ? (
                  <button
                    type="button"
                    className="ghost-button compact"
                    onClick={openInboxGroup}
                    disabled={!chatAllowed}
                  >
                    Open in inbox
                  </button>
                ) : null}
                <label className="project-chat-disappear-field">
                  <span>Disappearing chat</span>
                  <select
                    value={project.chatRoom?.disappearingMode || "off"}
                    onChange={(event) => updateDisappearingMode(event.target.value)}
                  >
                    <option value="off">Off</option>
                    <option value="1d">Delete after 1 day</option>
                    <option value="7d">Delete after 7 days</option>
                    <option value="30d">Delete after 30 days</option>
                  </select>
                </label>
              </div>
            ) : null}
          </div>
          <button type="button" className="ghost-button compact" onClick={() => window.close()}>
            Close
          </button>
        </header>

        <section className="project-chat-thread">
          {!chatAllowed ? (
            <div className="project-window-empty">
              <strong>Project chat is locked</strong>
              <p>
                At least 2 team members are not IN APP USERs yet. Link more members to app profiles first,
                then this temporary project chat will unlock.
              </p>
              <p>{externalMemberCount} non-IN APP USERs are currently blocking chat access.</p>
            </div>
          ) : messages.length ? (
            messages.map((message) => (
              <article
                key={message.id}
                className={`project-chat-message ${message.sender?.id === currentUserId || message.sender?.name === currentUserName ? "is-own" : ""}`}
              >
                <strong>{message.sender?.name || message.sender}</strong>
                <p>{message.text || message.body}</p>
              </article>
            ))
          ) : (
            <div className="project-window-empty">
              <strong>No chat yet</strong>
              <p>Start the project conversation here.</p>
            </div>
          )}
        </section>

          {project && chatAllowed ? (
          <footer className="project-chat-composer">
            <input
              type="text"
              placeholder={`Message ${project.chatRoom?.name || "project team"}`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button type="button" className="ghost-button compact" onClick={sendMessage}>
              Send
            </button>
          </footer>
        ) : null}
      </section>
    </main>
  );
}
