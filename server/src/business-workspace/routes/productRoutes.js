import { Router } from "express";

import { prisma } from "../lib/prisma.js";

const router = Router();

router.get("/", async (_req, res) => {
  res.json(await prisma.product.findMany({ orderBy: { name: "asc" } }));
});

router.post("/", async (req, res) => {
  res.status(201).json(await prisma.product.create({ data: req.body }));
});

router.get("/low-stock", async (_req, res) => {
  const products = await prisma.product.findMany();
  res.json(products.filter((product) => product.currentStock < product.minimumStock));
});

router.get("/:id", async (req, res) => {
  const product = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!product) return res.status(404).json({ message: "Product not found" });
  res.json(product);
});

router.patch("/:id/stock", async (req, res) => {
  const product = await prisma.product.update({
    where: { id: req.params.id },
    data: {
      currentStock: req.body.currentStock
    }
  });
  res.json(product);
});

export default router;
