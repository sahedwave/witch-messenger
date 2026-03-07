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
    activeSessionCount: Array.isArray(user.activeSessions) ? user.activeSessions.length : 0
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
