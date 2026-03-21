import express from "express";
import mongoose from "mongoose";

import { authMiddleware } from "../middleware/auth.js";
import { Conversation } from "../models/Conversation.js";
import { Message } from "../models/Message.js";
import { User } from "../models/User.js";
import { writeAuditLog } from "../utils/audit.js";
import { buildConversationKey } from "../utils/conversationKey.js";
import {
  addPushSubscriptionToUser,
  getPushPublicKey,
  removePushSubscriptionFromUser
} from "../utils/pushNotifications.js";
import {
  clearConversationShelves,
  getConversationState,
  getOrCreateConversation,
  setConversationArrayPreference,
  setConversationMembership,
  setConversationStringPreference
} from "../utils/conversations.js";
import { serializeMessage, serializeUser } from "../utils/serializers.js";

const router = express.Router();
const allowedImageTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
const maxAvatarBytes = 512 * 1024;

router.use(authMiddleware);

function serializeContact(user, conversation, currentUserId, presenceStore, lastMessage, unreadCount) {
  const presence = presenceStore?.get(user._id.toString());
  const baseUser = serializeUser(user, { viewerId: currentUserId });

  return {
    ...baseUser,
    displayName:
      getConversationState(conversation, currentUserId, user._id).nickname || baseUser.name,
    deviceCount: presence?.deviceCount || 0,
    presenceStatus: presence?.status || baseUser.presenceStatus || "offline",
    lastActiveAt: baseUser.showLastSeen ? presence?.lastActiveAt || baseUser.lastActiveAt || null : null,
    unread: unreadCount,
    lastMessage: lastMessage ? serializeMessage(lastMessage) : null,
    ...getConversationState(conversation, currentUserId, user._id)
  };
}

router.get("/", async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.userId } }).sort({ name: 1 });
    const conversations = await Conversation.find({
      participants: req.userId
    }).populate({
      path: "lastMessage",
      populate: [
        { path: "sender", select: "name email avatarColor avatarUrl lastActiveAt presenceStatus" },
        {
          path: "recipient",
          select: "name email avatarColor avatarUrl lastActiveAt presenceStatus"
        }
      ]
    });
    const unreadMessages = await Message.find({
      recipient: req.userId,
      seenAt: null,
      deletedAt: null
    }).select("sender");

    const presenceStore = req.app.get("presenceStore");
    const conversationByUserId = new Map();
    const unreadCountByUserId = new Map();

    conversations.forEach((conversation) => {
      const otherUserId = conversation.participants.find(
        (participant) => participant.toString() !== req.userId.toString()
      )?.toString();

      if (!otherUserId) {
        return;
      }

      conversationByUserId.set(otherUserId, conversation);
    });

    unreadMessages.forEach((message) => {
      const key = message.sender.toString();
      unreadCountByUserId.set(key, (unreadCountByUserId.get(key) || 0) + 1);
    });

    const contacts = users.map((user) => {
        const conversation = conversationByUserId.get(user._id.toString());
        return serializeContact(
          user,
          conversation,
          req.userId,
          presenceStore,
          conversation?.lastMessage || null,
          unreadCountByUserId.get(user._id.toString()) || 0
        );
      });

    const selfConversation =
      (await Conversation.findOne({
        conversationKey: buildConversationKey(req.userId, req.userId)
      }).populate({
        path: "lastMessage",
        populate: [
          { path: "sender", select: "name email avatarColor avatarUrl lastActiveAt presenceStatus" },
          {
            path: "recipient",
            select: "name email avatarColor avatarUrl lastActiveAt presenceStatus"
          }
        ]
      })) || null;
    contacts.unshift({
      ...serializeContact(
        req.user,
        selfConversation,
        req.userId,
        presenceStore,
        selfConversation?.lastMessage || null,
        0
      ),
      isSelf: true,
      requestState: "accepted",
      displayName: "Notes to self"
    });

    return res.json(contacts);
  } catch (error) {
    return res.status(500).json({ message: "Unable to load contacts." });
  }
});

router.patch("/me/profile", async (req, res) => {
  try {
    const name = req.body.name?.trim();
    const statusMessage =
      typeof req.body.statusMessage === "string" ? req.body.statusMessage.trim() : undefined;
    const showLastSeen =
      typeof req.body.showLastSeen === "boolean" ? req.body.showLastSeen : undefined;
    const language = req.body.language;

    if (typeof name === "string" && name) {
      req.user.name = name.slice(0, 40);
    }

    if (typeof statusMessage === "string") {
      req.user.statusMessage = statusMessage.slice(0, 120);
    }

    if (typeof showLastSeen === "boolean") {
      req.user.showLastSeen = showLastSeen;
    }

    if (["en", "bn"].includes(language)) {
      req.user.language = language;
    }

    await req.user.save();

    await writeAuditLog({
      actor: req.user._id,
      action: "user.profile.update",
      targetId: req.user._id.toString(),
      targetType: "User",
      metadata: {
        changed: {
          name: Boolean(name),
          statusMessage: typeof statusMessage === "string",
          showLastSeen: typeof showLastSeen === "boolean",
          language: ["en", "bn"].includes(language)
        }
      }
    });

    return res.json({ user: serializeUser(req.user, { viewerId: req.userId }) });
  } catch (error) {
    return res.status(500).json({ message: "Unable to update profile." });
  }
});

router.get("/me/push-config", async (_req, res) => {
  return res.json({
    publicKey: getPushPublicKey()
  });
});

