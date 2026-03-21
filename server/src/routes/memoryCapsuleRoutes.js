import express from "express";
import mongoose from "mongoose";

import { authMiddleware } from "../middleware/auth.js";
import { MemoryCapsule } from "../models/MemoryCapsule.js";
import { User } from "../models/User.js";
import { buildConversationKey } from "../utils/conversationKey.js";
import { getOrCreateConversation } from "../utils/conversations.js";
import { serializeMemoryCapsule } from "../utils/serializers.js";

const router = express.Router();
const TOGETHER_OPEN_WINDOW_MS = 60 * 1000;
const AUTO_DELETE_AFTER_OPEN_MS = 24 * 60 * 60 * 1000;
const CAPSULE_ATTACHMENT_LIMIT = 8 * 1024 * 1024;
const CAPSULE_REACTION_EMOJIS = ["❤️", "✨", "🥹", "🤍", "🫶"];

router.use(authMiddleware);

function isParticipant(capsule, userId) {
  return (
    capsule.initiator?._id?.toString?.() === userId.toString() ||
    capsule.initiator?.toString?.() === userId.toString() ||
    capsule.participant?._id?.toString?.() === userId.toString() ||
    capsule.participant?.toString?.() === userId.toString()
  );
}

function getCapsuleState(capsule) {
  if (capsule.deletedAt) {
    return "deleted";
  }

  if (capsule.openedAt) {
    return "opened";
  }

  return new Date(capsule.unlockAt).getTime() <= Date.now() ? "ready" : "sealed";
}

function validateCapsuleAttachment(file = null) {
  if (!file) {
    return null;
  }

  const allowedMimeTypes = [
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "application/pdf",
    "text/plain",
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "video/mp4"
  ];

  const { dataUrl, mimeType, name, size } = file;

  if (!dataUrl || !mimeType || !name) {
    return "Capsule attachment data is incomplete.";
  }

  if (!allowedMimeTypes.includes(mimeType)) {
    return "Capsules support images, PDF, TXT, MP3/WAV audio, and MP4 video.";
  }

  if (!/^data:[a-z0-9/+.-]+;base64,/i.test(dataUrl)) {
    return "Capsule attachment encoding is invalid.";
  }

  if (name.length > 120) {
    return "Capsule attachment names must be 120 characters or fewer.";
  }

  if (size > CAPSULE_ATTACHMENT_LIMIT) {
    return "Capsule attachments must be 8 MB or smaller.";
  }

  return null;
}

function validateLinkUrl(value = "") {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) {
      return "Capsule links must use HTTP or HTTPS.";
    }
    return null;
  } catch {
    return "Capsule link is invalid.";
  }
}

async function populateCapsule(capsuleId) {
  return MemoryCapsule.findById(capsuleId)
    .populate("initiator", "name email avatarColor avatarUrl lastActiveAt presenceStatus")
    .populate("participant", "name email avatarColor avatarUrl lastActiveAt presenceStatus")
    .populate("openRequestBy", "name email avatarColor avatarUrl lastActiveAt presenceStatus")
    .populate("replies.author", "name email avatarColor avatarUrl lastActiveAt presenceStatus");
}

async function expireCapsuleIfNeeded(capsule) {
  if (!capsule || !capsule.deletedAt) {
    return capsule;
  }

  if (new Date(capsule.deletedAt).getTime() > Date.now()) {
    return capsule;
  }

  await MemoryCapsule.deleteOne({ _id: capsule._id });
  return null;
}

async function normalizeCapsule(capsule) {
  if (!capsule) {
    return capsule;
  }

  const expiredCapsule = await expireCapsuleIfNeeded(capsule);
  if (!expiredCapsule) {
    return null;
  }

  if (
    capsule.openRequestExpiresAt &&
    new Date(capsule.openRequestExpiresAt).getTime() <= Date.now()
  ) {
    capsule.openRequestBy = null;
    capsule.openRequestExpiresAt = null;
    await capsule.save();
  }

  return capsule;
}

