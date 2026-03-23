import { Router } from "express";

import { authMiddleware } from "../../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const router = Router();

const INVOICE_CREATE_FIELDS = ["title", "customerId", "amount", "currency", "dueDate", "lineItems", "notes"];
const INVOICE_UPDATE_FIELDS = ["title", "customerId", "amount", "currency", "dueDate", "lineItems", "notes"];
const FINANCE_READ_ROLES = ["viewer", "approver", "finance_staff"];
const FINANCE_WRITE_ROLES = ["approver", "finance_staff"];

router.use(authMiddleware);

function getWorkspaceId(req) {
  if (typeof req.user?.workspaceId === "string" && req.user.workspaceId.trim()) {
    return req.user.workspaceId.trim();
  }

  const headerWorkspaceId = req.headers["x-workspace-id"];
  if (typeof headerWorkspaceId === "string" && headerWorkspaceId.trim()) {
    return headerWorkspaceId.trim();
  }

  if (Array.isArray(headerWorkspaceId) && typeof headerWorkspaceId[0] === "string" && headerWorkspaceId[0].trim()) {
    return headerWorkspaceId[0].trim();
  }

  return null;
}

function getFinanceModules(req) {
  return typeof req.user?.getWorkspaceModules === "function"
    ? req.user.getWorkspaceModules()
    : Array.isArray(req.user?.workspaceModules)
      ? req.user.workspaceModules
      : [];
}

function getFinanceRoles(req) {
  return typeof req.user?.getWorkspaceRoles === "function"
    ? req.user.getWorkspaceRoles()
    : Array.isArray(req.user?.workspaceRoles)
      ? req.user.workspaceRoles
      : [];
}

function requireFinanceRole(allowedRoles) {
  return (req, res, next) => {
    const modules = getFinanceModules(req);
    const roles = getFinanceRoles(req);

    if (req.user?.isAdmin || (modules.includes("finance") && roles.some((role) => allowedRoles.includes(role)))) {
      return next();
    }

    return res.status(403).json({ message: "Finance workspace access is required." });
  };
}

const requireFinanceReadRole = requireFinanceRole(FINANCE_READ_ROLES);
const requireFinanceWriteRole = requireFinanceRole(FINANCE_WRITE_ROLES);

router.use(requireFinanceReadRole);

function readString(body, field, { required = false, allowEmpty = false } = {}) {
  const value = body?.[field];

  if (value == null) {
    return required ? { error: `${field} is required.` } : { value: undefined };
  }

  if (typeof value !== "string") {
    return { error: `${field} must be a string.` };
  }

  const normalized = value.trim();
  if (!allowEmpty && !normalized) {
    return required ? { error: `${field} is required.` } : { value: undefined };
  }

  return { value: normalized };
}

function readNumber(body, field, { required = false, positive = false } = {}) {
  const value = body?.[field];

  if (value == null || value === "") {
    return required ? { error: `${field} is required.` } : { value: undefined };
  }

  if (typeof value === "object") {
    return { error: `${field} must be a valid number.` };
  }

  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return { error: `${field} must be a valid number.` };
  }

  if (positive && normalized <= 0) {
    return { error: `${field} must be greater than zero.` };
  }

  return { value: normalized };
}

function readDate(body, field, { required = false } = {}) {
  const value = body?.[field];

  if (value == null || value === "") {
    return required ? { error: `${field} is required.` } : { value: undefined };
  }

  if (typeof value !== "string" && !(value instanceof Date)) {
    return { error: `${field} must be a valid date.` };
  }

  const normalized = new Date(value);
  if (Number.isNaN(normalized.getTime())) {
    return { error: `${field} must be a valid date.` };
  }

  return { value: normalized };
}

function readLineItems(body, field) {
  const value = body?.[field];

  if (value == null) {
    return { value: [] };
  }

  if (!Array.isArray(value)) {
    return { error: `${field} must be an array.` };
  }

  return {
    value: value.map((item) => (item && typeof item === "object" ? { ...item } : item))
  };
}

function buildInvoicePayload(body = {}, { workspaceId, userId, includeStatus = false, partial = false } = {}) {
  const payload = {};
  const errors = [];

  const title = readString(body, "title", { required: !partial });
  if (title.error) errors.push(title.error);
  else if (title.value !== undefined) payload.title = title.value;

  const customerId = readString(body, "customerId", { required: !partial });
  if (customerId.error) errors.push(customerId.error);
  else if (customerId.value !== undefined) payload.customerId = customerId.value;

  const amount = readNumber(body, "amount", { required: !partial, positive: true });
  if (amount.error) errors.push(amount.error);
  else if (amount.value !== undefined) payload.amount = amount.value;

  const currency = readString(body, "currency", { required: !partial });
  if (currency.error) errors.push(currency.error);
  else if (currency.value !== undefined) payload.currency = currency.value.toUpperCase();

  const dueDate = readDate(body, "dueDate", { required: !partial });
  if (dueDate.error) errors.push(dueDate.error);
  else if (dueDate.value !== undefined) payload.dueDate = dueDate.value;

  const lineItems = readLineItems(body, "lineItems");
  if (lineItems.error) errors.push(lineItems.error);
  else if (lineItems.value !== undefined) payload.lineItems = lineItems.value;

  const notes = readString(body, "notes", { allowEmpty: true });
  if (notes.error) errors.push(notes.error);
  else if (notes.value !== undefined) payload.notes = notes.value;

  if (!partial) {
    payload.workspaceId = workspaceId;
    payload.createdById = userId;
    if (includeStatus) {
      payload.status = "draft";
    }
  }

  return { payload, errors };
}

