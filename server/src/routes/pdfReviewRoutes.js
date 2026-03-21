import express from "express";
import mongoose from "mongoose";

import { authMiddleware } from "../middleware/auth.js";
import { PdfReviewSession } from "../models/PdfReviewSession.js";
import { User } from "../models/User.js";
import { buildConversationKey } from "../utils/conversationKey.js";
import { getOrCreateConversation } from "../utils/conversations.js";
import { deletePdfReviewFile, writePdfReviewFile } from "../utils/pdfReviewStorage.js";
import { serializePdfReviewSession } from "../utils/serializers.js";

const router = express.Router();
const REVIEW_AUTO_DELETE_MS = 24 * 60 * 60 * 1000;

router.use(authMiddleware);

function isParticipant(session, userId) {
  return (
    session.initiator?._id?.toString?.() === userId.toString() ||
    session.initiator?.toString?.() === userId.toString() ||
    session.participant?._id?.toString?.() === userId.toString() ||
    session.participant?.toString?.() === userId.toString()
  );
}

function validatePdfDocument(file = {}) {
  if (!file) {
    return "A PDF file is required.";
  }

  const { dataUrl, mimeType, name, size } = file;

  if (!dataUrl || !mimeType || !name) {
    return "PDF data is incomplete.";
  }

  if (mimeType !== "application/pdf") {
    return "Only PDF files are supported for live review.";
  }

  if (!/^data:application\/pdf;base64,/i.test(dataUrl)) {
    return "PDF encoding is invalid.";
  }

  if (name.length > 120) {
    return "PDF file names must be 120 characters or fewer.";
  }

  if (size > 100 * 1024 * 1024) {
    return "PDF review files must be 100 MB or smaller.";
  }

  return null;
}

async function populateSession(sessionId) {
  return PdfReviewSession.findById(sessionId)
    .populate("initiator", "name email avatarColor avatarUrl lastActiveAt presenceStatus")
    .populate("participant", "name email avatarColor avatarUrl lastActiveAt presenceStatus")
    .populate("presenter", "name email avatarColor avatarUrl lastActiveAt presenceStatus");
}

async function clearSessionFile(session) {
  if (session.file?.storageKey) {
    await deletePdfReviewFile(session.file.storageKey);
  }

  session.file.dataUrl = null;
  session.file.storageKey = null;
  session.file.publicUrl = null;
  session.presenter = null;
  session.fileDeletedAt = session.fileDeletedAt || new Date();
}

async function expireSessionIfNeeded(session) {
  if (!session || !session.expiresAt || session.fileDeletedAt) {
    return session;
  }

  if (!["pending", "accepted"].includes(session.status)) {
    return session;
  }

  if (new Date(session.expiresAt).getTime() > Date.now()) {
    return session;
  }

  session.status = "completed";
  session.endedAt = session.endedAt || new Date();
  await clearSessionFile(session);
  await session.save();
  return session;
}

async function expireSessionsForConversation(conversationKey) {
  const candidates = await PdfReviewSession.find({
    conversationKey,
    status: { $in: ["pending", "accepted"] },
    expiresAt: { $lte: new Date() },
    fileDeletedAt: null
  });

  if (!candidates.length) {
    return;
  }

  await Promise.all(candidates.map((session) => expireSessionIfNeeded(session)));
}

function emitSessionChange(io, session, action) {
  const initiatorId = session.initiator._id.toString();
  const participantId = session.participant._id.toString();
  const payloadForInitiator = {
    action,
    sessionId: session._id.toString(),
    contactId: participantId,
    title: session.title || session.file.name,
    fileName: session.file.name,
    status: session.status
  };
  const payloadForParticipant = {
    action,
    sessionId: session._id.toString(),
    contactId: initiatorId,
    title: session.title || session.file.name,
    fileName: session.file.name,
    status: session.status
  };

  io.to(initiatorId).emit("pdf-review:changed", payloadForInitiator);
  io.to(participantId).emit("pdf-review:changed", payloadForParticipant);
}

