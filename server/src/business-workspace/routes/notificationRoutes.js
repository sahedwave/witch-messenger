import { Router } from "express";

import { prisma } from "../lib/prisma.js";

const router = Router();

router.get("/", async (req, res) => {
  const userId = req.query.userId;
  res.json(await prisma.notification.findMany({ where: userId ? { userId: String(userId) } : undefined, orderBy: { createdAt: "desc" } }));
});

router.patch("/read-all", async (req, res) => {
  await prisma.notification.updateMany({
    where: { userId: req.body.userId, isRead: false },
    data: { isRead: true }
  });
  res.json({ ok: true });
});

router.patch("/:id/read", async (req, res) => {
  res.json(await prisma.notification.update({ where: { id: req.params.id }, data: { isRead: true } }));
});

export default router;
