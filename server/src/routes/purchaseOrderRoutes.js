import express from "express";
import mongoose from "mongoose";

import { authMiddleware } from "../middleware/auth.js";
import { ExpenseRecord } from "../models/ExpenseRecord.js";
import { FinanceActionLog } from "../models/FinanceActionLog.js";
import { FinanceVendor } from "../models/FinanceVendor.js";
import { PurchaseOrder } from "../models/PurchaseOrder.js";
import { WarehouseProduct } from "../models/WarehouseProduct.js";
import { WarehouseStockMovement } from "../models/WarehouseStockMovement.js";
import { WorkspaceMembership } from "../models/WorkspaceMembership.js";
import { writeAuditLog } from "../utils/audit.js";
import {
  convertAmount,
  ensureCurrencySupported,
  normalizeCurrencyCode
} from "../utils/currency.js";
import {
  buildWorkspaceFilter,
  workspaceContextMiddleware,
  workspaceMembershipMiddleware
} from "../utils/workspaceContext.js";

const router = express.Router();

const PURCHASE_ORDER_STATUS_TRANSITIONS = {
  draft: ["sent", "cancelled"],
  sent: ["acknowledged", "partially_received", "received", "cancelled"],
  acknowledged: ["partially_received", "received"],
  partially_received: ["received"],
  received: [],
  cancelled: []
};

router.use(authMiddleware);
router.use(workspaceContextMiddleware({ allowDefault: false, allowSingleMembershipFallback: true }));
router.use(workspaceMembershipMiddleware({ allowLegacyFallback: true }));

function buildScopedWorkspaceFilter(req, baseFilter = {}) {
  return buildWorkspaceFilter(req.workspace, baseFilter, {
    includeLegacy: Boolean(req.workspaceMembership?.isLegacyFallback)
  });
}

function hasWarehouseModuleAccess(membership) {
  return (
    membership &&
    membership.status !== "suspended" &&
    Array.isArray(membership.modules) &&
    membership.modules.includes("warehouse")
  );
}

function hasFinanceStaffAccess(req) {
  if (req.user?.isAdmin) {
    return true;
  }

  if (req.workspaceMembership?.workspaceRole === "owner" || req.workspaceMembership?.workspaceRole === "manager") {
    return true;
  }

  return Array.isArray(req.workspaceMembership?.financeRoles) && req.workspaceMembership.financeRoles.includes("finance_staff");
}

function hasFinanceViewerAccess(req) {
  if (hasFinanceStaffAccess(req)) {
    return true;
  }

  return Array.isArray(req.workspaceMembership?.financeRoles) && req.workspaceMembership.financeRoles.includes("viewer");
}

function requirePurchaseOrderViewer(req, res, next) {
  if (hasWarehouseModuleAccess(req.workspaceMembership) || hasFinanceViewerAccess(req)) {
    return next();
  }

  return res.status(403).json({ message: "Purchase order workspace access is required." });
}

function requirePurchaseOrderOperator(req, res, next) {
  if (hasWarehouseModuleAccess(req.workspaceMembership) || hasFinanceStaffAccess(req)) {
    return next();
  }

  return res.status(403).json({ message: "Purchase order operator access is required." });
}

function formatActor(user) {
  if (!user?._id) {
    return null;
  }

  return {
    id: user._id.toString(),
    name: user.name || "Workspace member",
    email: user.email || ""
  };
}

function normalizeCurrency(value = "USD", fallback = "USD") {
  return normalizeCurrencyCode(value, fallback);
}

function computeLineSubtotal(lineItem) {
  return Number((Number(lineItem.quantity || 0) * Number(lineItem.unitCost || 0)).toFixed(2));
}

function computeLineTaxAmount(lineItem) {
  const subtotal = computeLineSubtotal(lineItem);
  const taxRate = Number(lineItem.taxRate || 0);
  if (!Number.isFinite(taxRate) || taxRate <= 0) {
    return 0;
  }

  return Number(((subtotal * taxRate) / 100).toFixed(2));
}

function computeLineTotalWithTax(lineItem) {
  return Number((computeLineSubtotal(lineItem) + computeLineTaxAmount(lineItem)).toFixed(2));
}

