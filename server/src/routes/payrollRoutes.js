import express from "express";
import mongoose from "mongoose";

import { authMiddleware } from "../middleware/auth.js";
import { ExpenseRecord } from "../models/ExpenseRecord.js";
import { PayrollRecord } from "../models/PayrollRecord.js";
import { writeAuditLog } from "../utils/audit.js";
import { ensureCurrencySupported, normalizeCurrencyCode } from "../utils/currency.js";
import { buildWorkspaceFilter, workspaceContextMiddleware, workspaceMembershipMiddleware } from "../utils/workspaceContext.js";

const router = express.Router();

router.use(authMiddleware);
router.use(workspaceContextMiddleware({ allowDefault: false, membershipModule: "finance", allowSingleMembershipFallback: true }));
router.use(workspaceMembershipMiddleware({ allowLegacyFallback: true }));

function buildScopedWorkspaceFilter(req, baseFilter = {}) {
  return buildWorkspaceFilter(req.workspace, baseFilter, {
    includeLegacy: Boolean(req.workspaceMembership?.isLegacyFallback)
  });
}

function hasAnyFinanceRole(membership, roles) {
  const assignedRoles = Array.isArray(membership?.financeRoles) ? membership.financeRoles : [];
  return roles.some((role) => assignedRoles.includes(role));
}

function requireFinanceViewer(req, res, next) {
  if (req.user?.isAdmin || req.user?.isSystemAdmin) {
    return next();
  }

  const membership = req.workspaceMembership;
  if (
    membership &&
    Array.isArray(membership.modules) &&
    membership.modules.includes("finance") &&
    membership.status !== "suspended" &&
    hasAnyFinanceRole(membership, ["viewer", "approver", "finance_staff", "accountant"])
  ) {
    return next();
  }

  return res.status(403).json({ message: "Finance workspace access is required." });
}

function requireFinanceManager(req, res, next) {
  const workspaceRole = req.workspaceMembership?.workspaceRole;

  if (req.user?.isAdmin || workspaceRole === "owner" || workspaceRole === "manager") {
    return next();
  }

  return res.status(403).json({ message: "Manager access is required to manage payroll." });
}

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function computeNetAmount(grossAmount, deductions = []) {
  const gross = roundMoney(grossAmount);
  const deductionTotal = (Array.isArray(deductions) ? deductions : []).reduce(
    (sum, entry) => sum + roundMoney(entry?.amount || 0),
    0
  );
  return roundMoney(Math.max(0, gross - deductionTotal));
}

function parseDeductions(input) {
  const rows = Array.isArray(input) ? input : [];
  const parsed = [];

  for (const row of rows) {
    const label = String(row?.label || "").trim();
    const amount = Number(row?.amount || 0);
    if (!label) {
      return { error: "Deduction label is required." };
    }
    if (!Number.isFinite(amount) || amount < 0) {
      return { error: "Deduction amount must be a valid number." };
    }
    parsed.push({
      label,
      amount: roundMoney(amount)
    });
  }

  return { deductions: parsed };
}

