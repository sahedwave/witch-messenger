import { SHIPMENT_STEPS } from "../WorkspaceMessenger.constants.js";
import { messagePreview, sortThreads } from "../WorkspaceMessenger.utils.js";

export function normalizeWarehouseAlertStatus(status = "") {
  if (status === "resolved" || status === "dismissed") {
    return status;
  }

  return "active";
}

export function normalizeWarehouseOrderStatus(status = "") {
  const normalized = String(status || "").toLowerCase();
  if (["pending", "packed", "dispatched", "in_transit", "delayed", "delivered", "cancelled"].includes(normalized)) {
    return normalized;
  }

  return "dispatched";
}

export function warehouseProductStatusLabel(status = "") {
  switch (String(status || "").toLowerCase()) {
    case "paused":
      return "Paused";
    case "discontinued":
      return "Discontinued";
    default:
      return "Active";
  }
}

export function warehouseStockSignalLabel(signal = "") {
  switch (String(signal || "").toLowerCase()) {
    case "low_stock":
      return "Low stock";
    case "restock_incoming":
      return "Restock incoming";
    case "discontinued":
      return "Discontinued";
    default:
      return "Healthy";
  }
}

export function warehouseShipmentTypeLabel(type = "") {
  return String(type || "").toLowerCase() === "incoming" ? "Incoming" : "Outgoing";
}

export function warehouseMovementTypeLabel(type = "") {
  switch (String(type || "").toLowerCase()) {
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

export function formatWarehouseQuantity(value = 0) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

export function formatWarehouseQuantityDelta(value = 0, unit = "units") {
  const amount = Number(value || 0);
  return `${amount > 0 ? "+" : ""}${formatWarehouseQuantity(amount)} ${unit || "units"}`;
}

export function getWarehouseReorderThreshold(product) {
  const explicitThreshold = Number(product?.reorderThreshold ?? 0);
  if (Number.isFinite(explicitThreshold) && explicitThreshold > 0) {
    return explicitThreshold;
  }

  const minimumStock = Number(product?.minimumStock ?? 0);
  return Number.isFinite(minimumStock) ? minimumStock : 0;
}

export function isWarehouseLowStock(product) {
  const threshold = getWarehouseReorderThreshold(product);
  return threshold > 0 && Number(product?.currentStock || 0) <= threshold;
}

export function formatPurchaseOrderStatusLabel(status = "") {
  return String(status || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function mapWarehouseProductRecord(product) {
  const reorderThreshold = getWarehouseReorderThreshold(product);
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    itemType: product.itemType || "inventory",
    unit: product.unit || "units",
    unitCost: Number(product.unitCost || 0),
    currency: product.currency || "USD",
    currentStock: product.currentStock,
    minimumStock: product.minimumStock,
    reorderThreshold,
    reorderQuantity: product.reorderQuantity,
    alertStatus: normalizeWarehouseAlertStatus(product.alertStatus),
    productStatus: product.productStatus || "active",
    lastReorderQuantity: product.lastReorderQuantity || null,
    stockGap: Number(product.stockGap || Math.max(0, reorderThreshold - Number(product.currentStock || 0))),
    stockSignal: product.stockSignal || (isWarehouseLowStock(product) ? "low_stock" : "healthy"),
    updatedAt: product.updatedAt,
    createdAt: product.createdAt
  };
}

export function mapWarehouseOrderRecord(order) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    destination: order.destination,
    shipmentType: order.shipmentType || "outgoing",
    itemsCount: Number(order.itemsCount || 1),
    status: normalizeWarehouseOrderStatus(order.status),
    currentStep: typeof order.currentStep === "number" ? order.currentStep : 1,
    lastStatusUpdate: order.lastStatusUpdate || null,
    statusHistory: Array.isArray(order.statusHistory) ? order.statusHistory : [],
    estimatedDelivery: order.estimatedDelivery,
    updatedAt: order.updatedAt,
    createdAt: order.createdAt
  };
}

export function serializeWarehouseProductStateEntry(product) {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    itemType: product.itemType || "inventory",
    unit: product.unit || "units",
    unitCost: Number(product.unitCost || 0),
    currency: product.currency || "USD",
    currentStock: product.currentStock,
    minimumStock: product.minimumStock,
    reorderThreshold: getWarehouseReorderThreshold(product),
    reorderQuantity: product.reorderQuantity,
    alertStatus: product.alertStatus,
    productStatus: product.productStatus || "active",
    lastReorderQuantity: product.lastReorderQuantity || null,
    stockGap: product.stockGap || 0,
    stockSignal: product.stockSignal || "healthy",
    updatedAt: product.updatedAt,
    createdAt: product.createdAt
  };
}

export function mapWarehouseAlertRecord(alert) {
  return {
    id: alert.itemId || alert.productId,
    itemId: alert.itemId || alert.productId,
    productId: alert.productId || alert.itemId,
    itemName: alert.itemName || alert.name || "",
    name: alert.itemName || alert.name || "",
    sku: alert.sku || "",
    currentStock: Number(alert.currentStock || 0),
    reorderThreshold: Number(alert.reorderThreshold || 0),
    reorderQuantity: Number(alert.reorderQuantity || 0),
    warehouseLocation: alert.warehouseLocation || "",
    unit: alert.unit || "units",
    unitCost: Number(alert.unitCost || 0),
    currency: alert.currency || "USD"
  };
}

