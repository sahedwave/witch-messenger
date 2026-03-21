import express from "express";
import mongoose from "mongoose";

import { authMiddleware } from "../middleware/auth.js";
import { PurchaseOrder } from "../models/PurchaseOrder.js";
import { WarehouseOrder } from "../models/WarehouseOrder.js";
import { WarehouseProduct } from "../models/WarehouseProduct.js";
import { WarehouseStockMovement } from "../models/WarehouseStockMovement.js";
import { writeAuditLog } from "../utils/audit.js";
import { ensureCurrencySupported, normalizeCurrencyCode } from "../utils/currency.js";
import { buildWorkspaceFilter, workspaceContextMiddleware, workspaceMembershipMiddleware } from "../utils/workspaceContext.js";

const router = express.Router();

const SHIPMENT_STEPS = ["Packed", "Dispatched", "In Transit", "Delivered"];
const SHIPMENT_STATUS_STEP_MAP = {
  pending: 0,
  packed: 0,
  dispatched: 1,
  in_transit: 2,
  delayed: 2,
  delivered: 3,
  cancelled: 3
};

router.use(authMiddleware);
router.use(workspaceContextMiddleware({ allowDefault: false, membershipModule: "warehouse", allowSingleMembershipFallback: true }));
router.use(workspaceMembershipMiddleware({ allowLegacyFallback: true }));

function buildScopedWorkspaceFilter(req, baseFilter = {}) {
  return buildWorkspaceFilter(req.workspace, baseFilter, {
    includeLegacy: Boolean(req.workspaceMembership?.isLegacyFallback)
  });
}

function hasWarehouseModuleAccess(membership) {
  return (
    membership &&
    Array.isArray(membership.modules) &&
    membership.modules.includes("warehouse") &&
    membership.status !== "suspended"
  );
}

function requireWarehouseViewer(req, res, next) {
  if (hasWarehouseModuleAccess(req.workspaceMembership)) {
    return next();
  }

  return res.status(403).json({ message: "Warehouse workspace access is required." });
}

function requireWarehouseOperator(req, res, next) {
  if (hasWarehouseModuleAccess(req.workspaceMembership)) {
    return next();
  }

  return res.status(403).json({ message: "Warehouse operator access is required for this action." });
}

function serializeActor(user) {
  if (!user?._id) {
    return null;
  }

  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email
  };
}

function serializeProduct(product) {
  const currentStock = Number(product.currentStock || 0);
  const reorderThreshold = Number(
    product.reorderThreshold ?? product.minimumStock ?? 0
  );
  const minimumStock = Number(product.minimumStock || 0);
  const effectiveThreshold = reorderThreshold > 0 ? reorderThreshold : minimumStock;
  const stockGap = Math.max(0, effectiveThreshold - currentStock);
  const stockSignal =
    product.productStatus === "discontinued"
      ? "discontinued"
      : effectiveThreshold > 0 && currentStock <= effectiveThreshold
        ? "low_stock"
        : product.alertStatus === "resolved"
          ? "restock_incoming"
          : "healthy";

  return {
    id: product._id.toString(),
    workspaceId: product.workspaceId?.toString?.() || null,
    name: product.name,
    sku: product.sku,
    itemType: product.itemType || "inventory",
    unit: product.unit || "units",
    unitCost: Number(product.unitCost || 0),
    currency: normalizeCurrencyCode(product.currency || "USD"),
    currentStock,
    minimumStock,
    reorderThreshold: effectiveThreshold,
    reorderQuantity: Number(product.reorderQuantity || 0),
    alertStatus: product.alertStatus,
    productStatus: product.productStatus || "active",
    lastReorderQuantity: product.lastReorderQuantity,
    stockGap,
    stockSignal,
    threadKey: product.threadKey || "warebot",
    createdBy: serializeActor(product.createdBy),
    updatedBy: serializeActor(product.updatedBy),
    createdAt: product.createdAt,
    updatedAt: product.updatedAt
  };
}

function getEffectiveReorderThreshold(product) {
  const reorderThreshold = Number(product?.reorderThreshold ?? 0);
  if (Number.isFinite(reorderThreshold) && reorderThreshold > 0) {
    return reorderThreshold;
  }

  const minimumStock = Number(product?.minimumStock ?? 0);
  return Number.isFinite(minimumStock) ? minimumStock : 0;
}

function isLowStockProduct(product) {
  const threshold = getEffectiveReorderThreshold(product);
  return threshold > 0 && Number(product?.currentStock || 0) <= threshold;
}

