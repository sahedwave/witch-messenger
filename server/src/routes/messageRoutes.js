import express from "express";
import mongoose from "mongoose";

import { authMiddleware } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { Conversation } from "../models/Conversation.js";
import { Message } from "../models/Message.js";
import { User } from "../models/User.js";
import { writeAuditLog } from "../utils/audit.js";
import { buildConversationKey } from "../utils/conversationKey.js";
import {
  getConversationState,
  getOrCreateConversation,
  updateConversationSummary
} from "../utils/conversations.js";
import { serializeMessage, serializeUser } from "../utils/serializers.js";
import { validateAttachmentData } from "../utils/validation.js";

const router = express.Router();
const messageSendLimiter = createRateLimiter({
  prefix: "message-send",
  windowMs: 10 * 1000,
  max: 20,
  message: "You are sending messages too quickly. Please slow down for a moment."
});

router.use(authMiddleware);

function extractLinkPreview(text = "") {
  const match = text.match(/https?:\/\/[^\s]+/i);

  if (!match) {
    return null;
  }

  try {
    const url = new URL(match[0]);
    return {
      url: url.toString(),
      domain: url.hostname.replace(/^www\./, "")
    };
  } catch (error) {
    return null;
  }
}

function isConversationBlocked(conversation) {
  return conversation.blockedBy.length > 0;
}

async function populateMessage(messageId) {
  return Message.findById(messageId)
    .populate({
      path: "replyTo",
      populate: {
        path: "sender",
        select: "name"
      }
    })
    .populate("forwardedFrom", "name")
    .populate("sender", "name email avatarColor avatarUrl lastActiveAt presenceStatus")
    .populate("recipient", "name email avatarColor avatarUrl lastActiveAt presenceStatus");
}

async function populateConversation(conversationId) {
  return Conversation.findById(conversationId).populate({
    path: "lastMessage",
    populate: [
      { path: "sender", select: "name email avatarColor avatarUrl lastActiveAt presenceStatus" },
      {
        path: "recipient",
        select: "name email avatarColor avatarUrl lastActiveAt presenceStatus"
      }
    ]
  });
}

function serializeConversationUpdate(user, contact, conversation, unread) {
  return {
    ...serializeUser(contact, { viewerId: user._id }),
    unread,
    lastMessage: conversation?.lastMessage ? serializeMessage(conversation.lastMessage) : null,
    ...getConversationState(conversation, user._id, contact._id)
  };
}

async function emitConversationUpdates(io, conversationId, sender, recipient) {
  const conversation = await populateConversation(conversationId);

  io.to(sender._id.toString()).emit(
    "conversation:updated",
    serializeConversationUpdate(sender, recipient, conversation, undefined)
  );
  io.to(recipient._id.toString()).emit(
    "conversation:updated",
    serializeConversationUpdate(recipient, sender, conversation, undefined)
  );

  return conversation;
}

router.get("/:contactId", async (req, res) => {
  try {
    const { contactId } = req.params;
    const before = req.query.before;
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit || "20", 10), 1), 50);
    const search = req.query.q?.trim();
    const starredOnly = req.query.starred === "true";

    if (!mongoose.isValidObjectId(contactId)) {
      return res.status(400).json({ message: "Invalid contact id." });
    }

    const query = {
      conversationKey: buildConversationKey(req.userId, contactId)
    };

    if (before) {
      const beforeDate = new Date(before);
      if (!Number.isNaN(beforeDate.getTime())) {
        query.createdAt = { $lt: beforeDate };
      }
    }

    if (search) {
      query.text = { $regex: search, $options: "i" };
    }

    if (starredOnly) {
      query.starredBy = req.userId;
    }

    let messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .populate({
        path: "replyTo",
        populate: {
          path: "sender",
          select: "name"
        }
      })
      .populate("forwardedFrom", "name")
      .populate("sender", "name email avatarColor avatarUrl lastActiveAt presenceStatus")
      .populate("recipient", "name email avatarColor avatarUrl lastActiveAt presenceStatus");

    const hasMore = messages.length > limit;
    if (hasMore) {
      messages = messages.slice(0, limit);
    }

    messages = messages.reverse();

    return res.json({
      messages: messages.map(serializeMessage),
      hasMore,
      nextCursor: hasMore && messages[0] ? messages[0].createdAt : null
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load messages." });
  }
});