function computePurchaseOrderTotals(lineItems = [], orderCurrency = "USD") {
  const totalsByCurrency = {};
  let normalizedTotal = 0;

  for (const lineItem of lineItems) {
    const currency = normalizeCurrency(lineItem.currency || orderCurrency, orderCurrency);
    const lineTotalWithTax = computeLineTotalWithTax(lineItem);
    totalsByCurrency[currency] = Number(
      ((Number(totalsByCurrency[currency] || 0) + lineTotalWithTax)).toFixed(2)
    );
    normalizedTotal += convertAmount(lineTotalWithTax, currency, orderCurrency);
  }

  return {
    totalAmount: Number(normalizedTotal.toFixed(2)),
    totalsByCurrency
  };
}

function serializeFinanceExpenseRef(expense) {
  if (!expense?._id) {
    return null;
  }

  return {
    id: expense._id.toString(),
    status: expense.status || "pending_review",
    amount: Number(expense.amount || 0),
    currency: normalizeCurrency(expense.currency)
  };
}

function serializePurchaseOrderLineItem(lineItem) {
  return {
    id: lineItem._id?.toString?.() || null,
    itemId: lineItem.itemId?._id?.toString?.() || lineItem.itemId?.toString?.() || null,
    itemName: lineItem.itemName,
    sku: lineItem.sku || "",
    quantity: Number(lineItem.quantity || 0),
    unitCost: Number(lineItem.unitCost || 0),
    taxRate: Number(lineItem.taxRate || 0),
    taxAmount: computeLineTaxAmount(lineItem),
    currency: normalizeCurrency(lineItem.currency),
    receivedQuantity: Number(lineItem.receivedQuantity || 0),
    lineTotal: computeLineSubtotal(lineItem),
    lineTotalWithTax: computeLineTotalWithTax(lineItem)
  };
}

function serializePurchaseOrder(order) {
  const financeExpense = order.financeExpenseId?._id ? order.financeExpenseId : null;
  const lineItems = (Array.isArray(order.lineItems) ? order.lineItems : []).map(serializePurchaseOrderLineItem);
  const totals = computePurchaseOrderTotals(lineItems, normalizeCurrency(order.currency));

  return {
    id: order._id.toString(),
    workspaceId: order.workspaceId?.toString?.() || null,
    orderNumber: order.orderNumber,
    vendorId: order.vendorId?._id?.toString?.() || order.vendorId?.toString?.() || null,
    vendorName: order.vendorName || "",
    status: order.status || "draft",
    lineItems,
    totalAmount: Number(order.totalAmount || totals.totalAmount || 0),
    currency: normalizeCurrency(order.currency),
    totalsByCurrency: totals.totalsByCurrency,
    mixedCurrency: Object.keys(totals.totalsByCurrency).length > 1,
    expectedDeliveryDate: order.expectedDeliveryDate || null,
    notes: order.notes || "",
    sentAt: order.sentAt || null,
    receivedAt: order.receivedAt || null,
    createdBy: formatActor(order.createdBy),
    updatedBy: formatActor(order.updatedBy),
    financeExpenseId: financeExpense?._id?.toString?.() || order.financeExpenseId?.toString?.() || null,
    financeExpense: financeExpense ? serializeFinanceExpenseRef(financeExpense) : null,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt
  };
}

function assertStatusTransition(from, to) {
  const normalizedFrom = String(from || "draft").trim().toLowerCase();
  const normalizedTo = String(to || "").trim().toLowerCase();
  const allowed = PURCHASE_ORDER_STATUS_TRANSITIONS[normalizedFrom] || [];

  if (!allowed.includes(normalizedTo)) {
    const error = new Error("Purchase order status transition is not allowed.");
    error.statusCode = 409;
    throw error;
  }
}

async function isFinanceEnabledForWorkspace(workspaceId) {
  if (!workspaceId) {
    return false;
  }

  const membership = await WorkspaceMembership.findOne({
    workspaceId,
    modules: "finance",
    status: { $ne: "suspended" }
  }).select("_id");

  return Boolean(membership?._id);
}

async function buildPurchaseOrderNumber(workspaceId) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const prefix = `PO-${year}${month}`;
  const count = await PurchaseOrder.countDocuments({
    workspaceId,
    orderNumber: { $regex: `^${prefix}-` }
  });

  return `${prefix}-${String(count + 1).padStart(4, "0")}`;
}

async function resolveVendorForWorkspace(workspaceId, vendorId) {
  if (!vendorId) {
    return null;
  }

  if (!mongoose.isValidObjectId(vendorId)) {
    const error = new Error("Vendor is invalid.");
    error.statusCode = 400;
    throw error;
  }

  const vendor = await FinanceVendor.findOne({ _id: vendorId, workspaceId }).select("_id name");
  if (!vendor) {
    const error = new Error("Vendor not found.");
    error.statusCode = 404;
    throw error;
  }

  return vendor;
}

