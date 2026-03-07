import { Conversation } from "../models/Conversation.js";
import { buildConversationKey } from "./conversationKey.js";

function hasUser(entries = [], userId) {
  return entries.some((entry) => entry.toString() === userId.toString());
}

function findUserScopedValue(entries = [], userId, fallbackValue) {
  const match = entries.find((entry) => entry.user?.toString() === userId.toString());
  return match ? fallbackValue(match) : null;
}

export function getConversationState(conversation, viewerId, otherUserId) {
  const acceptedByViewer = hasUser(conversation?.acceptedBy, viewerId);
  const acceptedByOtherUser = hasUser(conversation?.acceptedBy, otherUserId);

  let requestState = "accepted";
  if (conversation) {
    if (acceptedByViewer && !acceptedByOtherUser) {
      requestState = "sent";
    } else if (!acceptedByViewer && acceptedByOtherUser) {
      requestState = "pending";
    } else if (!acceptedByViewer && !acceptedByOtherUser) {
      requestState = "pending";
    }
  }

  return {
    requestState,
    isPinned: hasUser(conversation?.pinnedBy, viewerId),
    isFavorite: hasUser(conversation?.favoriteBy, viewerId),
    isMuted: hasUser(conversation?.mutedBy, viewerId),
    isArchived: hasUser(conversation?.archivedBy, viewerId),
    isTrashed: hasUser(conversation?.trashedBy, viewerId),
    isRestricted: hasUser(conversation?.restrictedBy, viewerId),
    isBlocked: hasUser(conversation?.blockedBy, viewerId),
    hasBlockedYou: hasUser(conversation?.blockedBy, otherUserId),
    nickname: findUserScopedValue(conversation?.nicknames, viewerId, (entry) => entry.value || ""),
    labels: findUserScopedValue(conversation?.labels, viewerId, (entry) => entry.values || []),
    pinnedMessageIds: (conversation?.pinnedMessages || []).map((entry) => entry.toString?.() || entry)
  };
}

export function setConversationMembership(conversation, key, userId, shouldContain) {
  const currentValues = conversation[key].map((entry) => entry.toString());
  const normalizedUserId = userId.toString();

  if (shouldContain && !currentValues.includes(normalizedUserId)) {
    conversation[key].push(userId);
  }

  if (!shouldContain) {
    conversation[key] = conversation[key].filter(
      (entry) => entry.toString() !== normalizedUserId
    );
  }
}

export function clearConversationShelves(conversation, userId, exceptKey = null) {
  ["archivedBy", "trashedBy", "restrictedBy"].forEach((key) => {
    if (key === exceptKey) {
      return;
    }

    setConversationMembership(conversation, key, userId, false);
  });
}

export function setConversationStringPreference(conversation, key, userId, value) {
  const existing = conversation[key].find((entry) => entry.user.toString() === userId.toString());

  if (!value) {
    conversation[key] = conversation[key].filter((entry) => entry.user.toString() !== userId.toString());
    return;
  }

  if (existing) {
    existing.value = value;
    return;
  }

  conversation[key].push({ user: userId, value });
}

export function setConversationArrayPreference(conversation, key, userId, values) {
  const normalizedValues = values.filter(Boolean);
  const existing = conversation[key].find((entry) => entry.user.toString() === userId.toString());

  if (normalizedValues.length === 0) {
    conversation[key] = conversation[key].filter((entry) => entry.user.toString() !== userId.toString());
    return;
  }

  if (existing) {
    existing.values = normalizedValues;
    return;
  }

  conversation[key].push({ user: userId, values: normalizedValues });
}

export async function getOrCreateConversation(userA, userB, createDefaults = {}) {
  const conversationKey = buildConversationKey(userA, userB);

  let conversation = await Conversation.findOne({ conversationKey });

  if (!conversation) {
    conversation = await Conversation.create({
      conversationKey,
      participants: [userA, userB],
      ...createDefaults
    });
  }

  return conversation;
}

export async function updateConversationSummary(conversationKey, message, options = {}) {
  const preview = message.deletedAt
    ? "Message deleted"
    : message.attachment?.name || message.text || "Attachment";

  if (!options.forceLatest) {
    const existingConversation = await Conversation.findOne({ conversationKey }).select("lastMessage");

    if (
      existingConversation?.lastMessage &&
      existingConversation.lastMessage.toString() !== message._id.toString()
    ) {
      return existingConversation;
    }
  }

  await Conversation.findOneAndUpdate(
    { conversationKey },
    {
      $set: {
        lastMessage: message._id,
        lastMessagePreview: preview,
        lastMessageAt: message.createdAt || new Date()
      }
    },
    { new: true }
  );
}