function serializePayroll(record) {
  return {
    id: record._id.toString(),
    workspaceId: record.workspaceId?.toString?.() || null,
    employeeName: record.employeeName,
    employeeId: record.employeeId || "",
    payPeriodStart: record.payPeriodStart,
    payPeriodEnd: record.payPeriodEnd,
    grossAmount: Number(record.grossAmount || 0),
    deductions: Array.isArray(record.deductions)
      ? record.deductions.map((entry) => ({
          label: entry.label,
          amount: Number(entry.amount || 0)
        }))
      : [],
    netAmount: Number(record.netAmount || 0),
    currency: normalizeCurrencyCode(record.currency || "USD"),
    status: record.status || "draft",
    paidAt: record.paidAt || null,
    paymentMethod: record.paymentMethod || "",
    paymentReference: record.paymentReference || "",
    linkedExpenseId: record.linkedExpenseId?._id?.toString?.() || record.linkedExpenseId?.toString?.() || null,
    linkedExpense:
      record.linkedExpenseId && typeof record.linkedExpenseId === "object"
        ? {
            id: record.linkedExpenseId._id?.toString?.() || null,
            status: record.linkedExpenseId.status || "",
            amount: Number(record.linkedExpenseId.amount || 0),
            currency: normalizeCurrencyCode(record.linkedExpenseId.currency || record.currency || "USD")
          }
        : null,
    notes: record.notes || "",
    approvedAt: record.approvedAt || null,
    completedAt: record.completedAt || null,
    createdBy: record.createdBy?._id
      ? {
          id: record.createdBy._id.toString(),
          name: record.createdBy.name || record.createdBy.email || "Workspace member",
          email: record.createdBy.email || ""
        }
      : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

router.get("/", requireFinanceViewer, async (req, res) => {
  try {
    const filter = buildScopedWorkspaceFilter(req);

    if (req.query.status) {
      filter.status = String(req.query.status);
    }
    if (req.query.payPeriodStart || req.query.payPeriodEnd) {
      filter.payPeriodEnd = {};
      if (req.query.payPeriodStart) {
        const start = new Date(req.query.payPeriodStart);
        if (!Number.isNaN(start.getTime())) {
          filter.payPeriodEnd.$gte = start;
        }
      }
      if (req.query.payPeriodEnd) {
        const end = new Date(req.query.payPeriodEnd);
        if (!Number.isNaN(end.getTime())) {
          end.setUTCHours(23, 59, 59, 999);
          filter.payPeriodEnd.$lte = end;
        }
      }
      if (!Object.keys(filter.payPeriodEnd).length) {
        delete filter.payPeriodEnd;
      }
    }

    const records = await PayrollRecord.find(filter)
      .sort({ payPeriodEnd: -1, createdAt: -1 })
      .populate("createdBy", "name email")
      .populate("linkedExpenseId", "status amount currency");

    return res.json(records.map(serializePayroll));
  } catch (_error) {
    return res.status(500).json({ message: "Unable to load payroll records." });
  }
});

router.post("/", requireFinanceManager, async (req, res) => {
  try {
    const employeeName = String(req.body.employeeName || "").trim();
    if (!employeeName) {
      return res.status(400).json({ message: "Employee name is required." });
    }

    const payPeriodStart = new Date(req.body.payPeriodStart);
    const payPeriodEnd = new Date(req.body.payPeriodEnd);
    if (Number.isNaN(payPeriodStart.getTime()) || Number.isNaN(payPeriodEnd.getTime())) {
      return res.status(400).json({ message: "Payroll pay period dates must be valid." });
    }

    const grossAmount = Number(req.body.grossAmount || 0);
    if (!Number.isFinite(grossAmount) || grossAmount < 0) {
      return res.status(400).json({ message: "Gross amount must be a valid number." });
    }

    const currency = normalizeCurrencyCode(req.body.currency || req.workspace?.defaultCurrency || "USD");
    const currencyError = ensureCurrencySupported(currency, "Payroll currency");
    if (currencyError) {
      return res.status(400).json({ message: currencyError });
    }

    const { deductions, error } = parseDeductions(req.body.deductions);
    if (error) {
      return res.status(400).json({ message: error });
    }

    const record = await PayrollRecord.create({
      workspaceId: req.workspaceId,
      employeeName,
      employeeId: String(req.body.employeeId || "").trim(),
      payPeriodStart,
      payPeriodEnd,
      grossAmount: roundMoney(grossAmount),
      deductions,
      netAmount: computeNetAmount(grossAmount, deductions),
      currency,
      notes: String(req.body.notes || "").trim(),
      createdBy: req.user._id
    });

    await writeAuditLog({
      actor: req.user._id,
      action: "finance.payroll.create",
      targetId: record._id.toString(),
      targetType: "PayrollRecord",
      metadata: {
        workspaceId: req.workspaceId?.toString?.() || null,
        employeeName: record.employeeName,
        netAmount: record.netAmount
      }
    });

    await record.populate("createdBy", "name email");
    return res.status(201).json(serializePayroll(record));
  } catch (_error) {
    return res.status(500).json({ message: "Unable to create payroll record." });
  }
});

router.get("/:id", requireFinanceViewer, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid payroll id." });
    }

    const record = await PayrollRecord.findOne(buildScopedWorkspaceFilter(req, { _id: req.params.id }))
      .populate("createdBy", "name email")
      .populate("linkedExpenseId", "status amount currency");

    if (!record) {
      return res.status(404).json({ message: "Payroll record not found." });
    }

    return res.json(serializePayroll(record));
  } catch (_error) {
    return res.status(500).json({ message: "Unable to load payroll record." });
  }
});