async function expireCapsulesForConversation(conversationKey) {
  const candidates = await MemoryCapsule.find({
    conversationKey,
    deletedAt: { $ne: null }
  });

  if (!candidates.length) {
    return;
  }

  await Promise.all(candidates.map((capsule) => expireCapsuleIfNeeded(capsule)));
}

function emitCapsuleChange(io, capsule, action) {
  const initiatorId = capsule.initiator._id.toString();
  const participantId = capsule.participant._id.toString();

  io.to(initiatorId).emit("memory-capsule:changed", {
    action,
    capsuleId: capsule._id.toString(),
    contactId: participantId,
    title: capsule.title || "Memory capsule",
    state: getCapsuleState(capsule)
  });

  io.to(participantId).emit("memory-capsule:changed", {
    action,
    capsuleId: capsule._id.toString(),
    contactId: initiatorId,
    title: capsule.title || "Memory capsule",
    state: getCapsuleState(capsule)
  });
}

router.get("/:contactId", async (req, res) => {
  try {
    const { contactId } = req.params;

    if (!mongoose.isValidObjectId(contactId)) {
      return res.status(400).json({ message: "Invalid contact id." });
    }

    const conversationKey = buildConversationKey(req.userId, contactId);
    await expireCapsulesForConversation(conversationKey);
    const rawCapsules = await MemoryCapsule.find({
      conversationKey,
      $or: [{ deletedAt: null }, { deletedAt: { $gt: new Date() } }]
    })
      .sort({ createdAt: -1 })
      .limit(30)
      .populate("initiator", "name email avatarColor avatarUrl lastActiveAt presenceStatus")
      .populate("participant", "name email avatarColor avatarUrl lastActiveAt presenceStatus")
      .populate("openRequestBy", "name email avatarColor avatarUrl lastActiveAt presenceStatus")
      .populate("replies.author", "name email avatarColor avatarUrl lastActiveAt presenceStatus");
    const capsules = (await Promise.all(rawCapsules.map((capsule) => normalizeCapsule(capsule)))).filter(Boolean);

    return res.json({
      capsules: capsules.map((capsule) => serializeMemoryCapsule(capsule, req.userId))
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load memory capsules." });
  }
});

router.post("/:contactId", async (req, res) => {
  try {
    const { contactId } = req.params;
    const title = req.body.title?.trim() || "";
    const note = req.body.note?.trim() || "";
    const tone = req.body.tone || "warm";
    const openMode = req.body.openMode || "solo";
    const privacyMode = req.body.privacyMode || "shared";
    const retentionMode = req.body.retentionMode || "archive";
    const unlockAt = req.body.unlockAt ? new Date(req.body.unlockAt) : null;
    const attachment = req.body.attachment || null;
    const linkUrl = req.body.linkUrl?.trim() || "";

    if (!mongoose.isValidObjectId(contactId)) {
      return res.status(400).json({ message: "Invalid contact id." });
    }

    if (!unlockAt || Number.isNaN(unlockAt.getTime())) {
      return res.status(400).json({ message: "Capsule opening time is invalid." });
    }

    if (title.length > 120) {
      return res.status(400).json({ message: "Capsule titles must be 120 characters or fewer." });
    }

    if (note.length > 2000) {
      return res.status(400).json({ message: "Capsule note must be 2000 characters or fewer." });
    }

    if (!["warm", "playful", "future", "promise"].includes(tone)) {
      return res.status(400).json({ message: "Capsule tone is invalid." });
    }

    if (!["solo", "together"].includes(openMode)) {
      return res.status(400).json({ message: "Capsule opening mode is invalid." });
    }

    if (!["shared", "gift", "mutual"].includes(privacyMode)) {
      return res.status(400).json({ message: "Capsule privacy mode is invalid." });
    }

    if (!["archive", "auto-delete"].includes(retentionMode)) {
      return res.status(400).json({ message: "Capsule retention mode is invalid." });
    }

    const attachmentError = validateCapsuleAttachment(attachment);
    if (attachmentError) {
      return res.status(400).json({ message: attachmentError });
    }

    const linkError = validateLinkUrl(linkUrl);
    if (linkError) {
      return res.status(400).json({ message: linkError });
    }

    if (!note && !attachment && !linkUrl) {
      return res.status(400).json({ message: "Capsules need a note, attachment, or link." });
    }

    const recipient = await User.findById(contactId);
    if (!recipient) {
      return res.status(404).json({ message: "Contact not found." });
    }

    const conversation = await getOrCreateConversation(req.userId, contactId, {
      acceptedBy: contactId === req.userId.toString() ? [req.userId] : [req.userId]
    });

    const blockedUserIds = new Set((conversation.blockedBy || []).map((entry) => entry.toString()));
    if (blockedUserIds.has(req.userId.toString()) || blockedUserIds.has(contactId.toString())) {
      return res.status(403).json({ message: "This conversation is blocked." });
    }

    const capsule = await MemoryCapsule.create({
      conversationKey: conversation.conversationKey,
      initiator: req.userId,
      participant: contactId,
      title,
      note,
      tone,
      openMode,
      privacyMode,
      retentionMode,
      unlockAt,
      attachment,
      linkUrl
    });

    const populatedCapsule = await populateCapsule(capsule._id);
    emitCapsuleChange(req.app.get("io"), populatedCapsule, "created");

    return res.status(201).json({
      capsule: serializeMemoryCapsule(populatedCapsule, req.userId)
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to create memory capsule." });
  }
});

router.patch("/:capsuleId", async (req, res) => {
  try {
    const { capsuleId } = req.params;
    const action = req.body.action;

    if (!mongoose.isValidObjectId(capsuleId)) {
      return res.status(400).json({ message: "Invalid memory capsule id." });
    }

    const capsule = await populateCapsule(capsuleId);
    if (!capsule || !isParticipant(capsule, req.userId)) {
      return res.status(404).json({ message: "Memory capsule not found." });
    }

    const normalizedCapsule = await normalizeCapsule(capsule);
    if (!normalizedCapsule) {
      return res.status(404).json({ message: "Memory capsule not found." });
    }

    const state = getCapsuleState(normalizedCapsule);

    if (action === "edit") {
      if (capsule.initiator._id.toString() !== req.userId.toString()) {
        return res.status(403).json({ message: "Only the creator can edit this capsule." });
      }

      if (state === "opened") {
        return res.status(400).json({ message: "Opened capsules can no longer be edited." });
      }

      const title = req.body.title?.trim() || "";
      const note = req.body.note?.trim() || "";
      const tone = req.body.tone || "warm";
      const openMode = req.body.openMode || "solo";
      const privacyMode = req.body.privacyMode || "shared";
      const retentionMode = req.body.retentionMode || "archive";
      const unlockAt = req.body.unlockAt ? new Date(req.body.unlockAt) : null;
      const attachment = req.body.attachment || null;
      const linkUrl = req.body.linkUrl?.trim() || "";

      if (!unlockAt || Number.isNaN(unlockAt.getTime())) {
        return res.status(400).json({ message: "Capsule opening time is invalid." });
      }

      const attachmentError = validateCapsuleAttachment(attachment);
      if (attachmentError) {
        return res.status(400).json({ message: attachmentError });
      }

      const linkError = validateLinkUrl(linkUrl);
      if (linkError) {
        return res.status(400).json({ message: linkError });
      }

      capsule.title = title;
      capsule.note = note;
      capsule.tone = tone;
      capsule.openMode = openMode;
      capsule.privacyMode = privacyMode;
      capsule.retentionMode = retentionMode;
      capsule.unlockAt = unlockAt;
      capsule.attachment = attachment;
      capsule.linkUrl = linkUrl;
      capsule.openRequestBy = null;
      capsule.openRequestExpiresAt = null;
      await capsule.save();

      const updatedCapsule = await populateCapsule(capsule._id);
      emitCapsuleChange(req.app.get("io"), updatedCapsule, "updated");
      return res.json({
        capsule: serializeMemoryCapsule(updatedCapsule, req.userId)
      });
    }

    if (action === "open") {
      if (state === "opened") {
        return res.status(400).json({ message: "This capsule is already open." });
      }

      if (state === "sealed") {
        return res.status(400).json({ message: "This capsule is still sealed." });
      }

      if (capsule.openMode === "together") {
        const requestExpired =
          capsule.openRequestExpiresAt && new Date(capsule.openRequestExpiresAt).getTime() <= Date.now();

        if (requestExpired) {
          capsule.openRequestBy = null;
          capsule.openRequestExpiresAt = null;
        }

        if (!capsule.openRequestBy) {
          capsule.openRequestBy = req.userId;
          capsule.openRequestExpiresAt = new Date(Date.now() + TOGETHER_OPEN_WINDOW_MS);
          await capsule.save();
          const requestedCapsule = await populateCapsule(capsule._id);
          emitCapsuleChange(req.app.get("io"), requestedCapsule, "open-requested");
          return res.json({
            capsule: serializeMemoryCapsule(requestedCapsule, req.userId)
          });
        }

        if (capsule.openRequestBy.toString() === req.userId.toString()) {
          capsule.openRequestBy = null;
          capsule.openRequestExpiresAt = null;
          await capsule.save();
          const resetCapsule = await populateCapsule(capsule._id);
          emitCapsuleChange(req.app.get("io"), resetCapsule, "open-request-cancelled");
          return res.json({
            capsule: serializeMemoryCapsule(resetCapsule, req.userId)
          });
        }
      }

      capsule.openedAt = new Date();
      capsule.openRequestBy = null;
      capsule.openRequestExpiresAt = null;
      if (capsule.retentionMode === "auto-delete") {
        capsule.deletedAt = new Date(Date.now() + AUTO_DELETE_AFTER_OPEN_MS);
      }
      await capsule.save();

      const openedCapsule = await populateCapsule(capsule._id);
      emitCapsuleChange(req.app.get("io"), openedCapsule, "opened");
      return res.json({
        capsule: serializeMemoryCapsule(openedCapsule, req.userId)
      });
    }

    if (action === "react") {
      const emoji = req.body.emoji;

      if (!CAPSULE_REACTION_EMOJIS.includes(emoji)) {
        return res.status(400).json({ message: "Capsule reaction is invalid." });
      }

      if (state !== "opened") {
        return res.status(400).json({ message: "Capsules can only be reacted to after opening." });
      }

      const existingReaction = capsule.reactions.find((entry) => entry.emoji === emoji);

      if (!existingReaction) {
        capsule.reactions.push({
          emoji,
          users: [req.userId]
        });
      } else {
        const alreadyReacted = existingReaction.users.some(
          (entry) => entry.toString() === req.userId.toString()
        );

        if (alreadyReacted) {
          existingReaction.users = existingReaction.users.filter(
            (entry) => entry.toString() !== req.userId.toString()
          );
        } else {
          existingReaction.users.push(req.userId);
        }
      }

      capsule.reactions = capsule.reactions.filter((entry) => entry.users.length > 0);
      await capsule.save();
      const updatedCapsule = await populateCapsule(capsule._id);
      emitCapsuleChange(req.app.get("io"), updatedCapsule, "reacted");
      return res.json({
        capsule: serializeMemoryCapsule(updatedCapsule, req.userId)
      });
    }

    if (action === "reply") {
      const text = req.body.text?.trim() || "";

      if (!text) {
        return res.status(400).json({ message: "Reply text is required." });
      }

      if (state !== "opened") {
        return res.status(400).json({ message: "Replies unlock after the capsule opens." });
      }

      capsule.replies.push({
        author: req.userId,
        text
      });
      await capsule.save();
      const updatedCapsule = await populateCapsule(capsule._id);
      emitCapsuleChange(req.app.get("io"), updatedCapsule, "replied");
      return res.json({
        capsule: serializeMemoryCapsule(updatedCapsule, req.userId)
      });
    }

    if (action === "delete") {
      capsule.deletedAt = new Date();
      await capsule.save();
      emitCapsuleChange(req.app.get("io"), capsule, "deleted");
      return res.json({
        capsule: serializeMemoryCapsule(capsule, req.userId)
      });
    }

    return res.status(400).json({ message: "Unsupported memory capsule action." });
  } catch (error) {
    return res.status(500).json({ message: "Unable to update memory capsule." });
  }
});

export default router;
