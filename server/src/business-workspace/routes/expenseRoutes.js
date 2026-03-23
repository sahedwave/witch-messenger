import { Router } from "express";

import { authMiddleware } from "../../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const router = Router();

const EXPENSE_CREATE_FIELDS = ["title", "vendorId", "amount", "currency", "category", "date", "notes"];
const EXPENSE_UPDATE_FIELDS = ["title", "vendorId", "amount", "currency", "category", "date", "notes"];
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

function buildExpensePayload(body = {}, { workspaceId, userId, partial = false } = {}) {
  const payload = {};
  const errors = [];

  const title = readString(body, "title", { required: !partial });
  if (title.error) errors.push(title.error);
  else if (title.value !== undefined) payload.title = title.value;

  const vendorId = readString(body, "vendorId", { required: !partial });
  if (vendorId.error) errors.push(vendorId.error);
  else if (vendorId.value !== undefined) payload.vendorId = vendorId.value;

  const amount = readNumber(body, "amount", { required: !partial, positive: true });
  if (amount.error) errors.push(amount.error);
  else if (amount.value !== undefined) payload.amount = amount.value;

  const currency = readString(body, "currency", { required: !partial });
  if (currency.error) errors.push(currency.error);
  else if (currency.value !== undefined) payload.currency = currency.value.toUpperCase();

  const category = readString(body, "category", { required: !partial });
  if (category.error) errors.push(category.error);
  else if (category.value !== undefined) payload.category = category.value.toLowerCase();

  const date = readDate(body, "date", { required: !partial });
  if (date.error) errors.push(date.error);
  else if (date.value !== undefined) payload.date = date.value;

  const notes = readString(body, "notes", { allowEmpty: true });
  if (notes.error) errors.push(notes.error);
  else if (notes.value !== undefined) payload.notes = notes.value;

  if (!partial) {
    payload.workspaceId = workspaceId;
    payload.loggedById = userId;
  }

  return { payload, errors };
}

async function loadExpenseForWorkspace(expenseId, workspaceId) {
  const expense = await prisma.expense.findUnique({ where: { id: expenseId } });

  if (!expense) {
    return { status: "not_found" };
  }

  if (!workspaceId || expense.workspaceId !== workspaceId) {
    return { status: "forbidden" };
  }

  return { status: "ok", expense };
}

router.get("/", async (req, res) => {
  try {
    const workspaceId = getWorkspaceId(req);
    return res.json(await prisma.expense.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" }
    }));
  } catch (error) {
    return res.status(500).json({ message: "Unable to load expenses." });
  }
});

router.post("/", requireFinanceWriteRole, async (req, res) => {
  try {
    const workspaceId = getWorkspaceId(req);
    const { payload, errors } = buildExpensePayload(req.body, {
      workspaceId,
      userId: req.user._id.toString()
    });

    if (!workspaceId) {
      return res.status(403).json({ message: "Forbidden." });
    }

    if (errors.length > 0) {
      return res.status(400).json({ message: errors[0] });
    }

    return res.status(201).json(await prisma.expense.create({ data: payload }));
  } catch (error) {
    return res.status(500).json({ message: "Unable to create expense." });
  }
});

router.patch("/:id", requireFinanceWriteRole, async (req, res) => {
  try {
    const workspaceId = getWorkspaceId(req);
    const result = await loadExpenseForWorkspace(req.params.id, workspaceId);

    if (result.status === "not_found") {
      return res.status(404).json({ message: "Expense not found" });
    }

    if (result.status === "forbidden") {
      return res.status(403).json({ message: "Forbidden." });
    }

    const { payload, errors } = buildExpensePayload(req.body, { partial: true });
    if (errors.length > 0) {
      return res.status(400).json({ message: errors[0] });
    }

    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ message: "No valid expense fields provided." });
    }

    return res.json(await prisma.expense.update({
      where: { id: req.params.id },
      data: payload
    }));
  } catch (error) {
    return res.status(500).json({ message: "Unable to update expense." });
  }
});

router.delete("/:id", requireFinanceWriteRole, async (req, res) => {
  try {
    const workspaceId = getWorkspaceId(req);
    const result = await loadExpenseForWorkspace(req.params.id, workspaceId);

    if (result.status === "not_found") {
      return res.status(404).json({ message: "Expense not found" });
    }

    if (result.status === "forbidden") {
      return res.status(403).json({ message: "Forbidden." });
    }

    return res.json(await prisma.expense.delete({ where: { id: req.params.id } }));
  } catch (error) {
    return res.status(500).json({ message: "Unable to delete expense." });
  }
});

router.get("/summary", async (req, res) => {
  try {
    const workspaceId = getWorkspaceId(req);
    const [summary, count] = await Promise.all([
      prisma.expense.aggregate({
        where: { workspaceId },
        _sum: { amount: true }
      }),
      prisma.expense.count({
        where: { workspaceId }
      })
    ]);

    return res.json({ total: Number(summary._sum.amount || 0), count });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load expense summary." });
  }
});

export { EXPENSE_CREATE_FIELDS, EXPENSE_UPDATE_FIELDS };
export default router;
