import { Router } from "express";

import { prisma } from "../lib/prisma.js";

const router = Router();

router.get("/", async (_req, res) => {
  const conversations = await prisma.conversation.findMany({
    include: {
      members: true,
      messages: { orderBy: { createdAt: "desc" }, take: 1 }
    },
    orderBy: { createdAt: "desc" }
  });
  res.json(conversations);
});

router.post("/", async (req, res) => {
  const { type, name, createdBy, memberIds = [] } = req.body;
  const conversation = await prisma.conversation.create({
    data: {
      type,
      name,
      createdById: createdBy,
      members: {
        create: memberIds.map((userId) => ({ userId }))
      }
    }
  });
  res.status(201).json(conversation);
});

router.get("/:id", async (req, res) => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: req.params.id },
    include: { members: { include: { user: true } } }
  });
  if (!conversation) return res.status(404).json({ message: "Conversation not found" });
  res.json(conversation);
});

router.get("/:id/messages", async (req, res) => {
  const messages = await prisma.message.findMany({
    where: { conversationId: req.params.id },
    include: { sender: true, reactions: true, attachments: true },
    orderBy: { createdAt: "asc" }
  });
  res.json(messages);
});

router.post("/:id/messages", async (req, res) => {
  const { senderId, type = "text", content, metadata, replyToId } = req.body;
  const message = await prisma.message.create({
    data: {
      conversationId: req.params.id,
      senderId,
      type,
      content,
      metadata,
      replyToId
    }
  });
  res.status(201).json(message);
});

router.patch("/:id/read", async (req, res) => {
  const { userId } = req.body;
  await prisma.conversationMember.updateMany({
    where: { conversationId: req.params.id, userId },
    data: { unreadCount: 0, lastReadAt: new Date() }
  });
  res.json({ ok: true });
});

export default router;