router.get("/:contactId", async (req, res) => {
  try {
    const { contactId } = req.params;

    if (!mongoose.isValidObjectId(contactId)) {
      return res.status(400).json({ message: "Invalid contact id." });
    }

    const conversationKey = buildConversationKey(req.userId, contactId);
    await expireSessionsForConversation(conversationKey);
    const sessions = await PdfReviewSession.find({ conversationKey })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate("initiator", "name email avatarColor avatarUrl lastActiveAt presenceStatus")
      .populate("participant", "name email avatarColor avatarUrl lastActiveAt presenceStatus")
      .populate("presenter", "name email avatarColor avatarUrl lastActiveAt presenceStatus");

    return res.json({
      sessions: sessions.map((session) => serializePdfReviewSession(session))
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load PDF review sessions." });
  }
});

router.post("/:contactId", async (req, res) => {
  try {
    const { contactId } = req.params;
    const title = req.body.title?.trim() || "";
    const note = req.body.note?.trim() || "";
    const file = req.body.file || null;

    if (!mongoose.isValidObjectId(contactId)) {
      return res.status(400).json({ message: "Invalid contact id." });
    }

    const validationError = validatePdfDocument(file);
    if (validationError) {
      return res.status(400).json({ message: validationError });
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

    const storedFile = await writePdfReviewFile(file);
    let session;

    try {
      session = await PdfReviewSession.create({
        conversationKey: conversation.conversationKey,
        initiator: req.userId,
        participant: contactId,
        presenter: req.userId,
        title,
        note,
        file: {
          dataUrl: null,
          storageKey: storedFile.storageKey,
          publicUrl: storedFile.publicUrl,
          mimeType: file.mimeType,
          name: file.name,
          size: file.size
        },
        status: "pending",
        syncEnabled: true,
        viewerState: {
          page: 1,
          zoom: 100
        },
        expiresAt: new Date(Date.now() + REVIEW_AUTO_DELETE_MS)
      });
    } catch (error) {
      await deletePdfReviewFile(storedFile.storageKey);
      throw error;
    }

    const populatedSession = await populateSession(session._id);
    emitSessionChange(req.app.get("io"), populatedSession, "created");

    return res.status(201).json({
      session: serializePdfReviewSession(populatedSession)
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to start PDF review." });
  }
});

router.post("/:sessionId/respond", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const decision = req.body.decision;

    if (!mongoose.isValidObjectId(sessionId)) {
      return res.status(400).json({ message: "Invalid review session id." });
    }

    if (!["accepted", "declined"].includes(decision)) {
      return res.status(400).json({ message: "Invalid review decision." });
    }

    const session = await populateSession(sessionId);
    if (!session || !isParticipant(session, req.userId)) {
      return res.status(404).json({ message: "Review session not found." });
    }
    await expireSessionIfNeeded(session);

    if (session.fileDeletedAt || session.status !== "pending") {
      return res.status(400).json({ message: "This review request is no longer active." });
    }

    if (session.participant._id.toString() !== req.userId.toString()) {
      return res.status(403).json({ message: "Only the invited user can respond to this review request." });
    }

    session.status = decision;
    if (decision === "accepted") {
      session.acceptedAt = new Date();
      session.presenter = session.initiator._id;
    } else {
      session.endedAt = new Date();
      await clearSessionFile(session);
    }
    await session.save();

    const populatedSession = await populateSession(session._id);
    emitSessionChange(req.app.get("io"), populatedSession, decision);

    return res.json({
      session: serializePdfReviewSession(populatedSession)
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to update PDF review request." });
  }
});

router.patch("/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!mongoose.isValidObjectId(sessionId)) {
      return res.status(400).json({ message: "Invalid review session id." });
    }

    const session = await populateSession(sessionId);
    if (!session || !isParticipant(session, req.userId)) {
      return res.status(404).json({ message: "Review session not found." });
    }
    await expireSessionIfNeeded(session);

    if (session.fileDeletedAt && req.body.status !== "completed") {
      return res.status(400).json({ message: "This PDF review file has already been deleted." });
    }

    if (typeof req.body.syncEnabled === "boolean") {
      session.syncEnabled = req.body.syncEnabled;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "presenterId")) {
      if (req.body.presenterId === null) {
        session.presenter = null;
      } else if (req.body.presenterId === req.userId.toString()) {
        session.presenter = req.userId;
      } else {
        return res.status(403).json({ message: "You can only take control for yourself." });
      }
    }

    if (req.body.viewerState) {
      const nextPage = Number.parseInt(req.body.viewerState.page || "1", 10);
      const nextZoom = Number.parseInt(req.body.viewerState.zoom || "100", 10);

      session.viewerState.page = Number.isFinite(nextPage) ? Math.max(1, nextPage) : session.viewerState.page;
      session.viewerState.zoom = Number.isFinite(nextZoom)
        ? Math.max(50, Math.min(200, nextZoom))
        : session.viewerState.zoom;
    }

    if (req.body.status === "completed") {
      session.status = "completed";
      session.endedAt = new Date();
      await clearSessionFile(session);
    }

    await session.save();

    const populatedSession = await populateSession(session._id);
    emitSessionChange(
      req.app.get("io"),
      populatedSession,
      req.body.status === "completed" ? "completed" : "updated"
    );

    return res.json({
      session: serializePdfReviewSession(populatedSession)
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to update PDF review session." });
  }
});

export default router;
