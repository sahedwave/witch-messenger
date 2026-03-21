import { Router } from "express";

import { prisma } from "../lib/prisma.js";

const router = Router();

router.get("/", async (_req, res) => {
  res.json(await prisma.order.findMany({ orderBy: { createdAt: "desc" } }));
});

router.post("/", async (req, res) => {
  res.status(201).json(await prisma.order.create({ data: req.body }));
});

router.get("/:id", async (req, res) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!order) return res.status(404).json({ message: "Order not found" });
  res.json(order);
});

router.patch("/:id/status", async (req, res) => {
  const order = await prisma.order.update({
    where: { id: req.params.id },
    data: {
      status: req.body.status,
      actualDelivery: req.body.status === "delivered" ? new Date() : undefined
    }
  });
  res.json(order);
});

export default router;