export function mapPurchaseOrderRecord(order) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    vendorId: order.vendorId || null,
    vendorName: order.vendorName || "",
    status: order.status || "draft",
    lineItems: Array.isArray(order.lineItems)
      ? order.lineItems.map((lineItem) => ({
          id: lineItem.id,
          itemId: lineItem.itemId || null,
          itemName: lineItem.itemName || "",
          sku: lineItem.sku || "",
          quantity: Number(lineItem.quantity || 0),
          unitCost: Number(lineItem.unitCost || 0),
          taxRate: Number(lineItem.taxRate || 0),
          taxAmount: Number(lineItem.taxAmount || 0),
          currency: lineItem.currency || order.currency || "USD",
          receivedQuantity: Number(lineItem.receivedQuantity || 0),
          lineTotal: Number(lineItem.lineTotal || (Number(lineItem.quantity || 0) * Number(lineItem.unitCost || 0))),
          lineTotalWithTax: Number(lineItem.lineTotalWithTax || lineItem.lineTotal || (Number(lineItem.quantity || 0) * Number(lineItem.unitCost || 0)))
        }))
      : [],
    totalAmount: Number(order.totalAmount || 0),
    currency: order.currency || "USD",
    totalsByCurrency: order.totalsByCurrency || {},
    mixedCurrency: Boolean(order.mixedCurrency),
    expectedDeliveryDate: order.expectedDeliveryDate || null,
    notes: order.notes || "",
    sentAt: order.sentAt || null,
    receivedAt: order.receivedAt || null,
    financeExpenseId: order.financeExpenseId || null,
    financeExpense: order.financeExpense || null,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt
  };
}

export function serializeWarehouseOrderStateEntry(order) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    destination: order.destination,
    shipmentType: order.shipmentType || "outgoing",
    itemsCount: Number(order.itemsCount || 1),
    status: order.status,
    currentStep: order.currentStep,
    lastStatusUpdate: order.lastStatusUpdate || null,
    statusHistory: Array.isArray(order.statusHistory) ? order.statusHistory : [],
    estimatedDelivery: order.estimatedDelivery,
    updatedAt: order.updatedAt,
    createdAt: order.createdAt
  };
}

export function warehouseStatusLabel(status = "") {
  switch (normalizeWarehouseOrderStatus(status)) {
    case "pending":
      return "Pending";
    case "packed":
      return "Packed";
    case "dispatched":
      return "Dispatched";
    case "in_transit":
      return "In Transit";
    case "delayed":
      return "Delayed";
    case "delivered":
      return "Delivered";
    case "cancelled":
      return "Cancelled";
    default:
      return "Dispatched";
  }
}

export function shipmentStepIsActive(status = "", currentStep = 0, index = 0) {
  const normalized = normalizeWarehouseOrderStatus(status);
  if (normalized === "pending") {
    return false;
  }

  return index <= Number(currentStep || 0);
}

export function buildWarehouseMessagesFromRecords(warehousePayload) {
  const productMessages = warehousePayload.products.map((product) => ({
    id: `warehouse-product-${product.id}`,
    senderId: "warebot",
    senderName: "WareBot",
    createdAt: product.updatedAt || product.createdAt,
    type: "stock_alert",
    content:
      product.stockSignal === "low_stock"
        ? `${product.name} is below the warehouse threshold.`
        : product.stockSignal === "restock_incoming"
          ? `${product.name} has a restock queued for the warehouse.`
          : `${product.name} stock is being monitored in the warehouse queue.`,
    metadata: {
      alertId: `warehouse-alert-${product.id}`,
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      itemType: product.itemType,
      unit: product.unit,
      currentStock: product.currentStock,
      minimumStock: product.minimumStock,
      reorderThreshold: getWarehouseReorderThreshold(product),
      status: normalizeWarehouseAlertStatus(product.alertStatus),
      productStatus: product.productStatus || "active",
      stockSignal: product.stockSignal || "healthy",
      stockGap: Number(product.stockGap || 0),
      reorderQuantity: product.reorderQuantity,
      reorderAmount: product.lastReorderQuantity || product.reorderQuantity
    }
  }));

  const orderMessages = warehousePayload.orders.map((order) => ({
    id: `warehouse-order-${order.id}`,
    senderId: "warebot",
    senderName: "WareBot",
    createdAt: order.updatedAt || order.createdAt,
    type: "shipment",
    content: `Shipment ${order.orderNumber} is ${warehouseStatusLabel(order.status)}.`,
    metadata: {
      orderId: order.id,
      orderNumber: order.orderNumber,
      destination: order.destination,
      shipmentType: order.shipmentType || "outgoing",
      itemsCount: Number(order.itemsCount || 1),
      steps: SHIPMENT_STEPS,
      currentStep: typeof order.currentStep === "number" ? order.currentStep : 1,
      statusLabel: warehouseStatusLabel(order.status),
      estimatedDelivery: order.estimatedDelivery,
      status: normalizeWarehouseOrderStatus(order.status),
      lastStatusUpdate: order.lastStatusUpdate || null,
      statusHistory: Array.isArray(order.statusHistory) ? order.statusHistory : []
    }
  }));

  return [...productMessages, ...orderMessages].sort(
    (first, second) => new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime()
  );
}

export function applyRealWarehouseRecords(current, warehousePayload) {
  const mappedProducts = warehousePayload.products.map(mapWarehouseProductRecord);
  const mappedOrders = warehousePayload.orders.map(mapWarehouseOrderRecord);
  const warehouseMessages = buildWarehouseMessagesFromRecords(warehousePayload);
  const lastWarehouseMessage = warehouseMessages[warehouseMessages.length - 1] || null;

  return {
    ...current,
    products: mappedProducts,
    orders: mappedOrders,
    threads: sortThreads(
      current.threads.map((thread) =>
        thread.id === "warebot"
          ? {
              ...thread,
              messages: warehouseMessages,
              unread: 0,
              updatedAt: lastWarehouseMessage?.createdAt || thread.updatedAt,
              preview: lastWarehouseMessage ? messagePreview(lastWarehouseMessage) : "No warehouse records yet"
            }
          : thread
      )
    )
  };
}