function buildWarehouseAlertRecord(product) {
  const threshold = getEffectiveReorderThreshold(product);
  return {
    itemId: product._id?.toString?.() || product.id,
    productId: product._id?.toString?.() || product.id,
    itemName: product.name,
    name: product.name,
    sku: product.sku,
    currentStock: Number(product.currentStock || 0),
    reorderThreshold: threshold,
    reorderQuantity: Number(product.reorderQuantity || 0),
    warehouseLocation: product.warehouseLocation || "",
    unit: product.unit || "units",
    unitCost: Number(product.unitCost || 0),
    currency: normalizeCurrencyCode(product.currency || "USD"),
    severityRatio: threshold > 0 ? Number((Number(product.currentStock || 0) / threshold).toFixed(4)) : Number.MAX_SAFE_INTEGER
  };
}

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function serializeOrder(order) {
  const statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  const latestStatusUpdate = statusHistory.length ? statusHistory[statusHistory.length - 1] : null;
  return {
    id: order._id.toString(),
    workspaceId: order.workspaceId?.toString?.() || null,
    orderNumber: order.orderNumber,
    destination: order.destination,
    shipmentType: order.shipmentType || "outgoing",
    itemsCount: Number(order.itemsCount || 1),
    status: order.status,
    currentStep: order.currentStep,
    estimatedDelivery: order.estimatedDelivery,
    threadKey: order.threadKey || "warebot",
    createdBy: serializeActor(order.createdBy),
    updatedBy: serializeActor(order.updatedBy),
    lastStatusUpdate: latestStatusUpdate
      ? {
          status: latestStatusUpdate.status,
          currentStep: Number(latestStatusUpdate.currentStep || 0),
          note: latestStatusUpdate.note || "",
          actor: serializeActor(latestStatusUpdate.actor),
          changedAt: latestStatusUpdate.changedAt
        }
      : null,
    statusHistory: statusHistory.map((entry) => ({
      status: entry.status,
      currentStep: Number(entry.currentStep || 0),
      note: entry.note || "",
      actor: serializeActor(entry.actor),
      changedAt: entry.changedAt
    })),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt
  };
}

function warehouseMovementTypeLabel(movementType = "") {
  switch (movementType) {
    case "initial":
      return "Initial stock";
    case "received":
      return "Received stock";
    case "fulfilled":
      return "Stock reduced";
    default:
      return "Stock adjusted";
  }
}

function serializeMovement(movement) {
  return {
    id: movement._id.toString(),
    workspaceId: movement.workspaceId?.toString?.() || null,
    productId: movement.productId?.toString?.() || null,
    productName: movement.productName,
    sku: movement.sku,
    unit: movement.unit || "units",
    movementType: movement.movementType || "adjustment",
    movementLabel: warehouseMovementTypeLabel(movement.movementType),
    quantityDelta: Number(movement.quantityDelta || 0),
    previousStock: Number(movement.previousStock || 0),
    resultingStock: Number(movement.resultingStock || 0),
    sourceType: movement.sourceType || "stock_adjustment",
    sourceId: movement.sourceId || null,
    note: movement.note || "",
    actor: serializeActor(movement.actor),
    createdAt: movement.createdAt,
    updatedAt: movement.updatedAt
  };
}

function buildProductMovementSnapshot(movement) {
  if (!movement) {
    return null;
  }

  return {
    id: movement._id.toString(),
    movementType: movement.movementType || "adjustment",
    movementLabel: warehouseMovementTypeLabel(movement.movementType),
    quantityDelta: Number(movement.quantityDelta || 0),
    previousStock: Number(movement.previousStock || 0),
    resultingStock: Number(movement.resultingStock || 0),
    createdAt: movement.createdAt,
    actor: serializeActor(movement.actor),
    note: movement.note || ""
  };
}

async function recordWarehouseMovement({
  req,
  product,
  previousStock,
  movementType,
  quantityDelta,
  sourceType,
  sourceId = null,
  note = ""
}) {
  if (!product?._id) {
    return null;
  }

  const normalizedDelta = Number(quantityDelta || 0);
  if (!Number.isFinite(normalizedDelta) || normalizedDelta === 0) {
    return null;
  }

  const movement = await WarehouseStockMovement.create({
    workspaceId: req.workspaceId,
    productId: product._id,
    productName: product.name,
    sku: product.sku,
    unit: product.unit || "units",
    movementType,
    quantityDelta: normalizedDelta,
    previousStock: Number(previousStock || 0),
    resultingStock: Number(product.currentStock || 0),
    sourceType,
    sourceId,
    note: String(note || "").trim().slice(0, 280),
    actor: req.user._id
  });

  return WarehouseStockMovement.findById(movement._id).populate("actor", "name email");
}

function validateStockAdjustmentPayload(payload = {}) {
  const errors = [];
  const quantityDelta = Number(payload.quantityDelta);

  if (!Number.isFinite(quantityDelta) || quantityDelta === 0) {
    errors.push("Quantity change must be a valid number that is not zero.");
  }

  const movementType = String(payload.movementType || "adjustment").trim();
  if (!["received", "adjustment", "fulfilled"].includes(movementType)) {
    errors.push("Warehouse stock movement type is invalid.");
  }

  if (movementType === "received" && quantityDelta < 0) {
    errors.push("Received stock must use a positive quantity change.");
  }

  if (movementType === "fulfilled" && quantityDelta > 0) {
    errors.push("Reduced stock must use a negative quantity change.");
  }

  if (payload.note !== undefined && String(payload.note || "").trim().length > 280) {
    errors.push("Movement note must be 280 characters or fewer.");
  }

  return errors;
}

