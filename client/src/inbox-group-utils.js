export const INBOX_GROUPS_STORAGE_KEY = "witch-inbox-groups";

export function chatRetentionMs(mode) {
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

function normalizeMessage(message, groupName = "Group") {
  const sender =
    typeof message.sender === "string"
      ? { id: `legacy-${message.sender}`, name: message.sender }
      : {
          id: message.sender?.id || crypto.randomUUID(),
          name: message.sender?.name || "Unknown",
          avatarUrl: message.sender?.avatarUrl || ""
        };

  const createdAt = message.createdAt || new Date().toISOString();

  return {
    id: message.id || crypto.randomUUID(),
    text: message.text ?? message.body ?? "",
    attachment: message.attachment || null,
    isSnap: Boolean(message.isSnap),
    snapOpenedAt: message.snapOpenedAt || null,
    snapViewSeconds: message.snapViewSeconds || 0,
    createdAt,
    editedAt: message.editedAt || null,
    deletedAt: message.deletedAt || null,
    autoDeleteAt: message.autoDeleteAt || null,
    seenAt: message.seenAt || null,
    sender,
    recipient: {
      id: message.recipient?.id || null,
      name: message.recipient?.name || groupName
    },
    replyTo: message.replyTo || null,
    forwardedFrom: message.forwardedFrom || null,
    reactions: Array.isArray(message.reactions) ? message.reactions : []
  };
}

export function normalizeInboxGroup(group) {
  const memberNames = Array.isArray(group.memberNames)
    ? group.memberNames.filter(Boolean)
    : [];
  const messages = Array.isArray(group.messages)
    ? group.messages.map((message) => normalizeMessage(message, group.name || "Project group"))
    : [];

  return {
    id: group.id || `group-${crypto.randomUUID()}`,
    projectId: group.projectId || null,
    name: group.name || "Project group",
    memberIds: Array.isArray(group.memberIds) ? group.memberIds.filter(Boolean) : [],
    memberNames,
    disappearingMode: group.disappearingMode || "off",
    pinnedMessageIds: Array.isArray(group.pinnedMessageIds) ? group.pinnedMessageIds : [],
    labels: Array.isArray(group.labels) ? group.labels : ["Group"],
    nickname: group.nickname || "",
    isFavorite: Boolean(group.isFavorite),
    isPinned: Boolean(group.isPinned),
    isMuted: Boolean(group.isMuted),
    isArchived: Boolean(group.isArchived),
    isRestricted: Boolean(group.isRestricted),
    isTrashed: Boolean(group.isTrashed),
    messages,
    createdAt: group.createdAt || messages[0]?.createdAt || new Date().toISOString(),
    updatedAt: group.updatedAt || messages[messages.length - 1]?.createdAt || new Date().toISOString()
  };
}

export function readStoredInboxGroups() {
  try {
    const raw = window.localStorage.getItem(INBOX_GROUPS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(normalizeInboxGroup) : [];
  } catch {
    return [];
  }
}

export function writeStoredInboxGroups(groups) {
  window.localStorage.setItem(
    INBOX_GROUPS_STORAGE_KEY,
    JSON.stringify(groups.map(normalizeInboxGroup))
  );
}

export function upsertInboxGroup(groups, group) {
  const next = groups.filter((entry) => entry.id !== group.id);
  next.unshift(normalizeInboxGroup(group));
  return next;
}

export function removeInboxGroup(groups, groupId) {
  return groups.filter((entry) => entry.id !== groupId);
}

export function createInboxGroupContact(group) {
  const normalized = normalizeInboxGroup(group);
  const lastMessage = normalized.messages[normalized.messages.length - 1] || null;

  return {
    id: normalized.id,
    name: normalized.name,
    displayName: normalized.nickname || normalized.name,
    email: "",
    unread: 0,
    lastMessage,
    isTyping: false,
    isSelf: false,
    isGroup: true,
    requestState: "accepted",
    isArchived: normalized.isArchived,
    isTrashed: normalized.isTrashed,
    isRestricted: normalized.isRestricted,
    isPinned: normalized.isPinned,
    isFavorite: normalized.isFavorite,
    isMuted: normalized.isMuted,
    isBlocked: false,
    hasBlockedYou: false,
    labels: normalized.labels,
    nickname: normalized.nickname,
    pinnedMessageIds: normalized.pinnedMessageIds,
    deviceCount: normalized.memberNames.length || normalized.memberIds.length || 0,
    presenceStatus: "online",
    online: true,
    lastActiveAt: normalized.updatedAt,
    memberCount: normalized.memberNames.length || normalized.memberIds.length || 0,
    memberNames: normalized.memberNames,
    projectId: normalized.projectId
  };
}

export function filterInboxGroupMessages(group) {
  const normalized = normalizeInboxGroup(group);
  const retention = chatRetentionMs(normalized.disappearingMode);
  const activeMessages = normalized.messages.filter(
    (message) => !message.autoDeleteAt || new Date(message.autoDeleteAt).getTime() > Date.now()
  );

  if (!retention) {
    return {
      ...normalized,
      messages: activeMessages
    };
  }

  const cutoff = Date.now() - retention;
  return {
    ...normalized,
    messages: activeMessages.filter((message) => new Date(message.createdAt).getTime() >= cutoff)
  };
}

export function mergeInboxGroupContacts(currentContacts, groups) {
  const nonGroups = currentContacts.filter((contact) => !contact.isGroup);
  const groupContacts = groups.map(createInboxGroupContact);
  return [...nonGroups, ...groupContacts];
}

export function buildInboxGroupFromProject(project, currentUser) {
  const projectMessages = Array.isArray(project.chatRoom?.messages)
    ? project.chatRoom.messages
    : [];
  const memberIds = (project.team || [])
    .map((member) => member.contactId)
    .filter(Boolean);
  const memberNames = (project.team || [])
    .map((member) => member.name)
    .filter(Boolean);

  return normalizeInboxGroup({
    id: project.chatRoom?.inboxGroupId || `group-${project.id}`,
    projectId: project.id,
    name: project.name,
    memberIds: [
      currentUser?.id,
      ...memberIds
    ].filter(Boolean),
    memberNames: [currentUser?.name, ...memberNames].filter(Boolean),
    disappearingMode: project.chatRoom?.disappearingMode || "off",
    pinnedMessageIds: project.chatRoom?.pinnedMessageIds || [],
    labels: ["Project group"],
    nickname: project.chatRoom?.nickname || "",
    isFavorite: Boolean(project.chatRoom?.isFavorite),
    isPinned: Boolean(project.chatRoom?.isPinned),
    isMuted: Boolean(project.chatRoom?.isMuted),
    messages: projectMessages,
    createdAt: project.chatRoom?.createdAt || new Date().toISOString(),
    updatedAt: project.chatRoom?.updatedAt || new Date().toISOString()
  });
}