async function normalizePurchaseOrderLineItems(workspaceId, payload = [], currency = "USD") {
  const rawItems = Array.isArray(payload) ? payload : [];

  if (!rawItems.length) {
    const error = new Error("At least one purchase order line item is required.");
    error.statusCode = 400;
    throw error;
  }

  const itemIds = [...new Set(
    rawItems
      .map((lineItem) => String(lineItem?.itemId || "").trim())
      .filter(Boolean)
  )];

  if (!itemIds.every((itemId) => mongoose.isValidObjectId(itemId))) {
    const error = new Error("Purchase order item references are invalid.");
    error.statusCode = 400;
    throw error;
  }

  const products = itemIds.length
    ? await WarehouseProduct.find({ workspaceId, _id: { $in: itemIds } }).select("_id name sku")
    : [];

  const productsById = new Map(products.map((product) => [product._id.toString(), product]));

  if (productsById.size !== itemIds.length) {
    const error = new Error("One or more warehouse items were not found.");
    error.statusCode = 404;
    throw error;
  }

  return rawItems.map((lineItem, index) => {
    const quantity = Number(lineItem?.quantity);
    const unitCost = Number(lineItem?.unitCost);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      const error = new Error(`Line item ${index + 1} quantity must be greater than zero.`);
      error.statusCode = 400;
      throw error;
    }
    if (!Number.isFinite(unitCost) || unitCost < 0) {
      const error = new Error(`Line item ${index + 1} unit cost must be zero or greater.`);
      error.statusCode = 400;
      throw error;
    }

    const itemId = String(lineItem?.itemId || "").trim();
    const product = itemId ? productsById.get(itemId) : null;
    const lineCurrency = normalizeCurrency(lineItem?.currency || currency, currency);
    const currencyError = ensureCurrencySupported(lineCurrency, `Line item ${index + 1} currency`);
    if (currencyError) {
      const error = new Error(currencyError);
      error.statusCode = 400;
      throw error;
    }

    const receivedQuantity = Number(lineItem?.receivedQuantity || 0);
    const taxRate = Number(lineItem?.taxRate || 0);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
      const error = new Error(`Line item ${index + 1} tax rate must be between 0 and 100.`);
      error.statusCode = 400;
      throw error;
    }

    const normalizedLineItem = {
      itemId: product?._id || null,
      itemName: String(lineItem?.itemName || product?.name || "").trim() || `Line item ${index + 1}`,
      sku: String(lineItem?.sku || product?.sku || "").trim().toUpperCase(),
      quantity: Number(quantity.toFixed(2)),
      unitCost: Number(unitCost.toFixed(2)),
      taxRate: Number(taxRate.toFixed(2)),
      currency: lineCurrency,
      receivedQuantity: Number(Math.max(0, receivedQuantity).toFixed(2))
    };

    return {
      ...normalizedLineItem,
      taxAmount: computeLineTaxAmount(normalizedLineItem),
      lineTotalWithTax: computeLineTotalWithTax(normalizedLineItem)
    };
  });
}

async function loadPurchaseOrderDetail(req, orderId) {
  return PurchaseOrder.findOne(buildScopedWorkspaceFilter(req, { _id: orderId }))
    .populate("createdBy updatedBy", "name email")
    .populate("vendorId", "name")
    .populate("lineItems.itemId", "name sku")
    .populate("financeExpenseId", "status amount currency");
}