function validateProductPayload(payload = {}, { partial = false } = {}) {
  const errors = [];

  if (!partial || payload.name !== undefined) {
    if (!String(payload.name || "").trim()) {
      errors.push("Product name is required.");
    }
  }

  if (!partial || payload.sku !== undefined) {
    if (!String(payload.sku || "").trim()) {
      errors.push("SKU is required.");
    }
  }

  if (!partial || payload.currentStock !== undefined) {
    const value = Number(payload.currentStock);
    if (!Number.isFinite(value) || value < 0) {
      errors.push("Current stock must be a valid non-negative number.");
    }
  }

  if (!partial || payload.minimumStock !== undefined) {
    const value = Number(payload.minimumStock);
    if (!Number.isFinite(value) || value < 0) {
      errors.push("Minimum stock must be a valid non-negative number.");
    }
  }

  if (payload.reorderThreshold !== undefined) {
    const value = Number(payload.reorderThreshold);
    if (!Number.isFinite(value) || value < 0) {
      errors.push("Reorder threshold must be a valid non-negative number.");
    }
  }

  if (!partial || payload.reorderQuantity !== undefined) {
    const value = Number(payload.reorderQuantity);
    if (!Number.isFinite(value) || value < 0) {
      errors.push("Reorder quantity must be a valid non-negative number.");
    }
  }

  if (payload.unitCost !== undefined) {
    const value = Number(payload.unitCost);
    if (!Number.isFinite(value) || value < 0) {
      errors.push("Unit cost must be a valid non-negative number.");
    }
  }

  if (payload.currency !== undefined) {
    const currencyError = ensureCurrencySupported(payload.currency, "Product currency");
    if (currencyError) {
      errors.push(currencyError);
    }
  }

  if (payload.alertStatus !== undefined) {
    const allowed = ["active", "resolved", "dismissed"];
    if (!allowed.includes(payload.alertStatus)) {
      errors.push("Warehouse alert status is invalid.");
    }
  }

  if (payload.itemType !== undefined && String(payload.itemType || "").trim().length > 40) {
    errors.push("Item type must be 40 characters or fewer.");
  }

  if (payload.unit !== undefined && String(payload.unit || "").trim().length > 40) {
    errors.push("Unit must be 40 characters or fewer.");
  }

  if (payload.productStatus !== undefined) {
    const allowed = ["active", "paused", "discontinued"];
    if (!allowed.includes(payload.productStatus)) {
      errors.push("Warehouse product status is invalid.");
    }
  }

  return errors;
}

function validateOrderPayload(payload = {}, { partial = false } = {}) {
  const errors = [];

  if (!partial || payload.orderNumber !== undefined) {
    if (!String(payload.orderNumber || "").trim()) {
      errors.push("Order number is required.");
    }
  }

  if (!partial || payload.destination !== undefined) {
    if (!String(payload.destination || "").trim()) {
      errors.push("Destination is required.");
    }
  }

  if (!partial || payload.estimatedDelivery !== undefined) {
    const estimatedDelivery = new Date(payload.estimatedDelivery);
    if (Number.isNaN(estimatedDelivery.getTime())) {
      errors.push("Estimated delivery must be a valid date.");
    }
  }

  if (payload.status !== undefined) {
    const allowed = ["pending", "packed", "dispatched", "in_transit", "delayed", "delivered", "cancelled"];
    if (!allowed.includes(payload.status)) {
      errors.push("Shipment status is invalid.");
    }
  }

  if (payload.shipmentType !== undefined) {
    const allowed = ["outgoing", "incoming"];
    if (!allowed.includes(payload.shipmentType)) {
      errors.push("Shipment type is invalid.");
    }
  }

  if (payload.itemsCount !== undefined) {
    const itemsCount = Number(payload.itemsCount);
    if (!Number.isFinite(itemsCount) || itemsCount < 1) {
      errors.push("Items count must be a valid number greater than zero.");
    }
  }

  if (payload.currentStep !== undefined) {
    const currentStep = Number(payload.currentStep);
    if (!Number.isInteger(currentStep) || currentStep < 0 || currentStep > SHIPMENT_STEPS.length - 1) {
      errors.push("Current shipment step is invalid.");
    }
  }

  return errors;
}

function resolveShipmentCurrentStep(status = "", fallbackStep = 1) {
  const normalized = String(status || "").trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(SHIPMENT_STATUS_STEP_MAP, normalized)) {
    return SHIPMENT_STATUS_STEP_MAP[normalized];
  }

  return fallbackStep;
}

function buildShipmentStatusHistoryEntry({ status, actorId, note = "" }) {
  return {
    status,
    currentStep: resolveShipmentCurrentStep(status, 1),
    note: String(note || "").trim().slice(0, 240),
    actor: actorId,
    changedAt: new Date()
  };
}

function validateShipmentStatusUpdatePayload(payload = {}) {
  const errors = [];
  const status = String(payload.status || "").trim().toLowerCase();
  const allowed = ["pending", "packed", "dispatched", "in_transit", "delayed", "delivered", "cancelled"];

  if (!allowed.includes(status)) {
    errors.push("Shipment status is invalid.");
  }

  if (payload.note !== undefined && String(payload.note || "").trim().length > 240) {
    errors.push("Shipment note must be 240 characters or fewer.");
  }

  return errors;
}

router.use(requireWarehouseViewer);

router.get("/alerts", async (req, res) => {
  try {
    const products = await WarehouseProduct.find(
      buildScopedWorkspaceFilter(req, {
        productStatus: { $ne: "discontinued" }
      })
    )
      .select("name sku unit unitCost currency currentStock minimumStock reorderThreshold reorderQuantity")
      .sort({ updatedAt: -1 });

    const alerts = products
      .filter(isLowStockProduct)
      .map(buildWarehouseAlertRecord)
      .sort((left, right) => {
        if (left.severityRatio !== right.severityRatio) {
          return left.severityRatio - right.severityRatio;
        }

        return left.currentStock - right.currentStock;
      })
      .map(({ severityRatio, ...entry }) => entry);

    return res.json(alerts);
  } catch (error) {
    return res.status(500).json({ message: "Unable to load warehouse alerts." });
  }
});