router.post("/me/push-subscriptions", async (req, res) => {
  try {
    await addPushSubscriptionToUser(req.user, req.body.subscription, {
      userAgent: req.get("user-agent") || ""
    });

    return res.status(201).json({ ok: true });
  } catch (error) {
    return res.status(400).json({ message: error.message || "Unable to save push subscription." });
  }
});

router.delete("/me/push-subscriptions", async (req, res) => {
  try {
    const endpoint = req.body.endpoint;

    if (!endpoint) {
      return res.status(400).json({ message: "Subscription endpoint is required." });
    }

    await removePushSubscriptionFromUser(req.user, endpoint);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ message: "Unable to remove push subscription." });
  }
});

router.patch("/:contactId/preferences", async (req, res) => {
  try {
    const { contactId } = req.params;

    if (!mongoose.isValidObjectId(contactId)) {
      return res.status(400).json({ message: "Invalid contact id." });
    }

    if (contactId === req.userId.toString()) {
      return res.status(400).json({ message: "You cannot update preferences for yourself." });
    }

    const contact = await User.findById(contactId);
    if (!contact) {
      return res.status(404).json({ message: "Contact not found." });
    }

    const conversation = await getOrCreateConversation(req.userId, contactId, {
      acceptedBy: [req.userId, contactId]
    });
    const preferenceEntries = [
      ["isPinned", "pinnedBy"],
      ["isFavorite", "favoriteBy"],
      ["isMuted", "mutedBy"],
      ["isBlocked", "blockedBy"]
    ];

    for (const [requestKey, documentKey] of preferenceEntries) {
      if (typeof req.body[requestKey] !== "boolean") {
        continue;
      }

      setConversationMembership(conversation, documentKey, req.userId, req.body[requestKey]);
    }

    if (req.body.acceptRequest === true) {
      setConversationMembership(conversation, "acceptedBy", req.userId, true);
      clearConversationShelves(conversation, req.userId);
    }

    const shelfEntries = [
      ["isArchived", "archivedBy"],
      ["isTrashed", "trashedBy"],
      ["isRestricted", "restrictedBy"]
    ];

    for (const [requestKey, documentKey] of shelfEntries) {
      if (typeof req.body[requestKey] !== "boolean") {
        continue;
      }

      if (req.body[requestKey]) {
        clearConversationShelves(conversation, req.userId, documentKey);
      }

      setConversationMembership(conversation, documentKey, req.userId, req.body[requestKey]);
    }

    if (typeof req.body.nickname === "string") {
      setConversationStringPreference(conversation, "nicknames", req.userId, req.body.nickname.trim().slice(0, 40));
    }

    if (Array.isArray(req.body.labels)) {
      setConversationArrayPreference(
        conversation,
        "labels",
        req.userId,
        req.body.labels.map((label) => `${label}`.trim().slice(0, 20)).filter(Boolean).slice(0, 5)
      );
    }

    await conversation.save();

    const populatedConversation = await Conversation.findById(conversation._id).populate({
      path: "lastMessage",
      populate: [
        { path: "sender", select: "name email avatarColor avatarUrl lastActiveAt presenceStatus" },
        {
          path: "recipient",
          select: "name email avatarColor avatarUrl lastActiveAt presenceStatus"
        }
      ]
    });
    const io = req.app.get("io");
    const presenceStore = req.app.get("presenceStore");
    io.to(req.userId.toString()).emit(
      "conversation:updated",
      serializeContact(
        contact,
        populatedConversation,
        req.userId,
        presenceStore,
        populatedConversation?.lastMessage || null,
        undefined
      )
    );
    io.to(contactId.toString()).emit(
      "conversation:updated",
      serializeContact(
        req.user,
        populatedConversation,
        contactId,
        presenceStore,
        populatedConversation?.lastMessage || null,
        undefined
      )
    );

    await writeAuditLog({
      actor: req.user._id,
      action: "conversation.preferences.update",
      targetId: conversation._id.toString(),
      targetType: "Conversation",
      metadata: {
        contactId,
        changes: req.body
      }
    });

    return res.json(
      serializeContact(
        contact,
        populatedConversation,
        req.userId,
        presenceStore,
        populatedConversation?.lastMessage || null,
        undefined
      )
    );
  } catch (error) {
    return res.status(500).json({ message: "Unable to update conversation preferences." });
  }
});

router.post("/avatar", async (req, res) => {
  try {
    const imageData = req.body.imageData;

    if (typeof imageData !== "string" || !imageData.startsWith("data:image/")) {
      return res.status(400).json({ message: "Please upload a PNG, JPG, or WEBP image." });
    }

    const [metadata, base64Payload] = imageData.split(",");
    const mimeType = metadata.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64$/)?.[1];

    if (!mimeType || !allowedImageTypes.includes(mimeType)) {
      return res.status(400).json({ message: "Only PNG, JPG, and WEBP images are supported." });
    }

    const byteLength = Buffer.byteLength(base64Payload || "", "base64");
    if (byteLength > maxAvatarBytes) {
      return res.status(400).json({ message: "Profile pictures must be 512 KB or smaller." });
    }

    req.user.avatarUrl = imageData;
    await req.user.save();

    await writeAuditLog({
      actor: req.user._id,
      action: "user.avatar.update",
      targetId: req.user._id.toString(),
      targetType: "User"
    });

    return res.json({ user: serializeUser(req.user) });
  } catch (error) {
    return res.status(500).json({ message: "Unable to update your profile picture." });
  }
});

export default router;
