import { Router } from "express";

import { authMiddleware } from "../../middleware/auth.js";
const prisma = globalThis.__businessWorkspaceTestPrisma;

const router = Router();

router.use(authMiddleware);

function requireFinanceRole(req, res, next) {
  const modules = typeof req.user?.getWorkspaceModules === "function"
    ? req.user.getWorkspaceModules()
    : Array.isArray(req.user?.workspaceModules)
      ? req.user.workspaceModules
      : [];
  const roles = typeof req.user?.getWorkspaceRoles === "function"
    ? req.user.getWorkspaceRoles()
    : Array.isArray(req.user?.workspaceRoles)
      ? req.user.workspaceRoles
      : [];

  if (req.user?.isAdmin || (modules.includes("finance") && roles.some((role) => ["viewer", "approver", "finance_staff"].includes(role)))) {
    return next();
  }

  return res.status(403).json({ message: "Finance workspace access is required." });
}

router.use(requireFinanceRole);

function buildExpenseCreateData(body = {}, userId) {
  return {
    amount: Number(body.amount),
    currency: String(body.currency || "USD").trim().toUpperCase(),
    category: String(body.category || "other").trim().toLowerCase(),
    note: String(body.note || "").trim(),
    conversationId: String(body.conversationId || "").trim(),
    messageId: String(body.messageId || "").trim(),
    receiptUrl: body.receiptUrl ? String(body.receiptUrl).trim() : null,
    loggedById: userId
  };
}

router.get("/", async (_req, res) => {
  try {
    res.json(await prisma.expense.findMany({ orderBy: { createdAt: "desc" } }));
  } catch (error) {
    return res.status(500).json({ message: "Unable to load expenses." });
  }
});

router.post("/", async (req, res) => {
  try {
    const data = buildExpenseCreateData(req.body, req.user._id.toString());

    if (!data.conversationId || !data.messageId || !data.note) {
      return res.status(400).json({ message: "Conversation id, message id, and note are required." });
    }

    if (!Number.isFinite(data.amount) || data.amount <= 0) {
      return res.status(400).json({ message: "Amount must be a valid positive number." });
    }

    return res.status(201).json(await prisma.expense.create({ data }));
  } catch (error) {
    return res.status(500).json({ message: "Unable to create expense." });
  }
});

router.get("/summary", async (_req, res) => {
  try {
    const [summary, count] = await Promise.all([
      prisma.expense.aggregate({
        _sum: { amount: true }
      }),
      prisma.expense.count()
    ]);

    return res.json({ total: Number(summary._sum.amount || 0), count });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load expense summary." });
  }
});

export default router;