router.get("/summary", async (req, res) => {
  try {
    const [products, orders, movements, purchaseOrders] = await Promise.all([
      WarehouseProduct.find(buildScopedWorkspaceFilter(req))
        .select("name sku itemType unit unitCost currency currentStock minimumStock reorderThreshold reorderQuantity alertStatus productStatus lastReorderQuantity updatedAt createdAt")
        .sort({ updatedAt: -1 })
        .limit(100),
      WarehouseOrder.find(buildScopedWorkspaceFilter(req))
        .select("orderNumber destination shipmentType itemsCount status currentStep estimatedDelivery updatedAt createdAt statusHistory")
        .sort({ updatedAt: -1 })
        .limit(100)
        .populate("statusHistory.actor", "name email"),
      WarehouseStockMovement.find(buildScopedWorkspaceFilter(req))
        .sort({ createdAt: -1 })
        .limit(24)
        .populate("actor", "name email"),
      PurchaseOrder.find(buildScopedWorkspaceFilter(req, { status: { $in: ["sent", "acknowledged", "partially_received"] } }))
        .select("status createdAt updatedAt")
        .sort({ updatedAt: -1 })
        .limit(100)
    ]);

    const trackedProducts = products.length;
    const latestMovementByProductId = new Map();
    movements.forEach((movement) => {
      const productId = movement.productId?.toString?.();
      if (productId && !latestMovementByProductId.has(productId)) {
        latestMovementByProductId.set(productId, movement);
      }
    });

    const lowStockProducts = products
      .filter(isLowStockProduct)
      .map((product) => ({
        id: product._id.toString(),
        name: product.name,
        sku: product.sku,
        itemType: product.itemType || "inventory",
        unit: product.unit || "units",
        currentStock: Number(product.currentStock || 0),
        minimumStock: Number(product.minimumStock || 0),
        reorderThreshold: getEffectiveReorderThreshold(product),
        reorderQuantity: Number(product.reorderQuantity || 0),
        productStatus: product.productStatus || "active",
        stockGap: Math.max(0, getEffectiveReorderThreshold(product) - Number(product.currentStock || 0)),
        latestMovement: buildProductMovementSnapshot(latestMovementByProductId.get(product._id.toString()))
      }))
      .sort((left, right) => {
        const leftRatio = left.reorderThreshold > 0 ? left.currentStock / left.reorderThreshold : Number.MAX_SAFE_INTEGER;
        const rightRatio = right.reorderThreshold > 0 ? right.currentStock / right.reorderThreshold : Number.MAX_SAFE_INTEGER;
        if (leftRatio !== rightRatio) {
          return leftRatio - rightRatio;
        }
        return right.stockGap - left.stockGap;
      });

    const inTransitOrders = orders.filter((order) => order.status === "in_transit").length;
    const deliveredOrders = orders.filter((order) => order.status === "delivered").length;
    const delayedOrders = orders.filter((order) => order.status === "delayed").length;
    const incomingShipments = orders.filter((order) => order.shipmentType === "incoming" && ["pending", "packed", "dispatched", "in_transit"].includes(order.status)).length;
    const outgoingShipments = orders.filter((order) => order.shipmentType !== "incoming" && ["pending", "packed", "dispatched", "in_transit"].includes(order.status)).length;
    const productStatusBreakdown = products.reduce((accumulator, product) => {
      const status = product.productStatus || "active";
      accumulator[status] = (accumulator[status] || 0) + 1;
      return accumulator;
    }, { active: 0, paused: 0, discontinued: 0 });
    const recentShipmentActivity = orders.slice(0, 6).map((order) => ({
      id: order._id.toString(),
      orderNumber: order.orderNumber,
      destination: order.destination,
      shipmentType: order.shipmentType || "outgoing",
      itemsCount: Number(order.itemsCount || 1),
      status: order.status,
      currentStep: Number(order.currentStep || 0),
      estimatedDelivery: order.estimatedDelivery,
      lastStatusUpdate: serializeOrder(order).lastStatusUpdate,
      updatedAt: order.updatedAt,
      createdAt: order.createdAt
    }));
    const mostActiveProducts = [...products]
      .sort((left, right) => new Date(right.updatedAt || right.createdAt).getTime() - new Date(left.updatedAt || left.createdAt).getTime())
      .slice(0, 5)
      .map((product) => ({
        id: product._id.toString(),
        name: product.name,
        sku: product.sku,
        itemType: product.itemType || "inventory",
        unit: product.unit || "units",
        currentStock: Number(product.currentStock || 0),
        minimumStock: Number(product.minimumStock || 0),
        reorderThreshold: getEffectiveReorderThreshold(product),
        alertStatus: product.alertStatus || "active",
        productStatus: product.productStatus || "active",
        updatedAt: product.updatedAt
      }));
    const reorderAttention = lowStockProducts.filter((product) => product.productStatus === "active").length;
    const pendingPurchaseOrders = purchaseOrders.length;
    const inventoryValueByCurrency = products.reduce((accumulator, product) => {
      const currency = normalizeCurrencyCode(product.currency || req.workspace?.defaultCurrency || "USD");
      const value = roundMoney(Number(product.currentStock || 0) * Number(product.unitCost || 0));
      accumulator[currency] = roundMoney(Number(accumulator[currency] || 0) + value);
      return accumulator;
    }, {});
    const warehouseHandoffCues = [
      reorderAttention && outgoingShipments
        ? {
            id: "warehouse-handoff-stock-outbound",
            signal: "attention",
            title: "Replenishment pressure may affect outbound shipments",
            detail: `${reorderAttention} product${reorderAttention === 1 ? "" : "s"} need replenishment while ${outgoingShipments} outgoing shipment${outgoingShipments === 1 ? "" : "s"} are still moving through the warehouse.`,
            targetMetricId: "warehouse-in-transit"
          }
        : null,
      delayedOrders && reorderAttention
        ? {
            id: "warehouse-handoff-delay-reorder",
            signal: "risk",
            title: "Delayed shipments and low stock are active together",
            detail: `${delayedOrders} shipment${delayedOrders === 1 ? "" : "s"} are delayed while ${reorderAttention} replenishment signal${reorderAttention === 1 ? "" : "s"} are still open.`,
            targetMetricId: "warehouse-low-stock"
          }
        : null,
      incomingShipments && reorderAttention
        ? {
            id: "warehouse-handoff-incoming-relief",
            signal: "watch",
            title: "Incoming shipments may relieve low-stock pressure",
            detail: `${incomingShipments} incoming shipment${incomingShipments === 1 ? "" : "s"} are active while ${reorderAttention} replenishment item${reorderAttention === 1 ? "" : "s"} remain open.`,
            targetMetricId: "warehouse-in-transit"
          }
        : null
    ].filter(Boolean).slice(0, 3);

    return res.json({
      trackedProducts,
      lowStockItems: lowStockProducts.length,
      inTransitOrders,
      deliveredOrders,
      delayedOrders,
      pendingPurchaseOrders,
      inventoryValue: inventoryValueByCurrency,
      incomingShipments,
      outgoingShipments,
      reorderAttention,
      productStatusBreakdown,
      lowStockProducts: lowStockProducts.slice(0, 6),
      recentShipmentActivity,
      mostActiveProducts,
      recentStockMovements: movements.slice(0, 8).map(serializeMovement),
      stockAlerts: lowStockProducts.slice(0, 8),
      warehouseHandoffCues
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load warehouse summary." });
  }
});

router.get("/reports/inventory-value", async (req, res) => {
  try {
    const products = await WarehouseProduct.find(buildScopedWorkspaceFilter(req))
      .select("name sku itemType unit unitCost currency currentStock reorderThreshold minimumStock reorderQuantity productStatus")
      .sort({ itemType: 1, name: 1 });

    const totalsByCurrency = {};
    const categoryTotals = {};
    const lowStockItems = [];

    for (const product of products) {
      const currency = normalizeCurrencyCode(product.currency || req.workspace?.defaultCurrency || "USD");
      const category = String(product.itemType || "inventory").trim() || "inventory";
      const value = roundMoney(Number(product.currentStock || 0) * Number(product.unitCost || 0));

      totalsByCurrency[currency] = roundMoney(Number(totalsByCurrency[currency] || 0) + value);

      if (!categoryTotals[category]) {
        categoryTotals[category] = {};
      }
      categoryTotals[category][currency] = roundMoney(Number(categoryTotals[category][currency] || 0) + value);

      if (isLowStockProduct(product)) {
        lowStockItems.push({
          id: product._id.toString(),
          name: product.name,
          sku: product.sku,
          currentStock: Number(product.currentStock || 0),
          reorderThreshold: getEffectiveReorderThreshold(product),
          reorderQuantity: Number(product.reorderQuantity || 0),
          unit: product.unit || "units",
          unitCost: Number(product.unitCost || 0),
          currency,
          inventoryValue: value
        });
      }
    }

    const categories = Object.entries(categoryTotals)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([category, totals]) => ({
        category,
        totals
      }));

    return res.json({
      totals: totalsByCurrency,
      categories,
      lowStockItems: lowStockItems.sort((left, right) => {
        const leftRatio = left.reorderThreshold > 0 ? left.currentStock / left.reorderThreshold : Number.MAX_SAFE_INTEGER;
        const rightRatio = right.reorderThreshold > 0 ? right.currentStock / right.reorderThreshold : Number.MAX_SAFE_INTEGER;
        if (leftRatio !== rightRatio) {
          return leftRatio - rightRatio;
        }
        return left.currentStock - right.currentStock;
      })
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load inventory value report." });
  }
});

router.get("/movements", async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 50);
    const filter = buildScopedWorkspaceFilter(req);

    if (req.query.productId) {
      if (!mongoose.isValidObjectId(req.query.productId)) {
        return res.status(400).json({ message: "Invalid product id." });
      }
      filter.productId = req.query.productId;
    }

    const movements = await WarehouseStockMovement.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("actor", "name email");

    return res.json(movements.map(serializeMovement));
  } catch (error) {
    return res.status(500).json({ message: "Unable to load warehouse stock movements." });
  }
});