async function createOrUpdatePurchaseOrderExpense({
  workspaceId,
  userId,
  order,
  amount
}) {
  if (!(await isFinanceEnabledForWorkspace(workspaceId)) || !Number.isFinite(amount) || amount <= 0) {
    return order.financeExpenseId || null;
  }

  const note = `Auto-created from PO ${order.orderNumber}`;

  if (order.financeExpenseId) {
    const existingExpense = await ExpenseRecord.findOne({
      _id: order.financeExpenseId,
      workspaceId,
      source: "purchase_order",
      sourceId: order._id
    });

    if (existingExpense) {
      const existingTotal = Number(existingExpense.totalWithTax || existingExpense.amount || 0);
      existingExpense.amount = Number((Number(existingExpense.amount || 0) + amount).toFixed(2));
      existingExpense.totalWithTax = Number((existingTotal + amount).toFixed(2));
      existingExpense.vendorId = order.vendorId || existingExpense.vendorId || null;
      existingExpense.vendorName = order.vendorName || existingExpense.vendorName || "";
      existingExpense.currency = normalizeCurrency(order.currency);
      existingExpense.category = "supplies";
      existingExpense.note = note;
      existingExpense.status = existingExpense.status || "pending_review";
      await existingExpense.save();
      return existingExpense._id;
    }
  }

  const expense = await ExpenseRecord.create({
    workspaceId,
    vendorId: order.vendorId || null,
    vendorName: order.vendorName || "",
    amount: Number(amount.toFixed(2)),
    totalWithTax: Number(amount.toFixed(2)),
    currency: normalizeCurrency(order.currency),
    category: "supplies",
    note,
    status: "pending_review",
    source: "purchase_order",
    sourceId: order._id,
    createdBy: userId,
    threadKey: "financebot"
  });

  await FinanceActionLog.create({
    workspaceId,
    itemType: "expense",
    itemId: expense._id,
    action: "created",
    performedBy: userId,
    threadKey: "financebot",
    metadata: {
      source: "purchase_order",
      sourceId: order._id.toString(),
      orderNumber: order.orderNumber
    }
  });

  return expense._id;
}

router.use(requirePurchaseOrderViewer);

router.post("/", requirePurchaseOrderOperator, async (req, res) => {
  try {
    const currency = normalizeCurrency(req.body.currency || req.workspace?.defaultCurrency || "USD");
    const currencyError = ensureCurrencySupported(currency, "Purchase order currency");
    if (currencyError) {
      return res.status(400).json({ message: currencyError });
    }
    const lineItems = await normalizePurchaseOrderLineItems(req.workspaceId, req.body.lineItems, currency);
    const totals = computePurchaseOrderTotals(lineItems, currency);
    const vendor = await resolveVendorForWorkspace(req.workspaceId, req.body.vendorId);
    const expectedDeliveryDate = req.body.expectedDeliveryDate ? new Date(req.body.expectedDeliveryDate) : null;

    if (expectedDeliveryDate && Number.isNaN(expectedDeliveryDate.getTime())) {
      return res.status(400).json({ message: "Expected delivery date must be valid." });
    }

    const order = await PurchaseOrder.create({
      workspaceId: req.workspaceId,
      orderNumber: await buildPurchaseOrderNumber(req.workspaceId),
      vendorId: vendor?._id || null,
      vendorName: String(req.body.vendorName || vendor?.name || "").trim() || "Warehouse vendor",
      status: "draft",
      lineItems,
      totalAmount: totals.totalAmount,
      currency,
      expectedDeliveryDate,
      notes: String(req.body.notes || "").trim(),
      createdBy: req.user._id,
      updatedBy: req.user._id
    });

    await writeAuditLog({
      actor: req.user._id,
      action: "warehouse.purchase_order.create",
      targetId: order._id.toString(),
      targetType: "PurchaseOrder",
      metadata: {
        workspaceId: req.workspaceId?.toString?.() || null,
        orderNumber: order.orderNumber
      }
    });

    const populated = await loadPurchaseOrderDetail(req, order._id);
    return res.status(201).json(serializePurchaseOrder(populated));
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }

    if (error?.code === 11000) {
      return res.status(409).json({ message: "A purchase order with that number already exists in this workspace." });
    }

    return res.status(500).json({ message: "Unable to create purchase order." });
  }
});

router.get("/", async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) {
      filter.status = String(req.query.status).trim().toLowerCase();
    }

    const orders = await PurchaseOrder.find(buildScopedWorkspaceFilter(req, filter))
      .sort({ createdAt: -1 })
      .populate("createdBy updatedBy", "name email")
      .populate("financeExpenseId", "status amount currency");

    return res.json(orders.map(serializePurchaseOrder));
  } catch (error) {
    return res.status(500).json({ message: "Unable to load purchase orders." });
  }
});

router.get("/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid purchase order id." });
    }

    const order = await loadPurchaseOrderDetail(req, req.params.id);
    if (!order) {
      return res.status(404).json({ message: "Purchase order not found." });
    }

    return res.json(serializePurchaseOrder(order));
  } catch (error) {
    return res.status(500).json({ message: "Unable to load purchase order." });
  }
});