router.patch("/:id/approve", requireFinanceManager, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid payroll id." });
    }

    const record = await PayrollRecord.findOne(buildScopedWorkspaceFilter(req, { _id: req.params.id }));
    if (!record) {
      return res.status(404).json({ message: "Payroll record not found." });
    }
    if (record.status !== "draft") {
      return res.status(409).json({ message: "Only draft payroll records can be approved." });
    }

    record.status = "approved";
    record.approvedAt = new Date();
    await record.save();
    await record.populate("createdBy", "name email");

    return res.json(serializePayroll(record));
  } catch (_error) {
    return res.status(500).json({ message: "Unable to approve payroll record." });
  }
});

router.patch("/:id/pay", requireFinanceManager, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid payroll id." });
    }

    const record = await PayrollRecord.findOne(buildScopedWorkspaceFilter(req, { _id: req.params.id }));
    if (!record) {
      return res.status(404).json({ message: "Payroll record not found." });
    }
    if (record.status !== "approved") {
      return res.status(409).json({ message: "Only approved payroll records can be marked as paid." });
    }

    const expense = await ExpenseRecord.create({
      workspaceId: req.workspaceId,
      amount: roundMoney(record.netAmount),
      taxRate: 0,
      taxAmount: 0,
      taxLabel: "Tax",
      totalWithTax: roundMoney(record.netAmount),
      currency: normalizeCurrencyCode(record.currency || req.workspace?.defaultCurrency || "USD"),
      category: "salary",
      vendorName: record.employeeName,
      expenseDate: record.payPeriodEnd,
      note: `Pay period ${record.payPeriodStart.toISOString().slice(0, 10)} to ${record.payPeriodEnd.toISOString().slice(0, 10)}`,
      source: "payroll",
      sourceId: record._id,
      status: "approved",
      createdBy: req.user._id,
      approvedBy: req.user._id,
      approvedAt: new Date()
    });

    record.status = "paid";
    record.paidAt = new Date();
    record.completedAt = record.paidAt;
    record.paymentMethod = String(req.body.paymentMethod || "").trim();
    record.paymentReference = String(req.body.paymentReference || "").trim();
    record.linkedExpenseId = expense._id;
    await record.save();
    await record.populate("createdBy", "name email");
    await record.populate("linkedExpenseId", "status amount currency");

    return res.json(serializePayroll(record));
  } catch (_error) {
    return res.status(500).json({ message: "Unable to mark payroll record as paid." });
  }
});

router.patch("/:id/cancel", requireFinanceManager, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid payroll id." });
    }

    const record = await PayrollRecord.findOne(buildScopedWorkspaceFilter(req, { _id: req.params.id }));
    if (!record) {
      return res.status(404).json({ message: "Payroll record not found." });
    }
    if (!["draft", "approved"].includes(record.status)) {
      return res.status(409).json({ message: "Only draft or approved payroll records can be cancelled." });
    }

    record.status = "cancelled";
    await record.save();
    await record.populate("createdBy", "name email");

    return res.json(serializePayroll(record));
  } catch (_error) {
    return res.status(500).json({ message: "Unable to cancel payroll record." });
  }
});

export default router;