router.post("/:contactId", messageSendLimiter, async (req, res) => {
  try {
    const { contactId } = req.params;
    const text = req.body.text?.trim() || "";
    const attachment = req.body.attachment || null;
    const replyToId = req.body.replyToId || null;
    const forwardMessageId = req.body.forwardMessageId || null;
    const autoDeleteSeconds = Number.parseInt(req.body.autoDeleteSeconds || "0", 10);

    if (!mongoose.isValidObjectId(contactId)) {
      return res.status(400).json({ message: "Invalid contact id." });
    }

    const attachmentError = validateAttachmentData(attachment);
    if (attachmentError) {
      return res.status(400).json({ message: attachmentError });
    }

    if (!text && !attachment) {
      return res.status(400).json({ message: "Message text or an attachment is required." });
    }

    const recipient = await User.findById(contactId);
    if (!recipient) {
      return res.status(404).json({ message: "Contact not found." });
    }

    const conversation = await getOrCreateConversation(req.userId, contactId, {
      acceptedBy: contactId === req.userId.toString() ? [req.userId] : [req.userId]
    });
    if (isConversationBlocked(conversation)) {
      return res.status(403).json({ message: "This conversation is blocked." });
    }

    const senderAccepted = conversation.acceptedBy.some(
      (entry) => entry.toString() === req.userId.toString()
    );
    const recipientAccepted = conversation.acceptedBy.some(
      (entry) => entry.toString() === contactId.toString()
    );

    if (contactId !== req.userId.toString() && senderAccepted && !recipientAccepted) {
      const existingPendingMessage = await Message.findOne({
        conversationKey: conversation.conversationKey,
        sender: req.userId
      }).select("_id");

      if (existingPendingMessage) {
        return res.status(403).json({
          message: "Wait for this message request to be accepted before sending more."
        });
      }
    }

    let replyTo = null;
    if (replyToId) {
      if (!mongoose.isValidObjectId(replyToId)) {
        return res.status(400).json({ message: "Invalid reply target." });
      }

      replyTo = await Message.findById(replyToId);
      if (!replyTo || replyTo.conversationKey !== conversation.conversationKey) {
        return res.status(400).json({ message: "Reply target not found in this conversation." });
      }
    }

    let forwardMessage = null;
    if (forwardMessageId) {
      if (!mongoose.isValidObjectId(forwardMessageId)) {
        return res.status(400).json({ message: "Invalid forward target." });
      }

      forwardMessage = await Message.findById(forwardMessageId);
      if (!forwardMessage) {
        return res.status(404).json({ message: "Original message not found." });
      }
    }

    const nextText = forwardMessage ? forwardMessage.text || text : text;
    const nextAttachment = forwardMessage?.attachment?.dataUrl ? forwardMessage.attachment : attachment;

    const message = await Message.create({
      conversationKey: conversation.conversationKey,
      sender: req.userId,
      recipient: contactId,
      text: nextText,
      linkPreview: extractLinkPreview(nextText),
      replyTo: replyTo?._id || null,
      forwardedFrom: forwardMessage ? forwardMessage.sender : null,
      autoDeleteAt:
        autoDeleteSeconds > 0 ? new Date(Date.now() + Math.min(autoDeleteSeconds, 86400) * 1000) : null,
      attachment: nextAttachment
        ? {
            dataUrl: nextAttachment.dataUrl,
            mimeType: nextAttachment.mimeType,
            name: nextAttachment.name,
            size: nextAttachment.size
          }
        : undefined
    });

    await updateConversationSummary(conversation.conversationKey, message, { forceLatest: true });

    const populatedMessage = await populateMessage(message._id);
    const serialized = serializeMessage(populatedMessage);
    const io = req.app.get("io");
    const recipientMuted = conversation.mutedBy.some((entry) => entry.toString() === contactId);
    const recipientRestricted = conversation.restrictedBy.some(
      (entry) => entry.toString() === contactId
    );
    const recipientTrashed = conversation.trashedBy.some((entry) => entry.toString() === contactId);
    const recipientArchived = conversation.archivedBy.some(
      (entry) => entry.toString() === contactId
    );

    io.to(req.userId).emit("message:new", serialized);
    io.to(contactId).emit("message:new", serialized);
    await emitConversationUpdates(io, conversation._id, req.user, recipient);

    if (!recipientMuted && !recipientRestricted && !recipientTrashed && !recipientArchived) {
      io.to(contactId).emit("notification:new", {
        message: serialized,
        fromUserId: req.userId
      });
    }

    await writeAuditLog({
      actor: req.user._id,
      action: "message.send",
      targetId: message._id.toString(),
      targetType: "Message",
      metadata: {
        contactId,
        hasAttachment: Boolean(nextAttachment),
        replyToId,
        forwardMessageId
      }
    });

    return res.status(201).json(serialized);
  } catch (error) {
    return res.status(500).json({ message: "Unable to send message." });
  }
});