router.patch("/:id", requirePurchaseOrderOperator, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid purchase order id." });
    }

    const order = await PurchaseOrder.findOne(buildScopedWorkspaceFilter(req, { _id: req.params.id }));
    if (!order) {
      return res.status(404).json({ message: "Purchase order not found." });
    }

    if (order.status !== "draft") {
      return res.status(409).json({ message: "Only draft purchase orders can be edited." });
    }

    const currency = normalizeCurrency(req.body.currency || order.currency || req.workspace?.defaultCurrency || "USD");
    const currencyError = ensureCurrencySupported(currency, "Purchase order currency");
    if (currencyError) {
      return res.status(400).json({ message: currencyError });
    }
    const lineItems = req.body.lineItems ? await normalizePurchaseOrderLineItems(req.workspaceId, req.body.lineItems, currency) : order.lineItems;
    const totals = computePurchaseOrderTotals(lineItems, currency);
    const vendor = req.body.vendorId !== undefined ? await resolveVendorForWorkspace(req.workspaceId, req.body.vendorId) : null;
    const expectedDeliveryDate =
      req.body.expectedDeliveryDate !== undefined
        ? (req.body.expectedDeliveryDate ? new Date(req.body.expectedDeliveryDate) : null)
        : order.expectedDeliveryDate;

    if (expectedDeliveryDate && Number.isNaN(expectedDeliveryDate.getTime())) {
      return res.status(400).json({ message: "Expected delivery date must be valid." });
    }

    if (req.body.vendorId !== undefined) {
      order.vendorId = vendor?._id || null;
      order.vendorName = String(req.body.vendorName || vendor?.name || "").trim() || order.vendorName || "Warehouse vendor";
    } else if (req.body.vendorName !== undefined) {
      order.vendorName = String(req.body.vendorName || "").trim() || order.vendorName || "Warehouse vendor";
    }

    order.currency = currency;
    order.lineItems = lineItems;
    order.totalAmount = totals.totalAmount;
    order.expectedDeliveryDate = expectedDeliveryDate;
    if (req.body.notes !== undefined) {
      order.notes = String(req.body.notes || "").trim();
    }
    order.updatedBy = req.user._id;
    await order.save();

    const populated = await loadPurchaseOrderDetail(req, order._id);
    return res.json(serializePurchaseOrder(populated));
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }

    return res.status(500).json({ message: "Unable to update purchase order." });
  }
});

router.patch("/:id/send", requirePurchaseOrderOperator, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid purchase order id." });
    }

    const order = await PurchaseOrder.findOne(buildScopedWorkspaceFilter(req, { _id: req.params.id }));
    if (!order) {
      return res.status(404).json({ message: "Purchase order not found." });
    }

    assertStatusTransition(order.status, "sent");
    order.status = "sent";
    order.sentAt = new Date();
    order.updatedBy = req.user._id;
    await order.save();

    await writeAuditLog({
      actor: req.user._id,
      action: "warehouse.purchase_order.send",
      targetId: order._id.toString(),
      targetType: "PurchaseOrder",
      metadata: {
        workspaceId: req.workspaceId?.toString?.() || null,
        orderNumber: order.orderNumber
      }
    });

    const populated = await loadPurchaseOrderDetail(req, order._id);
    return res.json(serializePurchaseOrder(populated));
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }

    return res.status(500).json({ message: "Unable to send purchase order." });
  }
});

