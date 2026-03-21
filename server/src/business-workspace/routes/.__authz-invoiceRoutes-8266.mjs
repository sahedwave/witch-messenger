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

function buildInvoiceCreateData(body = {}, userId) {
  return {
    invoiceNumber: String(body.invoiceNumber || "").trim(),
    companyName: String(body.companyName || "").trim(),
    amount: Number(body.amount),
    currency: String(body.currency || "USD").trim().toUpperCase(),
    dueDate: new Date(body.dueDate),
    conversationId: String(body.conversationId || "").trim(),
    messageId: String(body.messageId || "").trim(),
    pdfUrl: body.pdfUrl ? String(body.pdfUrl).trim() : null,
    createdById: userId
  };
}

router.get("/", async (_req, res) => {
  try {
    res.json(await prisma.invoice.findMany({ orderBy: { createdAt: "desc" } }));
  } catch (error) {
    return res.status(500).json({ message: "Unable to load invoices." });
  }
});

router.post("/", async (req, res) => {
  try {
    const data = buildInvoiceCreateData(req.body, req.user._id.toString());

    if (!data.invoiceNumber || !data.companyName || !data.conversationId || !data.messageId) {
      return res.status(400).json({ message: "Invoice number, company name, conversation id, and message id are required." });
    }

    if (!Number.isFinite(data.amount) || data.amount <= 0) {
      return res.status(400).json({ message: "Amount must be a valid positive number." });
    }

    if (Number.isNaN(data.dueDate.getTime())) {
      return res.status(400).json({ message: "Due date must be a valid date." });
    }

    return res.status(201).json(await prisma.invoice.create({ data }));
  } catch (error) {
    return res.status(500).json({ message: "Unable to create invoice." });
  }
});

router.get("/stats", async (_req, res) => {
  try {
    const [pending, overdue, total] = await Promise.all([
      prisma.invoice.aggregate({ where: { status: "pending" }, _count: { _all: true }, _sum: { amount: true } }),
      prisma.invoice.aggregate({ where: { status: "overdue" }, _count: { _all: true }, _sum: { amount: true } }),
      prisma.invoice.count()
    ]);

    res.json({
      total,
      pendingCount: pending._count._all,
      pendingAmount: Number(pending._sum.amount || 0),
      overdueCount: overdue._count._all,
      overdueAmount: Number(overdue._sum.amount || 0)
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load invoice stats." });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id } });
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });
    return res.json(invoice);
  } catch (error) {
    return res.status(500).json({ message: "Unable to load invoice." });
  }
});

router.patch("/:id/approve", async (req, res) => {
  try {
    const invoice = await prisma.invoice.update({
      where: { id: req.params.id },
      data: {
        status: "approved",
        approvedById: req.user._id.toString()
      }
    });
    return res.json(invoice);
  } catch (error) {
    return res.status(500).json({ message: "Unable to approve invoice." });
  }
});

router.patch("/:id/reject", async (req, res) => {
  try {
    const reason = String(req.body.reason || "").trim();
    if (!reason) {
      return res.status(400).json({ message: "Rejection reason is required." });
    }

    const invoice = await prisma.invoice.update({
      where: { id: req.params.id },
      data: {
        status: "rejected",
        rejectedById: req.user._id.toString(),
        rejectionReason: reason
      }
    });
    return res.json(invoice);
  } catch (error) {
    return res.status(500).json({ message: "Unable to reject invoice." });
  }
});

export default router;