router.get("/products/:id/movements", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid product id." });
    }

    const product = await WarehouseProduct.findOne(buildScopedWorkspaceFilter(req, { _id: req.params.id }))
      .populate("createdBy updatedBy", "name email");

    if (!product) {
      return res.status(404).json({ message: "Warehouse product not found." });
    }

    const movements = await WarehouseStockMovement.find(
      buildScopedWorkspaceFilter(req, { productId: req.params.id })
    )
      .sort({ createdAt: -1 })
      .limit(12)
      .populate("actor", "name email");

    const receivedCount = movements.filter((movement) => Number(movement.quantityDelta || 0) > 0).length;
    const reducedCount = movements.filter((movement) => Number(movement.quantityDelta || 0) < 0).length;
    const latestMovement = movements[0] || null;

    return res.json({
      product: serializeProduct(product),
      reorderReview: {
        stockGap: Math.max(0, getEffectiveReorderThreshold(product) - Number(product.currentStock || 0)),
        needsReorder: isLowStockProduct(product),
        latestMovement: latestMovement ? serializeMovement(latestMovement) : null,
        receivedCount,
        reducedCount
      },
      movements: movements.map(serializeMovement)
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load warehouse product movement history." });
  }
});

router.get("/products", async (req, res) => {
  try {
    const products = await WarehouseProduct.find(buildScopedWorkspaceFilter(req))
      .sort({ updatedAt: -1, createdAt: -1 })
      .populate("createdBy updatedBy", "name email");

    return res.json(products.map(serializeProduct));
  } catch (error) {
    return res.status(500).json({ message: "Unable to load warehouse products." });
  }
});