router.get("/:contactId/export", async (req, res) => {
  try {
    const { contactId } = req.params;

    if (!mongoose.isValidObjectId(contactId)) {
      return res.status(400).json({ message: "Invalid contact id." });
    }

    const messages = await Message.find({
      conversationKey: buildConversationKey(req.userId, contactId)
    })
      .sort({ createdAt: 1 })
      .populate({
        path: "replyTo",
        populate: {
          path: "sender",
          select: "name"
        }
      })
      .populate("forwardedFrom", "name")
      .populate("sender", "name email avatarColor avatarUrl lastActiveAt presenceStatus")
      .populate("recipient", "name email avatarColor avatarUrl lastActiveAt presenceStatus");

    return res.json({
      exportedAt: new Date(),
      messages: messages.map(serializeMessage)
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to export messages." });
  }
});

router.patch("/:messageId", async (req, res) => {
  try {
    const { messageId } = req.params;
    const text = req.body.text?.trim() || "";

    if (!mongoose.isValidObjectId(messageId)) {
      return res.status(400).json({ message: "Invalid message id." });
    }

    if (!text) {
      return res.status(400).json({ message: "Edited message text cannot be empty." });
    }

    const message = await Message.findById(messageId);

    if (!message) {
      return res.status(404).json({ message: "Message not found." });
    }

    if (message.sender.toString() !== req.userId.toString()) {
      return res.status(403).json({ message: "You can only edit your own messages." });
    }

    if (message.deletedAt) {
      return res.status(400).json({ message: "Deleted messages cannot be edited." });
    }

    message.text = text;
    message.editedAt = new Date();
    await message.save();
    await updateConversationSummary(message.conversationKey, message);

    const populatedMessage = await populateMessage(message._id);
    const serialized = serializeMessage(populatedMessage);
    const io = req.app.get("io");

    io.to(serialized.sender.id).emit("message:updated", serialized);
    io.to(serialized.recipient.id).emit("message:updated", serialized);

    await writeAuditLog({
      actor: req.user._id,
      action: "message.edit",
      targetId: message._id.toString(),
      targetType: "Message"
    });

    return res.json(serialized);
  } catch (error) {
    return res.status(500).json({ message: "Unable to edit message." });
  }
});

router.delete("/:messageId", async (req, res) => {
  try {
    const { messageId } = req.params;

    if (!mongoose.isValidObjectId(messageId)) {
      return res.status(400).json({ message: "Invalid message id." });
    }

    const message = await Message.findById(messageId);

    if (!message) {
      return res.status(404).json({ message: "Message not found." });
    }

    if (message.sender.toString() !== req.userId.toString()) {
      return res.status(403).json({ message: "You can only delete your own messages." });
    }

    if (message.deletedAt) {
      return res.status(400).json({ message: "Message already deleted." });
    }

    message.deletedAt = new Date();
    message.deletedBy = req.userId;
    message.text = "";
    message.attachment = {
      dataUrl: null,
      mimeType: null,
      name: null,
      size: 0
    };
    message.reactions = [];
    await message.save();
    await updateConversationSummary(message.conversationKey, message);

    const populatedMessage = await populateMessage(message._id);
    const serialized = serializeMessage(populatedMessage);
    const io = req.app.get("io");

    io.to(serialized.sender.id).emit("message:updated", serialized);
    io.to(serialized.recipient.id).emit("message:updated", serialized);

    await writeAuditLog({
      actor: req.user._id,
      action: "message.delete",
      targetId: message._id.toString(),
      targetType: "Message"
    });

    return res.json(serialized);
  } catch (error) {
    return res.status(500).json({ message: "Unable to delete message." });
  }
});

router.post("/:messageId/reactions", async (req, res) => {
  try {
    const { messageId } = req.params;
    const emoji = req.body.emoji?.trim();

    if (!mongoose.isValidObjectId(messageId)) {
      return res.status(400).json({ message: "Invalid message id." });
    }

    if (!emoji) {
      return res.status(400).json({ message: "Reaction emoji is required." });
    }

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: "Message not found." });
    }

    const isParticipant = [message.sender.toString(), message.recipient.toString()].includes(
      req.userId.toString()
    );

    if (!isParticipant || message.deletedAt) {
      return res.status(403).json({ message: "You cannot react to this message." });
    }

    message.toggleReaction(req.userId, emoji);
    await message.save();

    const populatedMessage = await populateMessage(message._id);
    const serialized = serializeMessage(populatedMessage);
    const io = req.app.get("io");

    io.to(serialized.sender.id).emit("message:updated", serialized);
    io.to(serialized.recipient.id).emit("message:updated", serialized);

    await writeAuditLog({
      actor: req.user._id,
      action: "message.react",
      targetId: message._id.toString(),
      targetType: "Message",
      metadata: { emoji }
    });

    return res.json(serialized);
  } catch (error) {
    return res.status(500).json({ message: "Unable to update reactions." });
  }
});

