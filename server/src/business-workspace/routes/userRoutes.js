import { Router } from "express";

import { prisma } from "../lib/prisma.js";

const router = Router();

router.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  res.json(users);
});

router.get("/online", async (_req, res) => {
  const users = await prisma.user.findMany({ where: { isOnline: true } });
  res.json(users);
});

router.get("/:id", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) return res.status(404).json({ message: "User not found" });
  res.json(user);
});

router.patch("/:id", async (req, res) => {
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: req.body
  });
  res.json(user);
});

export default router;