router.post("/products", requireWarehouseOperator, async (req, res) => {
  try {
    const errors = validateProductPayload(req.body);
    if (errors.length) {
      return res.status(400).json({ message: errors[0], errors });
    }

    const product = await WarehouseProduct.create({
      workspaceId: req.workspaceId,
      name: String(req.body.name).trim(),
      sku: String(req.body.sku).trim().toUpperCase(),
      itemType: String(req.body.itemType || "inventory").trim().slice(0, 40) || "inventory",
      unit: String(req.body.unit || "units").trim().slice(0, 40) || "units",
      unitCost: Number(req.body.unitCost || 0),
      currency: normalizeCurrencyCode(req.body.currency || req.workspace?.defaultCurrency || "USD"),
      currentStock: Number(req.body.currentStock),
      minimumStock: Number(req.body.minimumStock),
      reorderThreshold: req.body.reorderThreshold !== undefined ? Number(req.body.reorderThreshold) : Number(req.body.minimumStock),
      reorderQuantity: Number(req.body.reorderQuantity),
      alertStatus: req.body.alertStatus || "active",
      productStatus: req.body.productStatus || "active",
      threadKey: "warebot",
      createdBy: req.user._id,
      updatedBy: req.user._id
    });

    await writeAuditLog({
      actor: req.user._id,
      action: "warehouse.product.create",
      targetId: product._id.toString(),
      targetType: "WarehouseProduct",
      metadata: {
        workspaceId: req.workspaceId?.toString?.() || null,
        sku: product.sku,
        productName: product.name
      }
    });

    if (Number(product.currentStock || 0) > 0) {
      await recordWarehouseMovement({
        req,
        product,
        previousStock: 0,
        movementType: "initial",
        quantityDelta: Number(product.currentStock || 0),
        sourceType: "product_create",
        sourceId: product._id.toString(),
        note: "Starting stock recorded when the product was added."
      });
    }

    const populated = await WarehouseProduct.findOne({ _id: product._id, workspaceId: req.workspaceId }).populate("createdBy updatedBy", "name email");
    return res.status(201).json(serializeProduct(populated));
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: "A product with that SKU already exists in this workspace." });
    }

    return res.status(500).json({ message: "Unable to create warehouse product." });
  }
});

router.patch("/products/:id", requireWarehouseOperator, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid product id." });
    }

    const errors = validateProductPayload(req.body, { partial: true });
    if (errors.length) {
      return res.status(400).json({ message: errors[0], errors });
    }

    const product = await WarehouseProduct.findOne(buildScopedWorkspaceFilter(req, { _id: req.params.id }));

    if (!product) {
      return res.status(404).json({ message: "Warehouse product not found." });
    }

    const previousStock = Number(product.currentStock || 0);

    if (req.body.name !== undefined) product.name = String(req.body.name).trim();
    if (req.body.sku !== undefined) product.sku = String(req.body.sku).trim().toUpperCase();
    if (req.body.itemType !== undefined) product.itemType = String(req.body.itemType).trim().slice(0, 40);
    if (req.body.unit !== undefined) product.unit = String(req.body.unit).trim().slice(0, 40);
    if (req.body.unitCost !== undefined) product.unitCost = Number(req.body.unitCost);
    if (req.body.currency !== undefined) product.currency = normalizeCurrencyCode(req.body.currency || req.workspace?.defaultCurrency || "USD");
    if (req.body.currentStock !== undefined) product.currentStock = Number(req.body.currentStock);
    if (req.body.minimumStock !== undefined) product.minimumStock = Number(req.body.minimumStock);
    if (req.body.reorderThreshold !== undefined) product.reorderThreshold = Number(req.body.reorderThreshold);
    if (req.body.reorderQuantity !== undefined) product.reorderQuantity = Number(req.body.reorderQuantity);
    if (req.body.alertStatus !== undefined) product.alertStatus = req.body.alertStatus;
    if (req.body.productStatus !== undefined) product.productStatus = req.body.productStatus;
    product.updatedBy = req.user._id;
    product.workspaceId = req.workspaceId;

    await product.save();

    const quantityDelta = Number(product.currentStock || 0) - previousStock;
    if (quantityDelta !== 0) {
      await recordWarehouseMovement({
        req,
        product,
        previousStock,
        movementType: "adjustment",
        quantityDelta,
        sourceType: "product_update",
        sourceId: product._id.toString(),
        note: req.body.movementNote || "Stock was updated from the warehouse catalog."
      });
    }

    await product.populate("createdBy updatedBy", "name email");

    return res.json(serializeProduct(product));
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: "A product with that SKU already exists in this workspace." });
    }

    return res.status(500).json({ message: "Unable to update warehouse product." });
  }
});