router.post("/:messageId/star", async (req, res) => {
  try {
    const { messageId } = req.params;

    if (!mongoose.isValidObjectId(messageId)) {
      return res.status(400).json({ message: "Invalid message id." });
    }

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: "Message not found." });
    }

    const isParticipant = [message.sender.toString(), message.recipient.toString()].includes(
      req.userId.toString()
    );

    if (!isParticipant) {
      return res.status(403).json({ message: "You cannot star this message." });
    }

    message.toggleStar(req.userId);
    await message.save();

    const populatedMessage = await populateMessage(message._id);
    const serialized = serializeMessage(populatedMessage);
    const io = req.app.get("io");

    io.to(serialized.sender.id).emit("message:updated", serialized);
    io.to(serialized.recipient.id).emit("message:updated", serialized);

    return res.json(serialized);
  } catch (error) {
    return res.status(500).json({ message: "Unable to update star state." });
  }
});

router.post("/:messageId/pin", async (req, res) => {
  try {
    const { messageId } = req.params;

    if (!mongoose.isValidObjectId(messageId)) {
      return res.status(400).json({ message: "Invalid message id." });
    }

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: "Message not found." });
    }

    const conversation = await Conversation.findOne({ conversationKey: message.conversationKey });
    if (!conversation || !conversation.participants.some((entry) => entry.toString() === req.userId.toString())) {
      return res.status(403).json({ message: "You cannot pin this message." });
    }

    const exists = conversation.pinnedMessages.some((entry) => entry.toString() === messageId);
    conversation.pinnedMessages = exists
      ? conversation.pinnedMessages.filter((entry) => entry.toString() !== messageId)
      : [message._id, ...conversation.pinnedMessages].slice(0, 3);
    await conversation.save();

    return res.json({
      pinnedMessageIds: conversation.pinnedMessages.map((entry) => entry.toString())
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to pin this message." });
  }
});

router.post("/:contactId/seen", async (req, res) => {
  try {
    const { contactId } = req.params;

    if (!mongoose.isValidObjectId(contactId)) {
      return res.status(400).json({ message: "Invalid contact id." });
    }

    const seenAt = new Date();
    const pendingMessages = await Message.find({
      conversationKey: buildConversationKey(req.userId, contactId),
      sender: contactId,
      recipient: req.userId,
      seenAt: null,
      deletedAt: null
    }).select("_id");

    if (pendingMessages.length === 0) {
      return res.json({ updatedIds: [], seenAt: null });
    }

    const updatedIds = pendingMessages.map((message) => message._id);

    await Message.updateMany(
      { _id: { $in: updatedIds } },
      { $set: { seenAt } }
    );

    const serializedIds = updatedIds.map((id) => id.toString());
    const io = req.app.get("io");

    io.to(req.userId).emit("conversation:seen", {
      contactId,
      seenAt,
      messageIds: serializedIds,
      viewerId: req.userId
    });
    io.to(contactId).emit("conversation:seen", {
      contactId: req.userId,
      seenAt,
      messageIds: serializedIds,
      viewerId: req.userId
    });

    return res.json({ updatedIds: serializedIds, seenAt });
  } catch (error) {
    return res.status(500).json({ message: "Unable to update seen status." });
  }
});

export default router;
