export function serializeUser(user, options = {}) {
  const viewerId = options.viewerId?.toString();
  const isSelf = viewerId && user._id.toString() === viewerId;
  const canShowLastSeen = isSelf || user.showLastSeen !== false;

  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    avatarColor: user.avatarColor,
    avatarUrl: user.avatarUrl || null,
    statusMessage: user.statusMessage || "",
    language: user.language || "en",
    showLastSeen: user.showLastSeen !== false,
    isAdmin: Boolean(user.isAdmin),
    isVerified: Boolean(user.isVerified),
    lastActiveAt: canShowLastSeen ? user.lastActiveAt || null : null,
    presenceStatus: user.presenceStatus || "offline",
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
    activeSessionCount: Array.isArray(user.activeSessions) ? user.activeSessions.length : 0,
    workspaceEnabled: user.workspaceEnabled !== false,
    workspaceRole: typeof user.getWorkspaceRole === "function" ? user.getWorkspaceRole() : user.workspaceRole || "manager",
    workspaceRoles:
      typeof user.getWorkspaceRoles === "function"
        ? user.getWorkspaceRoles()
        : Array.isArray(user.workspaceRoles) && user.workspaceRoles.length
          ? user.workspaceRoles
          : [],
    workspaceModules:
      typeof user.getWorkspaceModules === "function"
        ? user.getWorkspaceModules()
        : Array.isArray(user.workspaceModules) && user.workspaceModules.length
          ? user.workspaceModules
          : ["finance", "warehouse"]
  };
}

export function serializeMessage(message) {
  const isDeleted = Boolean(message.deletedAt);

  return {
    id: message._id.toString(),
    text: isDeleted ? "This message was deleted." : message.text,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    editedAt: message.editedAt,
    deletedAt: message.deletedAt,
    attachment: !isDeleted && message.attachment?.dataUrl
      ? {
          dataUrl: message.attachment.dataUrl,
          mimeType: message.attachment.mimeType,
          name: message.attachment.name,
          size: message.attachment.size
        }
      : null,
    isSnap: Boolean(message.isSnap),
    snapOpenedAt: message.snapOpenedAt,
    snapViewSeconds: message.snapViewSeconds || 0,
    linkPreview: !isDeleted && message.linkPreview?.url
      ? {
          url: message.linkPreview.url,
          domain: message.linkPreview.domain
        }
      : null,
    replyTo: message.replyTo
      ? {
          id: message.replyTo._id.toString(),
          text: message.replyTo.deletedAt ? "This message was deleted." : message.replyTo.text,
          senderName: message.replyTo.sender?.name || "",
          attachmentName: message.replyTo.attachment?.name || null
        }
      : null,
    forwardedFrom: message.forwardedFrom
      ? {
          id: message.forwardedFrom._id.toString(),
          name: message.forwardedFrom.name
        }
      : null,
    starredBy: (message.starredBy || []).map((entry) => entry.toString()),
    reactions: (message.reactions || []).map((reaction) => ({
      emoji: reaction.emoji,
      count: reaction.users.length,
      users: reaction.users.map((entry) => entry.toString())
    })),
    seenAt: message.seenAt,
    autoDeleteAt: message.autoDeleteAt,
    sender: serializeUser(message.sender),
    recipient: serializeUser(message.recipient)
  };
}

export function serializePdfReviewSession(session) {
  return {
    id: session._id.toString(),
    conversationKey: session.conversationKey,
    title: session.title || "",
    note: session.note || "",
    status: session.status,
    syncEnabled: Boolean(session.syncEnabled),
    viewerState: {
      page: Math.max(1, session.viewerState?.page || 1),
      zoom: Math.max(50, Math.min(200, session.viewerState?.zoom || 100))
    },
    file: {
      name: session.file?.name || "",
      mimeType: session.file?.mimeType || "application/pdf",
      size: session.file?.size || 0,
      dataUrl: session.file?.dataUrl || null,
      previewUrl: session.file?.publicUrl || null
    },
    acceptedAt: session.acceptedAt,
    expiresAt: session.expiresAt,
    endedAt: session.endedAt,
    fileDeletedAt: session.fileDeletedAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    initiator: serializeUser(session.initiator),
    participant: serializeUser(session.participant),
    presenterId: session.presenter?._id?.toString?.() || session.presenter?.toString?.() || null
  };
}

export function serializeMemoryCapsule(capsule, viewerId) {
  const resolvedViewerId = viewerId?.toString?.() || viewerId;
  const state = capsule.deletedAt
    ? "deleted"
    : capsule.openedAt
      ? "opened"
      : new Date(capsule.unlockAt).getTime() <= Date.now()
        ? "ready"
        : "sealed";
  const isGiftToViewer =
    capsule.privacyMode === "gift" &&
    capsule.participant?._id?.toString?.() === resolvedViewerId;
  const canReadOpenedNote =
    state === "opened" &&
    (capsule.privacyMode !== "gift" || isGiftToViewer);

  return {
    id: capsule._id.toString(),
    conversationKey: capsule.conversationKey,
    title: capsule.title || "",
    note: canReadOpenedNote ? capsule.note || "" : "",
    notePreview: state === "opened" ? (canReadOpenedNote ? capsule.note || "" : "Gift opened privately.") : "",
    tone: capsule.tone,
    openMode: capsule.openMode,
    privacyMode: capsule.privacyMode,
    retentionMode: capsule.retentionMode,
    unlockAt: capsule.unlockAt,
    unlockDate: capsule.unlockAt?.toISOString?.().slice(0, 10) || "",
    unlockTime: capsule.unlockAt?.toISOString?.().slice(11, 16) || "00:00",
    state,
    isReminderWindow:
      !capsule.openedAt &&
      !capsule.deletedAt &&
      new Date(capsule.unlockAt).getTime() - Date.now() <= 60 * 60 * 1000,
    attachment: capsule.attachment?.dataUrl
      ? {
          dataUrl: capsule.attachment.dataUrl,
          mimeType: capsule.attachment.mimeType,
          name: capsule.attachment.name,
          size: capsule.attachment.size || 0
        }
      : null,
    linkUrl: capsule.linkUrl || "",
    openRequestBy:
      capsule.openRequestBy?._id?.toString?.() || capsule.openRequestBy?.toString?.() || null,
    openRequestExpiresAt: capsule.openRequestExpiresAt,
    openedAt: capsule.openedAt,
    reminderNotifiedAt: capsule.reminderNotifiedAt,
    readyNotifiedAt: capsule.readyNotifiedAt,
    deletedAt: capsule.deletedAt,
    createdAt: capsule.createdAt,
    updatedAt: capsule.updatedAt,
    initiator: serializeUser(capsule.initiator),
    participant: serializeUser(capsule.participant),
    reactions: (capsule.reactions || []).map((reaction) => ({
      emoji: reaction.emoji,
      count: reaction.users.length,
      users: reaction.users.map((entry) => entry.toString())
    })),
    replies: (capsule.replies || []).map((reply) => ({
      id: reply._id?.toString?.() || `${reply.author?._id?.toString?.() || reply.author?.toString?.() || "reply"}-${reply.createdAt}`,
      text: reply.text,
      createdAt: reply.createdAt,
      author: serializeUser(reply.author)
    }))
  };
}