router.patch("/products/:id/adjust-stock", requireWarehouseOperator, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid product id." });
    }

    const errors = validateStockAdjustmentPayload(req.body);
    if (errors.length) {
      return res.status(400).json({ message: errors[0], errors });
    }

    const product = await WarehouseProduct.findOne(buildScopedWorkspaceFilter(req, { _id: req.params.id }));
    if (!product) {
      return res.status(404).json({ message: "Warehouse product not found." });
    }

    const quantityDelta = Number(req.body.quantityDelta);
    const previousStock = Number(product.currentStock || 0);
    const nextStock = previousStock + quantityDelta;

    if (nextStock < 0) {
      return res.status(400).json({ message: "This stock change would push the product below zero." });
    }

    product.currentStock = nextStock;
    product.updatedBy = req.user._id;
    product.workspaceId = req.workspaceId;
    await product.save();

    const movement = await recordWarehouseMovement({
      req,
      product,
      previousStock,
      movementType: req.body.movementType || "adjustment",
      quantityDelta,
      sourceType: "stock_adjustment",
      sourceId: product._id.toString(),
      note: req.body.note || ""
    });

    await writeAuditLog({
      actor: req.user._id,
      action: "warehouse.product.adjust_stock",
      targetId: product._id.toString(),
      targetType: "WarehouseProduct",
      metadata: {
        workspaceId: req.workspaceId?.toString?.() || null,
        sku: product.sku,
        quantityDelta,
        previousStock,
        resultingStock: nextStock,
        movementType: req.body.movementType || "adjustment"
      }
    });

    await product.populate("createdBy updatedBy", "name email");

    return res.json({
      product: serializeProduct(product),
      movement: movement ? serializeMovement(movement) : null
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to adjust warehouse stock." });
  }
});

router.patch("/products/:id/reorder", requireWarehouseOperator, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid product id." });
    }

    const reorderQuantity = Number(req.body.reorderQuantity);
    if (!Number.isFinite(reorderQuantity) || reorderQuantity < 1) {
      return res.status(400).json({ message: "Reorder quantity must be greater than zero." });
    }

    const product = await WarehouseProduct.findOneAndUpdate(
      buildScopedWorkspaceFilter(req, { _id: req.params.id }),
      {
        $set: {
          workspaceId: req.workspaceId,
          alertStatus: "resolved",
          lastReorderQuantity: reorderQuantity,
          reorderQuantity,
          updatedBy: req.user._id
        }
      },
      { new: true }
    ).populate("createdBy updatedBy", "name email");

    if (!product) {
      return res.status(404).json({ message: "Warehouse product not found." });
    }

    await writeAuditLog({
      actor: req.user._id,
      action: "warehouse.product.reorder",
      targetId: product._id.toString(),
      targetType: "WarehouseProduct",
      metadata: {
        workspaceId: req.workspaceId?.toString?.() || null,
        sku: product.sku,
        reorderQuantity
      }
    });

    return res.json(serializeProduct(product));
  } catch (error) {
    return res.status(500).json({ message: "Unable to record warehouse reorder." });
  }
});

router.patch("/products/:id/dismiss", requireWarehouseOperator, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid product id." });
    }

    const product = await WarehouseProduct.findOneAndUpdate(
      buildScopedWorkspaceFilter(req, { _id: req.params.id }),
      {
        $set: {
          workspaceId: req.workspaceId,
          alertStatus: "dismissed",
          updatedBy: req.user._id
        }
      },
      { new: true }
    ).populate("createdBy updatedBy", "name email");

    if (!product) {
      return res.status(404).json({ message: "Warehouse product not found." });
    }

    return res.json(serializeProduct(product));
  } catch (error) {
    return res.status(500).json({ message: "Unable to dismiss warehouse alert." });
  }
});

router.get("/orders", async (req, res) => {
  try {
    const orders = await WarehouseOrder.find(buildScopedWorkspaceFilter(req))
      .sort({ updatedAt: -1, createdAt: -1 })
      .populate("createdBy updatedBy statusHistory.actor", "name email");

    return res.json(orders.map(serializeOrder));
  } catch (error) {
    return res.status(500).json({ message: "Unable to load warehouse orders." });
  }
});

