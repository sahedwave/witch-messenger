import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { prisma } from "../lib/prisma.js";

const router = Router();

router.post("/register", async (req, res) => {
  const { name, email, password, role = "staff", department } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name, email, password: hashedPassword, role, department }
  });
  return res.status(201).json({ id: user.id, email: user.email });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const token = jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d"
  });
  return res.json({ token, user });
});

router.post("/logout", async (_req, res) => res.status(204).send());

router.get("/me", async (_req, res) => res.status(501).json({ message: "Attach auth middleware and return current user." }));

export default router;