async function loadInvoiceForWorkspace(invoiceId, workspaceId) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });

  if (!invoice) {
    return { status: "not_found" };
  }

  if (!workspaceId || invoice.workspaceId !== workspaceId) {
    return { status: "forbidden" };
  }

  return { status: "ok", invoice };
}

router.get("/", async (req, res) => {
  try {
    const workspaceId = getWorkspaceId(req);
    return res.json(await prisma.invoice.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" }
    }));
  } catch (error) {
    return res.status(500).json({ message: "Unable to load invoices." });
  }
});

router.post("/", requireFinanceWriteRole, async (req, res) => {
  try {
    const workspaceId = getWorkspaceId(req);
    const { payload, errors } = buildInvoicePayload(req.body, {
      workspaceId,
      userId: req.user._id.toString(),
      includeStatus: true
    });

    if (!workspaceId) {
      return res.status(403).json({ message: "Forbidden." });
    }

    if (errors.length > 0) {
      return res.status(400).json({ message: errors[0] });
    }

    return res.status(201).json(await prisma.invoice.create({ data: payload }));
  } catch (error) {
    return res.status(500).json({ message: "Unable to create invoice." });
  }
});

router.get("/stats", async (req, res) => {
  try {
    const workspaceId = getWorkspaceId(req);
    const [pending, overdue, total] = await Promise.all([
      prisma.invoice.aggregate({
        where: { workspaceId, status: "pending" },
        _count: { _all: true },
        _sum: { amount: true }
      }),
      prisma.invoice.aggregate({
        where: { workspaceId, status: "overdue" },
        _count: { _all: true },
        _sum: { amount: true }
      }),
      prisma.invoice.count({ where: { workspaceId } })
    ]);

    return res.json({
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
    const workspaceId = getWorkspaceId(req);
    const result = await loadInvoiceForWorkspace(req.params.id, workspaceId);

    if (result.status === "not_found") {
      return res.status(404).json({ message: "Invoice not found" });
    }

    if (result.status === "forbidden") {
      return res.status(403).json({ message: "Forbidden." });
    }

    return res.json(result.invoice);
  } catch (error) {
    return res.status(500).json({ message: "Unable to load invoice." });
  }
});

router.patch("/:id", requireFinanceWriteRole, async (req, res) => {
  try {
    const workspaceId = getWorkspaceId(req);
    const result = await loadInvoiceForWorkspace(req.params.id, workspaceId);

    if (result.status === "not_found") {
      return res.status(404).json({ message: "Invoice not found" });
    }

    if (result.status === "forbidden") {
      return res.status(403).json({ message: "Forbidden." });
    }

    const { payload, errors } = buildInvoicePayload(req.body, { partial: true });
    if (errors.length > 0) {
      return res.status(400).json({ message: errors[0] });
    }

    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ message: "No valid invoice fields provided." });
    }

    return res.json(await prisma.invoice.update({
      where: { id: req.params.id },
      data: payload
    }));
  } catch (error) {
    return res.status(500).json({ message: "Unable to update invoice." });
  }
});

router.delete("/:id", requireFinanceWriteRole, async (req, res) => {
  try {
    const workspaceId = getWorkspaceId(req);
    const result = await loadInvoiceForWorkspace(req.params.id, workspaceId);

    if (result.status === "not_found") {
      return res.status(404).json({ message: "Invoice not found" });
    }

    if (result.status === "forbidden") {
      return res.status(403).json({ message: "Forbidden." });
    }

    return res.json(await prisma.invoice.delete({ where: { id: req.params.id } }));
  } catch (error) {
    return res.status(500).json({ message: "Unable to delete invoice." });
  }
});

router.patch("/:id/approve", requireFinanceWriteRole, async (req, res) => {
  try {
    const workspaceId = getWorkspaceId(req);
    const result = await loadInvoiceForWorkspace(req.params.id, workspaceId);

    if (result.status === "not_found") {
      return res.status(404).json({ message: "Invoice not found" });
    }

    if (result.status === "forbidden") {
      return res.status(403).json({ message: "Forbidden." });
    }

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

router.patch("/:id/reject", requireFinanceWriteRole, async (req, res) => {
  try {
    const workspaceId = getWorkspaceId(req);
    const result = await loadInvoiceForWorkspace(req.params.id, workspaceId);

    if (result.status === "not_found") {
      return res.status(404).json({ message: "Invoice not found" });
    }

    if (result.status === "forbidden") {
      return res.status(403).json({ message: "Forbidden." });
    }

    const reason = readString(req.body, "reason", { required: true });
    if (reason.error || !reason.value) {
      return res.status(400).json({ message: "Rejection reason is required." });
    }

    const invoice = await prisma.invoice.update({
      where: { id: req.params.id },
      data: {
        status: "rejected",
        rejectedById: req.user._id.toString(),
        rejectionReason: reason.value
      }
    });

    return res.json(invoice);
  } catch (error) {
    return res.status(500).json({ message: "Unable to reject invoice." });
  }
});

export { INVOICE_CREATE_FIELDS, INVOICE_UPDATE_FIELDS };
export default router;