router.patch("/:id/receive", requirePurchaseOrderOperator, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid purchase order id." });
    }

    const order = await PurchaseOrder.findOne(buildScopedWorkspaceFilter(req, { _id: req.params.id }));
    if (!order) {
      return res.status(404).json({ message: "Purchase order not found." });
    }

    if (!["sent", "acknowledged", "partially_received"].includes(order.status)) {
      return res.status(409).json({ message: "This purchase order cannot be received in its current state." });
    }

    const requestedItems = Array.isArray(req.body.lineItems) ? req.body.lineItems : [];
    if (!requestedItems.length) {
      return res.status(400).json({ message: "Received quantities are required." });
    }

    const receivedById = new Map(
      requestedItems
        .map((entry) => [String(entry?.lineItemId || entry?.id || ""), Number(entry?.receivedQuantity)])
        .filter(([lineItemId]) => Boolean(lineItemId))
    );

    if (!receivedById.size) {
      return res.status(400).json({ message: "Received quantities are required." });
    }

    let receivedCost = 0;
    const inventoryUpdates = [];

    order.lineItems = order.lineItems.map((lineItem) => {
      const lineItemId = lineItem._id?.toString?.();
      const requestedQuantity = receivedById.get(lineItemId);

      if (requestedQuantity === undefined) {
        return lineItem;
      }

      if (!Number.isFinite(requestedQuantity) || requestedQuantity < 0) {
        throw Object.assign(new Error("Received quantity must be zero or greater."), { statusCode: 400 });
      }

      const remainingQuantity = Number(lineItem.quantity || 0) - Number(lineItem.receivedQuantity || 0);
      if (requestedQuantity > remainingQuantity) {
        throw Object.assign(new Error("Received quantity exceeds the remaining quantity on this line item."), { statusCode: 400 });
      }

      if (requestedQuantity > 0) {
        const receivedSubtotal = Number((requestedQuantity * Number(lineItem.unitCost || 0)).toFixed(2));
        const receivedTax = Number(((receivedSubtotal * Number(lineItem.taxRate || 0)) / 100).toFixed(2));
        receivedCost += convertAmount(receivedSubtotal + receivedTax, lineItem.currency || order.currency, order.currency || req.workspace?.defaultCurrency || "USD");
        if (lineItem.itemId) {
          inventoryUpdates.push({
            itemId: lineItem.itemId,
            itemName: lineItem.itemName,
            sku: lineItem.sku,
            quantity: requestedQuantity
          });
        }
      }

      lineItem.receivedQuantity = Number((Number(lineItem.receivedQuantity || 0) + requestedQuantity).toFixed(2));
      return lineItem;
    });

    if (!inventoryUpdates.length && receivedCost <= 0) {
      return res.status(400).json({ message: "At least one received quantity must be greater than zero." });
    }

    for (const update of inventoryUpdates) {
      const product = await WarehouseProduct.findOne({ _id: update.itemId, workspaceId: req.workspaceId });
      if (!product) {
        continue;
      }

      const previousStock = Number(product.currentStock || 0);
      product.currentStock = Number((previousStock + Number(update.quantity || 0)).toFixed(2));
      product.updatedBy = req.user._id;
      await product.save();

      await WarehouseStockMovement.create({
        workspaceId: req.workspaceId,
        productId: product._id,
        productName: product.name,
        sku: product.sku,
        unit: product.unit || "units",
        movementType: "received",
        quantityDelta: Number(update.quantity || 0),
        previousStock,
        resultingStock: Number(product.currentStock || 0),
        sourceType: "purchase_order_receive",
        sourceId: order._id.toString(),
        note: `Received through purchase order ${order.orderNumber}.`,
        actor: req.user._id
      });
    }

    const allReceived = order.lineItems.every(
      (lineItem) => Number(lineItem.receivedQuantity || 0) >= Number(lineItem.quantity || 0)
    );

    order.status = allReceived ? "received" : "partially_received";
    order.updatedBy = req.user._id;
    if (allReceived) {
      order.receivedAt = new Date();
    }

    const expenseId = await createOrUpdatePurchaseOrderExpense({
      workspaceId: req.workspaceId,
      userId: req.user._id,
      order,
      amount: Number(receivedCost.toFixed(2))
    });
    if (expenseId) {
      order.financeExpenseId = expenseId;
    }

    await order.save();

    await writeAuditLog({
      actor: req.user._id,
      action: "warehouse.purchase_order.receive",
      targetId: order._id.toString(),
      targetType: "PurchaseOrder",
      metadata: {
        workspaceId: req.workspaceId?.toString?.() || null,
        orderNumber: order.orderNumber,
        receivedCost: Number(receivedCost.toFixed(2)),
        status: order.status
      }
    });

    const populated = await loadPurchaseOrderDetail(req, order._id);
    return res.json(serializePurchaseOrder(populated));
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }

    return res.status(500).json({ message: "Unable to receive purchase order." });
  }
});

router.patch("/:id/cancel", requirePurchaseOrderOperator, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid purchase order id." });
    }

    const order = await PurchaseOrder.findOne(buildScopedWorkspaceFilter(req, { _id: req.params.id }));
    if (!order) {
      return res.status(404).json({ message: "Purchase order not found." });
    }

    assertStatusTransition(order.status, "cancelled");
    order.status = "cancelled";
    order.updatedBy = req.user._id;
    await order.save();

    await writeAuditLog({
      actor: req.user._id,
      action: "warehouse.purchase_order.cancel",
      targetId: order._id.toString(),
      targetType: "PurchaseOrder",
      metadata: {
        workspaceId: req.workspaceId?.toString?.() || null,
        orderNumber: order.orderNumber
      }
    });

    const populated = await loadPurchaseOrderDetail(req, order._id);
    return res.json(serializePurchaseOrder(populated));
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }

    return res.status(500).json({ message: "Unable to cancel purchase order." });
  }
});

export default router;