router.get("/orders/:id/review", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid order id." });
    }

    const order = await WarehouseOrder.findOne(buildScopedWorkspaceFilter(req, { _id: req.params.id }))
      .populate("createdBy updatedBy statusHistory.actor", "name email");

    if (!order) {
      return res.status(404).json({ message: "Warehouse order not found." });
    }

    const serializedOrder = serializeOrder(order);
    const statusHistory = Array.isArray(serializedOrder.statusHistory) ? serializedOrder.statusHistory : [];
    const recentHistory = [...statusHistory].slice(-6).reverse();
    const delayedEvents = statusHistory.filter((entry) => entry.status === "delayed").length;
    const lastProgressAt = recentHistory[0]?.changedAt || serializedOrder.updatedAt || serializedOrder.createdAt || null;

    return res.json({
      order: serializedOrder,
      review: {
        currentStatus: serializedOrder.status,
        currentStep: Number(serializedOrder.currentStep || 0),
        delayedEvents,
        totalStatusChanges: statusHistory.length,
        lastProgressAt
      },
      recentHistory
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load warehouse shipment review." });
  }
});

router.post("/orders", requireWarehouseOperator, async (req, res) => {
  try {
    const errors = validateOrderPayload(req.body);
    if (errors.length) {
      return res.status(400).json({ message: errors[0], errors });
    }

    const order = await WarehouseOrder.create({
      workspaceId: req.workspaceId,
      orderNumber: String(req.body.orderNumber).trim().toUpperCase(),
      destination: String(req.body.destination).trim(),
      shipmentType: req.body.shipmentType || "outgoing",
      itemsCount: req.body.itemsCount ?? 1,
      status: req.body.status || "dispatched",
      currentStep: resolveShipmentCurrentStep(req.body.status || "dispatched", req.body.currentStep ?? 1),
      estimatedDelivery: new Date(req.body.estimatedDelivery),
      threadKey: "warebot",
      createdBy: req.user._id,
      updatedBy: req.user._id,
      statusHistory: [buildShipmentStatusHistoryEntry({ status: req.body.status || "dispatched", actorId: req.user._id, note: "Shipment created." })]
    });

    await writeAuditLog({
      actor: req.user._id,
      action: "warehouse.order.create",
      targetId: order._id.toString(),
      targetType: "WarehouseOrder",
      metadata: {
        workspaceId: req.workspaceId?.toString?.() || null,
        orderNumber: order.orderNumber
      }
    });

    const populated = await WarehouseOrder.findOne({ _id: order._id, workspaceId: req.workspaceId }).populate("createdBy updatedBy statusHistory.actor", "name email");
    return res.status(201).json(serializeOrder(populated));
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: "An order with that number already exists in this workspace." });
    }

    return res.status(500).json({ message: "Unable to create warehouse order." });
  }
});

router.patch("/orders/:id/delivered", requireWarehouseOperator, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid order id." });
    }

    const order = await WarehouseOrder.findOne(buildScopedWorkspaceFilter(req, { _id: req.params.id }));

    if (!order) {
      return res.status(404).json({ message: "Warehouse order not found." });
    }

    order.workspaceId = req.workspaceId;
    order.status = "delivered";
    order.currentStep = SHIPMENT_STEPS.length - 1;
    order.updatedBy = req.user._id;
    order.statusHistory = [
      ...(Array.isArray(order.statusHistory) ? order.statusHistory : []),
      buildShipmentStatusHistoryEntry({ status: "delivered", actorId: req.user._id, note: "Shipment marked delivered." })
    ];
    await order.save();

    await writeAuditLog({
      actor: req.user._id,
      action: "warehouse.order.update_status",
      targetId: order._id.toString(),
      targetType: "WarehouseOrder",
      metadata: {
        workspaceId: req.workspaceId?.toString?.() || null,
        orderNumber: order.orderNumber,
        status: "delivered"
      }
    });

    await order.populate("createdBy updatedBy statusHistory.actor", "name email");

    return res.json(serializeOrder(order));
  } catch (error) {
    return res.status(500).json({ message: "Unable to mark warehouse order as delivered." });
  }
});

router.patch("/orders/:id/status", requireWarehouseOperator, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid order id." });
    }

    const errors = validateShipmentStatusUpdatePayload(req.body);
    if (errors.length) {
      return res.status(400).json({ message: errors[0], errors });
    }

    const order = await WarehouseOrder.findOne(buildScopedWorkspaceFilter(req, { _id: req.params.id }));
    if (!order) {
      return res.status(404).json({ message: "Warehouse order not found." });
    }

    const nextStatus = String(req.body.status).trim().toLowerCase();
    order.workspaceId = req.workspaceId;
    order.status = nextStatus;
    order.currentStep = resolveShipmentCurrentStep(nextStatus, order.currentStep);
    order.updatedBy = req.user._id;
    order.statusHistory = [
      ...(Array.isArray(order.statusHistory) ? order.statusHistory : []),
      buildShipmentStatusHistoryEntry({ status: nextStatus, actorId: req.user._id, note: req.body.note || "" })
    ];
    await order.save();

    await writeAuditLog({
      actor: req.user._id,
      action: "warehouse.order.update_status",
      targetId: order._id.toString(),
      targetType: "WarehouseOrder",
      metadata: {
        workspaceId: req.workspaceId?.toString?.() || null,
        orderNumber: order.orderNumber,
        status: nextStatus
      }
    });

    await order.populate("createdBy updatedBy statusHistory.actor", "name email");
    return res.json(serializeOrder(order));
  } catch (error) {
    return res.status(500).json({ message: "Unable to update warehouse shipment status." });
  }
});

export default router;
