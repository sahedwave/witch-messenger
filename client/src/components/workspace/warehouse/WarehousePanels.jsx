import { motion } from "framer-motion";
import { useEffect, useState } from "react";

import { FINANCE_CURRENCY_OPTIONS } from "../WorkspaceMessenger.constants.js";
import { formatDate, formatMoney, uid } from "../WorkspaceMessenger.utils.js";
import { formatPurchaseOrderStatusLabel, formatWarehouseQuantity, getWarehouseReorderThreshold, isWarehouseLowStock, shipmentStepIsActive, warehouseMovementTypeLabel, warehouseShipmentTypeLabel, warehouseStatusLabel, warehouseStockSignalLabel } from "./warehouse-record-mappers.js";

export function StockAlertMessageCard({ message, onReorderStart, onReorderChange, onReorderConfirm, onDismiss }) {
  const signal = message.metadata.stockSignal || "healthy";
  return (
    <motion.div layout className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-lg font-bold text-slate-900">{message.metadata.productName}</h4>
          <p className="text-sm text-slate-500">
            SKU {message.metadata.sku}
            {message.metadata.itemType ? ` · ${message.metadata.itemType}` : ""}
            {message.metadata.unit ? ` · ${message.metadata.unit}` : ""}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${
          signal === "low_stock"
            ? "bg-rose-100 text-rose-700"
            : signal === "restock_incoming"
              ? "bg-emerald-100 text-emerald-700"
              : "bg-slate-100 text-slate-700"
        }`}>
          {warehouseStockSignalLabel(signal)}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl bg-slate-50 px-3 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">On hand</div>
          <div className="mt-2 text-sm font-semibold text-slate-900">{message.metadata.currentStock} {message.metadata.unit || "units"}</div>
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Minimum</div>
          <div className="mt-2 text-sm font-semibold text-slate-900">{message.metadata.minimumStock} {message.metadata.unit || "units"}</div>
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Stock gap</div>
          <div className="mt-2 text-sm font-semibold text-slate-900">{message.metadata.stockGap || 0}</div>
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Catalog status</div>
          <div className="mt-2 text-sm font-semibold text-slate-900">{warehouseProductStatusLabel(message.metadata.productStatus)}</div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => onReorderStart(message)} className="rounded-full bg-[#2D8EFF] px-4 py-2 text-sm font-bold text-white shadow-sm">
          Reorder Now
        </button>
        <button type="button" onClick={() => onDismiss(message)} className="rounded-full bg-slate-100 px-4 py-2 text-sm font-bold text-slate-600">
          Dismiss
        </button>
      </div>
      {message.metadata.showQuantityInput ? (
        <div className="mt-3 rounded-2xl bg-slate-50 p-3">
          <input
            type="number"
            min="1"
            value={message.metadata.reorderAmount || message.metadata.reorderQuantity}
            onChange={(event) => onReorderChange(message, event.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
          />
          <button
            type="button"
            onClick={() => onReorderConfirm(message)}
            className="mt-3 rounded-full bg-slate-900 px-4 py-2 text-sm font-bold text-white"
          >
            Confirm reorder
          </button>
        </div>
      ) : null}
      {message.metadata.status === "resolved" ? (
        <p className="mt-3 text-sm font-medium text-emerald-700">Reorder confirmed.</p>
      ) : null}
      {message.metadata.status === "dismissed" ? (
        <p className="mt-3 text-sm font-medium text-slate-500">Alert dismissed.</p>
      ) : null}
    </motion.div>
  );
}

export function ShipmentMessageCard({ message, canManage, onMarkDelivered, onUpdateStatus }) {
  const [selectedStatus, setSelectedStatus] = useState(message.metadata.status || "dispatched");
  const [statusSubmitting, setStatusSubmitting] = useState(false);
  const latestStatusUpdate = message.metadata.lastStatusUpdate || null;

  useEffect(() => {
    setSelectedStatus(message.metadata.status || "dispatched");
  }, [message.metadata.status]);

  async function handleUpdateStatus() {
    if (!onUpdateStatus || !message.metadata.orderId || !selectedStatus) {
      return;
    }

    setStatusSubmitting(true);
    try {
      await onUpdateStatus(message, selectedStatus);
    } finally {
      setStatusSubmitting(false);
    }
  }

  return (
    <motion.div layout className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{message.metadata.orderNumber}</p>
          <h4 className="mt-1 text-lg font-bold text-slate-900">{message.metadata.destination}</h4>
          <p className="mt-2 text-sm text-slate-500">
            {warehouseShipmentTypeLabel(message.metadata.shipmentType)} shipment · {message.metadata.itemsCount || 1} item{Number(message.metadata.itemsCount || 1) === 1 ? "" : "s"}
          </p>
        </div>
        <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-[#2D8EFF]">{message.metadata.statusLabel}</span>
      </div>
      <div className="mt-4 grid grid-cols-4 gap-2">
        {message.metadata.steps.map((step, index) => {
          const active = shipmentStepIsActive(message.metadata.status, message.metadata.currentStep, index);
          return (
            <div key={step} className={`rounded-xl px-3 py-2 text-center text-xs font-bold ${active ? "bg-[#E8F2FF] text-[#2D8EFF]" : "bg-slate-100 text-slate-400"}`}>
              {step}
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-sm text-slate-500">Estimated delivery: {formatDate(message.metadata.estimatedDelivery)}</p>
      {latestStatusUpdate ? (
        <div className="mt-3 rounded-2xl bg-slate-50 px-3 py-3 text-xs text-slate-500">
          Last update: {warehouseStatusLabel(latestStatusUpdate.status)} · {formatDateTime(latestStatusUpdate.changedAt)}
          {latestStatusUpdate.actor?.name ? ` · ${latestStatusUpdate.actor.name}` : ""}
          {latestStatusUpdate.note ? ` · ${latestStatusUpdate.note}` : ""}
        </div>
      ) : null}
      {canManage ? (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Status</span>
            <select
              value={selectedStatus}
              onChange={(event) => setSelectedStatus(event.target.value)}
              className="mt-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
            >
              {WAREHOUSE_SHIPMENT_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {selectedStatus === "delivered" && message.metadata.currentStep < SHIPMENT_STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => onMarkDelivered(message)}
              className="rounded-full bg-[#2D8EFF] px-4 py-2 text-sm font-bold text-white shadow-sm"
            >
              {statusSubmitting ? "Saving..." : "Mark Delivered"}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleUpdateStatus}
              disabled={statusSubmitting || selectedStatus === (message.metadata.status || "dispatched")}
              className="rounded-full bg-slate-900 px-4 py-2 text-sm font-bold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              {statusSubmitting ? "Saving..." : "Update status"}
            </button>
          )}
        </div>
      ) : null}
    </motion.div>
  );
}

export default function WarehouseAnalyticsPanel({
  summary = null,
  products = [],
  orders = [],
  alerts = [],
  purchaseOrders = [],
  inventoryValueReport = null,
  financeVendors = [],
  metrics = [],
  onSelectMetric,
  bridgePanel = null,
  canManageStock = false,
  onAdjustStock = null,
  onSaveProduct = null,
  onLoadProductMovementReview = null,
  canManageShipments = false,
  onUpdateShipmentStatus = null,
  onLoadShipmentReview = null,
  onSavePurchaseOrder = null,
  onSendPurchaseOrder = null,
  onReceivePurchaseOrder = null,
  onCancelPurchaseOrder = null,
  onOpenFinanceExpense = null,
  workspaceDefaultCurrency = "USD"
}) {
  const [stockAdjustmentDraft, setStockAdjustmentDraft] = useState({
    productId: "",
    quantityDelta: "",
    movementType: "received",
    note: ""
  });
  const [stockAdjustmentSubmitting, setStockAdjustmentSubmitting] = useState(false);
  const [selectedReviewProductId, setSelectedReviewProductId] = useState("");
  const [productMovementReview, setProductMovementReview] = useState(null);
  const [productMovementLoading, setProductMovementLoading] = useState(false);
  const [productMovementError, setProductMovementError] = useState("");
  const [shipmentStatusDrafts, setShipmentStatusDrafts] = useState({});
  const [shipmentStatusSavingId, setShipmentStatusSavingId] = useState("");
  const [selectedShipmentReviewId, setSelectedShipmentReviewId] = useState("");
  const [shipmentReview, setShipmentReview] = useState(null);
  const [shipmentReviewLoading, setShipmentReviewLoading] = useState(false);
  const [shipmentReviewError, setShipmentReviewError] = useState("");
  const [catalogDraft, setCatalogDraft] = useState({
    id: "",
    name: "",
    sku: "",
    unitCost: "",
    currency: workspaceDefaultCurrency || "USD",
    currentStock: "",
    reorderThreshold: "",
    reorderQuantity: ""
  });
  const [catalogSubmitting, setCatalogSubmitting] = useState(false);
  const [purchaseOrderDraft, setPurchaseOrderDraft] = useState({
    id: "",
    vendorId: "",
    vendorName: "",
    expectedDeliveryDate: "",
    notes: "",
    currency: workspaceDefaultCurrency || "USD",
    lineItems: [
      {
        id: uid("po-line"),
        itemId: "",
        itemName: "",
        sku: "",
        quantity: "",
        unitCost: "",
        currency: workspaceDefaultCurrency || "USD"
      }
    ]
  });
  const [purchaseOrderSubmitting, setPurchaseOrderSubmitting] = useState(false);
  const [selectedPurchaseOrderId, setSelectedPurchaseOrderId] = useState("");
  const [purchaseOrderActionId, setPurchaseOrderActionId] = useState("");
  const [receiveLineDrafts, setReceiveLineDrafts] = useState({});
  const lowStockAlerts = alerts.length
    ? alerts
    : (summary?.stockAlerts?.length
        ? summary.stockAlerts.map(mapWarehouseAlertRecord)
        : products
            .filter(isWarehouseLowStock)
            .map((product) => ({
              id: product.id,
              itemId: product.id,
              productId: product.id,
              itemName: product.name,
              name: product.name,
              sku: product.sku,
              currentStock: Number(product.currentStock || 0),
              reorderThreshold: getWarehouseReorderThreshold(product),
              reorderQuantity: Number(product.reorderQuantity || 0),
              unit: product.unit || "units",
              warehouseLocation: ""
            }))
      ).sort((left, right) => {
        const leftRatio = left.reorderThreshold > 0 ? left.currentStock / left.reorderThreshold : Number.MAX_SAFE_INTEGER;
        const rightRatio = right.reorderThreshold > 0 ? right.currentStock / right.reorderThreshold : Number.MAX_SAFE_INTEGER;
        if (leftRatio !== rightRatio) {
          return leftRatio - rightRatio;
        }
        return left.currentStock - right.currentStock;
      });
  const lowStockProducts = summary?.lowStockProducts?.length
    ? summary.lowStockProducts
    : products
        .filter(isWarehouseLowStock)
        .map((product) => ({
          id: product.id,
          name: product.name,
          sku: product.sku,
          itemType: product.itemType || "inventory",
          unit: product.unit || "units",
          currentStock: Number(product.currentStock || 0),
          minimumStock: Number(product.minimumStock || 0),
          reorderThreshold: getWarehouseReorderThreshold(product),
          reorderQuantity: Number(product.reorderQuantity || 0),
          stockGap: Number(product.stockGap || Math.max(0, getWarehouseReorderThreshold(product) - Number(product.currentStock || 0)))
        }))
        .sort((left, right) => right.stockGap - left.stockGap)
        .slice(0, 6);
  const recentShipmentActivity = summary?.recentShipmentActivity?.length
    ? summary.recentShipmentActivity
    : [...orders]
        .sort((left, right) => new Date(right.updatedAt || right.createdAt).getTime() - new Date(left.updatedAt || left.createdAt).getTime())
        .slice(0, 6);
  const mostActiveProducts = summary?.mostActiveProducts?.length
    ? summary.mostActiveProducts
    : [...products]
        .sort((left, right) => new Date(right.updatedAt || right.createdAt).getTime() - new Date(left.updatedAt || left.createdAt).getTime())
        .slice(0, 5);
  const recentStockMovements = Array.isArray(summary?.recentStockMovements) ? summary.recentStockMovements : [];
  const warehouseHandoffCues = Array.isArray(summary?.warehouseHandoffCues) ? summary.warehouseHandoffCues : [];
  const productStatusBreakdown = summary?.productStatusBreakdown || products.reduce((accumulator, product) => {
    const status = product.productStatus || "active";
    accumulator[status] = (accumulator[status] || 0) + 1;
    return accumulator;
  }, { active: 0, paused: 0, discontinued: 0 });
  const selectedAdjustmentProduct = products.find((product) => product.id === stockAdjustmentDraft.productId) || null;
  const canReviewProductMovement = Boolean(onLoadProductMovementReview);
  const canReviewShipment = Boolean(onLoadShipmentReview);
  const selectedReviewProduct =
    productMovementReview?.product ||
    products.find((product) => product.id === selectedReviewProductId) ||
    null;
  const selectedPurchaseOrder =
    purchaseOrders.find((order) => order.id === selectedPurchaseOrderId) ||
    purchaseOrders[0] ||
    null;

  useEffect(() => {
    if (!selectedPurchaseOrderId && purchaseOrders[0]?.id) {
      setSelectedPurchaseOrderId(purchaseOrders[0].id);
    } else if (selectedPurchaseOrderId && !purchaseOrders.some((order) => order.id === selectedPurchaseOrderId)) {
      setSelectedPurchaseOrderId(purchaseOrders[0]?.id || "");
    }
  }, [purchaseOrders, selectedPurchaseOrderId]);

  async function handleSubmitStockAdjustment(event) {
    event.preventDefault();
    if (!onAdjustStock || !selectedAdjustmentProduct) {
      return;
    }

    const quantityDelta = Number.parseFloat(stockAdjustmentDraft.quantityDelta);
    if (!Number.isFinite(quantityDelta) || quantityDelta === 0) {
      return;
    }

    setStockAdjustmentSubmitting(true);
    const ok = await onAdjustStock(selectedAdjustmentProduct, {
      quantityDelta,
      movementType: stockAdjustmentDraft.movementType,
      note: stockAdjustmentDraft.note
    });
    setStockAdjustmentSubmitting(false);

    if (ok) {
      setStockAdjustmentDraft((current) => ({
        ...current,
        quantityDelta: "",
        note: ""
      }));
    }
  }

  async function openProductMovementReview(productId) {
    if (!productId || !onLoadProductMovementReview) {
      return;
    }

    setSelectedReviewProductId(productId);
    setProductMovementLoading(true);
    setProductMovementError("");
    try {
      const payload = await onLoadProductMovementReview(productId);
      setProductMovementReview(payload || null);
    } catch (error) {
      setProductMovementReview(null);
      setProductMovementError(error?.message || "Unable to load product movement review.");
    } finally {
      setProductMovementLoading(false);
    }
  }

  async function handleShipmentStatusSave(order, nextStatus) {
    if (!onUpdateShipmentStatus || !order?.id || !nextStatus) {
      return;
    }

    setShipmentStatusSavingId(order.id);
    try {
      await onUpdateShipmentStatus(order, nextStatus);
    } finally {
      setShipmentStatusSavingId("");
    }
  }

  async function openShipmentReview(orderId) {
    if (!orderId || !onLoadShipmentReview) {
      return;
    }

    setSelectedShipmentReviewId(orderId);
    setShipmentReviewLoading(true);
    setShipmentReviewError("");
    try {
      const payload = await onLoadShipmentReview(orderId);
      setShipmentReview(payload || null);
    } catch (error) {
      setShipmentReview(null);
      setShipmentReviewError(error?.message || "Unable to load shipment review.");
    } finally {
      setShipmentReviewLoading(false);
    }
  }

  function hydrateCatalogDraft(product = null) {
    if (!product) {
      setCatalogDraft({
        id: "",
        name: "",
        sku: "",
        unitCost: "",
        currency: workspaceDefaultCurrency || "USD",
        currentStock: "",
        reorderThreshold: "",
        reorderQuantity: ""
      });
      return;
    }

    setCatalogDraft({
      id: product.id,
      name: product.name || "",
      sku: product.sku || "",
      unitCost: String(product.unitCost ?? ""),
      currency: product.currency || workspaceDefaultCurrency || "USD",
      currentStock: String(product.currentStock ?? ""),
      reorderThreshold: String(getWarehouseReorderThreshold(product) ?? ""),
      reorderQuantity: String(product.reorderQuantity ?? "")
    });
  }

  async function handleSaveCatalogItem(event) {
    event.preventDefault();
    if (!onSaveProduct) {
      return;
    }

    setCatalogSubmitting(true);
    const saved = await onSaveProduct(catalogDraft);
    setCatalogSubmitting(false);
    if (saved) {
      hydrateCatalogDraft(null);
    }
  }

  function buildPurchaseOrderLineDraft(lineItem = {}) {
    return {
      id: lineItem.id || uid("po-line"),
      itemId: lineItem.itemId || "",
      itemName: lineItem.itemName || "",
      sku: lineItem.sku || "",
      quantity: lineItem.quantity != null ? String(lineItem.quantity) : "",
      unitCost: lineItem.unitCost != null ? String(lineItem.unitCost) : "",
      currency: lineItem.currency || workspaceDefaultCurrency || "USD"
    };
  }

  function hydratePurchaseOrderDraft(order = null, prefilledLineItems = null) {
    if (!order) {
      setPurchaseOrderDraft({
        id: "",
        vendorId: "",
        vendorName: "",
        expectedDeliveryDate: "",
        notes: "",
        currency: workspaceDefaultCurrency || "USD",
        lineItems: prefilledLineItems?.length
          ? prefilledLineItems.map((lineItem) => buildPurchaseOrderLineDraft(lineItem))
          : [buildPurchaseOrderLineDraft()]
      });
      return;
    }

    setPurchaseOrderDraft({
      id: order.id,
      vendorId: order.vendorId || "",
      vendorName: order.vendorName || "",
      expectedDeliveryDate: order.expectedDeliveryDate ? String(order.expectedDeliveryDate).slice(0, 10) : "",
      notes: order.notes || "",
      currency: order.currency || workspaceDefaultCurrency || "USD",
      lineItems: (order.lineItems || []).length
        ? order.lineItems.map((lineItem) => buildPurchaseOrderLineDraft(lineItem))
        : [buildPurchaseOrderLineDraft()]
    });
  }

  function handlePrefillPurchaseOrderFromAlert(alert) {
    const product = products.find((entry) => entry.id === alert.productId || entry.id === alert.itemId);
    hydratePurchaseOrderDraft(null, [
      {
        itemId: product?.id || alert.productId || alert.itemId || "",
        itemName: product?.name || alert.itemName || alert.name || "",
        sku: product?.sku || alert.sku || "",
        quantity: alert.reorderQuantity || "",
        unitCost: product?.unitCost != null ? String(product.unitCost) : "",
        currency: product?.currency || alert.currency || workspaceDefaultCurrency || "USD"
      }
    ]);
  }

  function updatePurchaseOrderLine(lineId, updater) {
    setPurchaseOrderDraft((current) => ({
      ...current,
      lineItems: current.lineItems.map((lineItem) => (lineItem.id === lineId ? updater(lineItem) : lineItem))
    }));
  }

  async function handleSubmitPurchaseOrder(event) {
    event.preventDefault();
    if (!onSavePurchaseOrder) {
      return;
    }

    setPurchaseOrderSubmitting(true);
    const saved = await onSavePurchaseOrder(purchaseOrderDraft);
    setPurchaseOrderSubmitting(false);
    if (saved?.id) {
      setSelectedPurchaseOrderId(saved.id);
      hydratePurchaseOrderDraft(null);
    }
  }

  async function handlePurchaseOrderAction(action, order, payload = null) {
    if (!order?.id) {
      return;
    }

    const actionMap = {
      send: onSendPurchaseOrder,
      receive: onReceivePurchaseOrder,
      cancel: onCancelPurchaseOrder
    };
    const handler = actionMap[action];
    if (!handler) {
      return;
    }

    setPurchaseOrderActionId(`${action}:${order.id}`);
    const updated = await handler(order, payload);
    setPurchaseOrderActionId("");
    if (updated?.id) {
      setSelectedPurchaseOrderId(updated.id);
      setReceiveLineDrafts({});
    }
  }

  return (
    <div className="workspace-overview-shell flex-1 overflow-y-auto px-6 py-6">
      <div className="mb-4">
        <h3 className="text-xl font-bold text-slate-900">Warehouse analytics</h3>
        <p className="mt-1 text-sm text-slate-500">
          Track low stock, shipment movement, and the products that need warehouse attention first.
        </p>
      </div>
      {bridgePanel ? <div className="mb-6">{bridgePanel}</div> : null}
      <div className="grid gap-4 md:grid-cols-2">
        {metrics.map((metric) => (
          <StatCard key={metric.id} metric={metric} onSelect={onSelectMetric} />
        ))}
      </div>
      {warehouseHandoffCues.length ? (
        <div className="mt-6 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2D8EFF]">Operational handoff</div>
          <h3 className="mt-2 text-xl font-bold text-slate-900">Reorder and shipment cues</h3>
          <p className="mt-1 text-sm text-slate-500">
            Spot when stock pressure and shipment timing are starting to affect each other.
          </p>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {warehouseHandoffCues.map((cue) => (
              <button
                key={cue.id}
                type="button"
                onClick={() => cue.targetMetricId && onSelectMetric?.(metrics.find((metric) => metric.id === cue.targetMetricId) || { id: cue.targetMetricId, label: cue.title, value: "", subvalue: "" })}
                className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-left transition hover:border-[#2D8EFF]"
              >
                <div
                  className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${
                    cue.signal === "risk" ? "text-rose-600" : cue.signal === "attention" ? "text-amber-600" : "text-sky-600"
                  }`}
                >
                  {cue.signal === "risk" ? "Risk" : cue.signal === "attention" ? "Attention" : "Watch"}
                </div>
                <div className="mt-2 text-sm font-semibold text-slate-900">{cue.title}</div>
                <div className="mt-2 text-xs leading-5 text-slate-500">{cue.detail}</div>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2D8EFF]">Stock attention</div>
          <h3 className="mt-2 text-xl font-bold text-slate-900">Low stock and reorder queue</h3>
          <div className="mt-5 space-y-3">
            {lowStockProducts.length ? lowStockProducts.map((product) => (
              <div key={product.id} className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{product.name}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {product.sku} · {product.itemType || "inventory"} · {product.currentStock} {product.unit || "units"} on hand
                    </div>
                    {product.latestMovement ? (
                      <div className="mt-2 text-xs text-slate-500">
                        Last change {formatWarehouseQuantityDelta(product.latestMovement.quantityDelta, product.unit || "units")} · {formatDateTime(product.latestMovement.createdAt)}
                      </div>
                    ) : null}
                    <div className="mt-2 text-xs text-slate-500">
                      Threshold {product.reorderThreshold || product.minimumStock} · reorder {product.reorderQuantity || 0} {product.unit || "units"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-rose-600">Gap {product.stockGap}</div>
                    <div className="mt-1 text-xs text-slate-500">Reorder {product.reorderQuantity}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {canReviewProductMovement ? (
                    <button
                      type="button"
                      onClick={() => openProductMovementReview(product.id)}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-[#2D8EFF] hover:text-[#2D8EFF]"
                    >
                      Review movement
                    </button>
                  ) : null}
                  {canManageStock ? (
                    <button
                      type="button"
                      onClick={() => setStockAdjustmentDraft((current) => ({
                        ...current,
                        productId: product.id,
                        movementType: "received"
                      }))}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-[#2D8EFF] hover:text-[#2D8EFF]"
                    >
                      Add stock
                    </button>
                  ) : null}
                  {canManageStock && onSavePurchaseOrder ? (
                    <button
                      type="button"
                      onClick={() => handlePrefillPurchaseOrderFromAlert(product)}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-[#2D8EFF] hover:text-[#2D8EFF]"
                    >
                      Create PO
                    </button>
                  ) : null}
                </div>
              </div>
            )) : (
              <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                No low stock products need action right now.
              </div>
            )}
          </div>
        </div>
        <div className="grid gap-6">
          <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2D8EFF]">Catalog setup</div>
            <h3 className="mt-2 text-xl font-bold text-slate-900">Item thresholds</h3>
            <p className="mt-1 text-sm text-slate-500">
              Set reorder thresholds and preferred reorder quantities without leaving Warehouse.
            </p>
            {canManageStock && onSaveProduct ? (
              <form className="mt-5 space-y-3" onSubmit={handleSaveCatalogItem}>
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Edit existing item</span>
                  <select
                    value={catalogDraft.id}
                    onChange={(event) => hydrateCatalogDraft(products.find((product) => product.id === event.target.value) || null)}
                    className="mt-2 w-full rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 outline-none focus:border-[#2D8EFF]"
                  >
                    <option value="">Create new catalog item</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name} ({product.sku})
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Item name</span>
                    <input
                      type="text"
                      value={catalogDraft.name}
                      onChange={(event) => setCatalogDraft((current) => ({ ...current, name: event.target.value }))}
                      className="mt-2 w-full rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 outline-none focus:border-[#2D8EFF]"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">SKU</span>
                    <input
                      type="text"
                      value={catalogDraft.sku}
                      onChange={(event) => setCatalogDraft((current) => ({ ...current, sku: event.target.value.toUpperCase() }))}
                      className="mt-2 w-full rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 outline-none focus:border-[#2D8EFF]"
                    />
                  </label>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Unit cost</span>
                    <input
                      type="number"
                      step="0.01"
                      value={catalogDraft.unitCost}
                      onChange={(event) => setCatalogDraft((current) => ({ ...current, unitCost: event.target.value }))}
                      className="mt-2 w-full rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 outline-none focus:border-[#2D8EFF]"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Currency</span>
                    <select
                      value={catalogDraft.currency}
                      onChange={(event) => setCatalogDraft((current) => ({ ...current, currency: event.target.value }))}
                      className="mt-2 w-full rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 outline-none focus:border-[#2D8EFF]"
                    >
                      {FINANCE_CURRENCY_OPTIONS.map((currencyCode) => (
                        <option key={currencyCode} value={currencyCode}>{currencyCode}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Current stock</span>
                    <input
                      type="number"
                      step="0.01"
                      value={catalogDraft.currentStock}
                      onChange={(event) => setCatalogDraft((current) => ({ ...current, currentStock: event.target.value }))}
                      className="mt-2 w-full rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 outline-none focus:border-[#2D8EFF]"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Reorder threshold</span>
                    <input
                      type="number"
                      step="0.01"
                      value={catalogDraft.reorderThreshold}
                      onChange={(event) => setCatalogDraft((current) => ({ ...current, reorderThreshold: event.target.value }))}
                      className="mt-2 w-full rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 outline-none focus:border-[#2D8EFF]"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Reorder quantity</span>
                    <input
                      type="number"
                      step="0.01"
                      value={catalogDraft.reorderQuantity}
                      onChange={(event) => setCatalogDraft((current) => ({ ...current, reorderQuantity: event.target.value }))}
                      className="mt-2 w-full rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 outline-none focus:border-[#2D8EFF]"
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    disabled={catalogSubmitting}
                    className="rounded-full bg-[#2D8EFF] px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {catalogSubmitting ? "Saving..." : catalogDraft.id ? "Update item" : "Create item"}
                  </button>
                  {catalogDraft.id ? (
                    <button
                      type="button"
                      onClick={() => hydrateCatalogDraft(null)}
                      className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                    >
                      New item
                    </button>
                  ) : null}
                </div>
              </form>
            ) : (
              <div className="mt-5 rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                Warehouse managers can configure item thresholds here.
              </div>
            )}
          </div>
          <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2D8EFF]">Product status</div>
            <h3 className="mt-2 text-xl font-bold text-slate-900">Catalog health</h3>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {[
                ["Active", productStatusBreakdown.active || 0],
                ["Paused", productStatusBreakdown.paused || 0],
                ["Discontinued", productStatusBreakdown.discontinued || 0]
              ].map(([label, value]) => (
                <div key={label} className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
                  <div className="mt-3 text-2xl font-bold text-slate-900">{value}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2D8EFF]">Shipment movement</div>
            <h3 className="mt-2 text-xl font-bold text-slate-900">Recent shipment activity</h3>
            <div className="mt-5 space-y-3">
              {recentShipmentActivity.length ? recentShipmentActivity.map((order) => (
                <div key={order.id} className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{order.orderNumber}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {warehouseShipmentTypeLabel(order.shipmentType)} · {order.itemsCount || 1} item{Number(order.itemsCount || 1) === 1 ? "" : "s"}
                      </div>
                      <div className="mt-2 text-xs text-slate-500">{order.destination}</div>
                      {order.lastStatusUpdate ? (
                        <div className="mt-2 text-xs text-slate-500">
                          Last update {formatDateTime(order.lastStatusUpdate.changedAt)}
                          {order.lastStatusUpdate.actor?.name ? ` · ${order.lastStatusUpdate.actor.name}` : ""}
                        </div>
                      ) : null}
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-[#2D8EFF]">{warehouseStatusLabel(order.status)}</div>
                      <div className="mt-1 text-xs text-slate-500">{formatDate(order.estimatedDelivery)}</div>
                    </div>
                  </div>
                  {canManageShipments ? (
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      <select
                        value={shipmentStatusDrafts[order.id] || order.status}
                        onChange={(event) => setShipmentStatusDrafts((current) => ({ ...current, [order.id]: event.target.value }))}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
                      >
                        {WAREHOUSE_SHIPMENT_STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => handleShipmentStatusSave(order, shipmentStatusDrafts[order.id] || order.status)}
                        disabled={shipmentStatusSavingId === order.id || (shipmentStatusDrafts[order.id] || order.status) === order.status}
                        className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {shipmentStatusSavingId === order.id ? "Saving..." : "Update"}
                      </button>
                    </div>
                  ) : null}
                  {canReviewShipment ? (
                    <button
                      type="button"
                      onClick={() => openShipmentReview(order.id)}
                      className="mt-3 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-[#2D8EFF] hover:text-[#2D8EFF]"
                    >
                      Review shipment
                    </button>
                  ) : null}
                </div>
              )) : (
                <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                  No shipment activity is available yet.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2D8EFF]">Stock alerts</div>
          <h3 className="mt-2 text-xl font-bold text-slate-900">Low stock alerts</h3>
          <p className="mt-1 text-sm text-slate-500">
            Threshold-driven alerts sorted by the most critical stock gaps first.
          </p>
          <div className="mt-5 space-y-3">
            {lowStockAlerts.length ? lowStockAlerts.map((alert) => (
              <div key={alert.id} className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{alert.itemName}</div>
                    <div className="mt-1 text-xs text-slate-500">{alert.sku} · {alert.currentStock} {alert.unit}</div>
                    <div className="mt-2 text-xs text-slate-500">
                      Threshold {alert.reorderThreshold} · reorder {alert.reorderQuantity || 0}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-rose-600">
                      Gap {Math.max(0, Number(alert.reorderThreshold || 0) - Number(alert.currentStock || 0))}
                    </div>
                  </div>
                </div>
                {canManageStock && onSavePurchaseOrder ? (
                  <button
                    type="button"
                    onClick={() => handlePrefillPurchaseOrderFromAlert(alert)}
                    className="mt-3 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-[#2D8EFF] hover:text-[#2D8EFF]"
                  >
                    Create PO
                  </button>
                ) : null}
              </div>
            )) : (
              <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                No threshold alerts are active right now.
              </div>
            )}
          </div>
        </div>
        <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2D8EFF]">Purchase orders</div>
              <h3 className="mt-2 text-xl font-bold text-slate-900">Warehouse purchasing</h3>
              <p className="mt-1 text-sm text-slate-500">
                Turn stock pressure into vendor orders and receive them back into inventory.
              </p>
            </div>
            <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
              {purchaseOrders.length} order{purchaseOrders.length === 1 ? "" : "s"}
            </div>
          </div>
          <div className="mt-5 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
            <form className="space-y-3" onSubmit={handleSubmitPurchaseOrder}>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Edit draft</span>
                <select
                  value={purchaseOrderDraft.id}
                  onChange={(event) => hydratePurchaseOrderDraft(purchaseOrders.find((order) => order.id === event.target.value) || null)}
                  className="mt-2 w-full rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 outline-none focus:border-[#2D8EFF]"
                >
                  <option value="">Create new purchase order</option>
                  {purchaseOrders.filter((order) => order.status === "draft").map((order) => (
                    <option key={order.id} value={order.id}>
                      {order.orderNumber} · {order.vendorName || "Vendor"}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Vendor</span>
                  <select
                    value={purchaseOrderDraft.vendorId}
                    onChange={(event) => {
                      const vendor = financeVendors.find((entry) => entry.id === event.target.value) || null;
                      setPurchaseOrderDraft((current) => ({
                        ...current,
                        vendorId: event.target.value,
                        vendorName: vendor?.name || current.vendorName
                      }));
                    }}
                    className="mt-2 w-full rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 outline-none focus:border-[#2D8EFF]"
                  >
                    <option value="">Select vendor</option>
                    {financeVendors.map((vendor) => (
                      <option key={vendor.id} value={vendor.id}>
                        {vendor.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Vendor name</span>
                  <input
                    type="text"
                    value={purchaseOrderDraft.vendorName}
                    onChange={(event) => setPurchaseOrderDraft((current) => ({ ...current, vendorName: event.target.value }))}
                    className="mt-2 w-full rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 outline-none focus:border-[#2D8EFF]"
                    placeholder="Vendor name"
                  />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Expected delivery</span>
                  <input
                    type="date"
                    value={purchaseOrderDraft.expectedDeliveryDate}
                    onChange={(event) => setPurchaseOrderDraft((current) => ({ ...current, expectedDeliveryDate: event.target.value }))}
                    className="mt-2 w-full rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 outline-none focus:border-[#2D8EFF]"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Currency</span>
                  <select
                    value={purchaseOrderDraft.currency}
                    onChange={(event) => setPurchaseOrderDraft((current) => ({
                      ...current,
                      currency: event.target.value,
                      lineItems: current.lineItems.map((lineItem) => ({ ...lineItem, currency: event.target.value }))
                    }))}
                    className="mt-2 w-full rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 outline-none focus:border-[#2D8EFF]"
                  >
                    {FINANCE_CURRENCY_OPTIONS.map((currency) => (
                      <option key={currency} value={currency}>{currency}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Notes</span>
                <textarea
                  rows={3}
                  value={purchaseOrderDraft.notes}
                  onChange={(event) => setPurchaseOrderDraft((current) => ({ ...current, notes: event.target.value }))}
                  className="mt-2 w-full rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 outline-none focus:border-[#2D8EFF]"
                />
              </label>
              <div className="space-y-3">
                {purchaseOrderDraft.lineItems.map((lineItem, index) => (
                  <div key={lineItem.id} className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Line item {index + 1}</div>
                      {purchaseOrderDraft.lineItems.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => setPurchaseOrderDraft((current) => ({
                            ...current,
                            lineItems: current.lineItems.filter((entry) => entry.id !== lineItem.id)
                          }))}
                          className="text-xs font-semibold text-rose-600"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Warehouse item</span>
                        <select
                          value={lineItem.itemId}
                          onChange={(event) => {
                            const product = products.find((entry) => entry.id === event.target.value) || null;
                            updatePurchaseOrderLine(lineItem.id, (current) => ({
                              ...current,
                              itemId: event.target.value,
                              itemName: product?.name || current.itemName,
                              sku: product?.sku || current.sku
                            }));
                          }}
                          className="mt-2 w-full rounded-[14px] border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none focus:border-[#2D8EFF]"
                        >
                          <option value="">Select item</option>
                          {products.map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.name} ({product.sku})
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Item name</span>
                        <input
                          type="text"
                          value={lineItem.itemName}
                          onChange={(event) => updatePurchaseOrderLine(lineItem.id, (current) => ({ ...current, itemName: event.target.value }))}
                          className="mt-2 w-full rounded-[14px] border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none focus:border-[#2D8EFF]"
                        />
                      </label>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <label className="block">
                        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">SKU</span>
                        <input
                          type="text"
                          value={lineItem.sku}
                          onChange={(event) => updatePurchaseOrderLine(lineItem.id, (current) => ({ ...current, sku: event.target.value.toUpperCase() }))}
                          className="mt-2 w-full rounded-[14px] border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none focus:border-[#2D8EFF]"
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Quantity</span>
                        <input
                          type="number"
                          step="0.01"
                          value={lineItem.quantity}
                          onChange={(event) => updatePurchaseOrderLine(lineItem.id, (current) => ({ ...current, quantity: event.target.value }))}
                          className="mt-2 w-full rounded-[14px] border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none focus:border-[#2D8EFF]"
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Unit cost</span>
                        <input
                          type="number"
                          step="0.01"
                          value={lineItem.unitCost}
                          onChange={(event) => updatePurchaseOrderLine(lineItem.id, (current) => ({ ...current, unitCost: event.target.value }))}
                          className="mt-2 w-full rounded-[14px] border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none focus:border-[#2D8EFF]"
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setPurchaseOrderDraft((current) => ({
                    ...current,
                    lineItems: [...current.lineItems, buildPurchaseOrderLineDraft({ currency: current.currency || workspaceDefaultCurrency || "USD" })]
                  }))}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                >
                  Add line item
                </button>
                <button
                  type="submit"
                  disabled={purchaseOrderSubmitting}
                  className="rounded-full bg-[#2D8EFF] px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {purchaseOrderSubmitting ? "Saving..." : purchaseOrderDraft.id ? "Update PO" : "Create PO"}
                </button>
                {purchaseOrderDraft.id ? (
                  <button
                    type="button"
                    onClick={() => hydratePurchaseOrderDraft(null)}
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                  >
                    New PO
                  </button>
                ) : null}
              </div>
            </form>
            <div className="space-y-4">
              <div className="space-y-3">
                {purchaseOrders.length ? purchaseOrders.map((order) => (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => setSelectedPurchaseOrderId(order.id)}
                    className={`w-full rounded-[18px] border px-4 py-4 text-left transition ${
                      selectedPurchaseOrder?.id === order.id ? "border-[#2D8EFF] bg-blue-50" : "border-slate-200 bg-slate-50 hover:border-[#2D8EFF]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{order.orderNumber}</div>
                        <div className="mt-1 text-xs text-slate-500">{order.vendorName || "Vendor not set"}</div>
                        <div className="mt-2 text-xs text-slate-500">
                          {order.lineItems.length} line{order.lineItems.length === 1 ? "" : "s"} · {order.mixedCurrency ? formatMoneyDisplay(order.totalsByCurrency || {}) : formatMoney(order.totalAmount, order.currency)}
                        </div>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${
                        order.status === "received"
                          ? "bg-emerald-100 text-emerald-700"
                          : order.status === "partially_received"
                            ? "bg-amber-100 text-amber-700"
                            : order.status === "cancelled"
                              ? "bg-slate-200 text-slate-600"
                              : "bg-sky-100 text-sky-700"
                      }`}>
                        {formatPurchaseOrderStatusLabel(order.status)}
                      </span>
                    </div>
                  </button>
                )) : (
                  <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                    No purchase orders yet.
                  </div>
                )}
              </div>
              {selectedPurchaseOrder ? (
                <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{selectedPurchaseOrder.orderNumber}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {selectedPurchaseOrder.vendorName || "Vendor not set"} · {selectedPurchaseOrder.mixedCurrency ? formatMoneyDisplay(selectedPurchaseOrder.totalsByCurrency || {}) : formatMoney(selectedPurchaseOrder.totalAmount, selectedPurchaseOrder.currency)}
                      </div>
                      {selectedPurchaseOrder.mixedCurrency ? (
                        <div className="mt-2 text-xs text-slate-500">
                          Approx. order total in {selectedPurchaseOrder.currency}: {formatMoney(selectedPurchaseOrder.totalAmount, selectedPurchaseOrder.currency)}
                        </div>
                      ) : null}
                      {selectedPurchaseOrder.expectedDeliveryDate ? (
                        <div className="mt-2 text-xs text-slate-500">
                          Expected {formatDate(selectedPurchaseOrder.expectedDeliveryDate)}
                        </div>
                      ) : null}
                    </div>
                    <div className="text-right text-xs text-slate-500">
                      {selectedPurchaseOrder.financeExpense ? (
                        <button
                          type="button"
                          onClick={() => onOpenFinanceExpense?.(selectedPurchaseOrder.financeExpense)}
                          className="rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-700"
                        >
                          Expense created: {formatMoney(selectedPurchaseOrder.financeExpense.amount, selectedPurchaseOrder.financeExpense.currency)} · {selectedPurchaseOrder.financeExpense.status}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {selectedPurchaseOrder.notes ? <div className="mt-3 text-sm text-slate-600">{selectedPurchaseOrder.notes}</div> : null}
                  <div className="mt-4 space-y-3">
                    {selectedPurchaseOrder.lineItems.map((lineItem) => {
                      const remaining = Math.max(0, Number(lineItem.quantity || 0) - Number(lineItem.receivedQuantity || 0));
                      return (
                        <div key={lineItem.id} className="rounded-[14px] border border-slate-200 bg-white px-3 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-slate-900">{lineItem.itemName}</div>
                              <div className="mt-1 text-xs text-slate-500">{lineItem.sku} · {lineItem.quantity} units @ {formatMoney(lineItem.unitCost, lineItem.currency)}</div>
                              {Number(lineItem.taxAmount || 0) > 0 ? (
                                <div className="mt-1 text-xs text-slate-500">
                                  Tax {formatMoney(lineItem.taxAmount || 0, lineItem.currency)} · line total {formatMoney(lineItem.lineTotalWithTax || lineItem.lineTotal || 0, lineItem.currency)}
                                </div>
                              ) : null}
                              <div className="mt-2 text-xs text-slate-500">
                                Received {lineItem.receivedQuantity} / {lineItem.quantity}
                              </div>
                            </div>
                            {["sent", "acknowledged", "partially_received"].includes(selectedPurchaseOrder.status) && remaining > 0 ? (
                              <label className="block text-right">
                                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Receive</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  max={remaining}
                                  value={receiveLineDrafts[lineItem.id] ?? ""}
                                  onChange={(event) => setReceiveLineDrafts((current) => ({ ...current, [lineItem.id]: event.target.value }))}
                                  className="mt-2 w-24 rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#2D8EFF]"
                                />
                              </label>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {selectedPurchaseOrder.status === "draft" ? (
                      <>
                        <button
                          type="button"
                          onClick={() => hydratePurchaseOrderDraft(selectedPurchaseOrder)}
                          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                        >
                          Edit draft
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePurchaseOrderAction("send", selectedPurchaseOrder)}
                          disabled={purchaseOrderActionId === `send:${selectedPurchaseOrder.id}`}
                          className="rounded-full bg-[#2D8EFF] px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {purchaseOrderActionId === `send:${selectedPurchaseOrder.id}` ? "Sending..." : "Send"}
                        </button>
                      </>
                    ) : null}
                    {["draft", "sent"].includes(selectedPurchaseOrder.status) ? (
                      <button
                        type="button"
                        onClick={() => handlePurchaseOrderAction("cancel", selectedPurchaseOrder)}
                        disabled={purchaseOrderActionId === `cancel:${selectedPurchaseOrder.id}`}
                        className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {purchaseOrderActionId === `cancel:${selectedPurchaseOrder.id}` ? "Cancelling..." : "Cancel"}
                      </button>
                    ) : null}
                    {["sent", "acknowledged", "partially_received"].includes(selectedPurchaseOrder.status) ? (
                      <button
                        type="button"
                        onClick={() => handlePurchaseOrderAction(
                          "receive",
                          selectedPurchaseOrder,
                          selectedPurchaseOrder.lineItems.map((lineItem) => ({
                            lineItemId: lineItem.id,
                            receivedQuantity: receiveLineDrafts[lineItem.id] || 0
                          }))
                        )}
                        disabled={purchaseOrderActionId === `receive:${selectedPurchaseOrder.id}`}
                        className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {purchaseOrderActionId === `receive:${selectedPurchaseOrder.id}` ? "Receiving..." : "Receive items"}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2D8EFF]">Inventory value</div>
          <h3 className="mt-2 text-xl font-bold text-slate-900">Inventory value by category</h3>
          <p className="mt-1 text-sm text-slate-500">
            Track working capital in stock, grouped by category and highlighted where low stock is already affecting inventory value.
          </p>
          <div className="mt-5 rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Total inventory value</div>
            <div className="mt-2 text-lg font-semibold text-slate-900">
              {formatMoneyDisplay(inventoryValueReport?.totals || {})}
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {(inventoryValueReport?.categories || []).length ? (
              inventoryValueReport.categories.map((categoryEntry) => (
                <div key={categoryEntry.category} className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-900">{categoryEntry.category}</div>
                    <div className="text-sm font-semibold text-slate-700">{formatMoneyDisplay(categoryEntry.totals || {})}</div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                No inventory value data yet.
              </div>
            )}
          </div>
        </div>
        <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2D8EFF]">Stock movement</div>
          <h3 className="mt-2 text-xl font-bold text-slate-900">Recent stock changes</h3>
          <p className="mt-1 text-sm text-slate-500">
            See what changed, by how much, and why inventory moved across the workspace.
          </p>
          <div className="mt-5 space-y-3">
            {recentStockMovements.length ? recentStockMovements.map((movement) => {
              const positiveChange = Number(movement.quantityDelta || 0) > 0;
              return (
                <div key={movement.id} className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{movement.productName}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {movement.sku} · {movement.movementLabel || warehouseMovementTypeLabel(movement.movementType)}
                      </div>
                      <div className="mt-2 text-xs text-slate-500">
                        {movement.actor?.name || "Warehouse teammate"} · {formatDateTime(movement.createdAt)}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {formatWarehouseQuantity(movement.previousStock)} {movement.unit} → {formatWarehouseQuantity(movement.resultingStock)} {movement.unit}
                      </div>
                      {movement.note ? <div className="mt-2 text-xs text-slate-500">{movement.note}</div> : null}
                    </div>
                    <div className="text-right">
                      <div className={`text-sm font-semibold ${positiveChange ? "text-emerald-600" : "text-rose-600"}`}>
                        {formatWarehouseQuantityDelta(movement.quantityDelta, movement.unit)}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {movement.sourceType === "product_create"
                          ? "Product added"
                          : movement.sourceType === "product_update"
                            ? "Catalog update"
                            : "Manual update"}
                      </div>
                    </div>
                  </div>
                </div>
              );
            }) : (
              <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                No stock movement is recorded yet.
              </div>
            )}
          </div>
        </div>
        <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2D8EFF]">Stock actions</div>
          <h3 className="mt-2 text-xl font-bold text-slate-900">Adjust inventory</h3>
          <p className="mt-1 text-sm text-slate-500">
            Record received stock, manual adjustments, or stock reductions without leaving the Warehouse view.
          </p>
          {canManageStock && products.length ? (
            <form className="mt-5 space-y-3" onSubmit={handleSubmitStockAdjustment}>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Product</span>
                <select
                  value={stockAdjustmentDraft.productId}
                  onChange={(event) => setStockAdjustmentDraft((current) => ({ ...current, productId: event.target.value }))}
                  className="mt-2 w-full rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 outline-none focus:border-[#2D8EFF]"
                >
                  <option value="">Select a product</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} ({product.sku})
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Change type</span>
                  <select
                    value={stockAdjustmentDraft.movementType}
                    onChange={(event) => setStockAdjustmentDraft((current) => ({ ...current, movementType: event.target.value }))}
                    className="mt-2 w-full rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 outline-none focus:border-[#2D8EFF]"
                  >
                    <option value="received">Received stock</option>
                    <option value="adjustment">Adjustment</option>
                    <option value="fulfilled">Reduce stock</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Quantity delta</span>
                  <input
                    type="number"
                    step="0.01"
                    value={stockAdjustmentDraft.quantityDelta}
                    onChange={(event) => setStockAdjustmentDraft((current) => ({ ...current, quantityDelta: event.target.value }))}
                    className="mt-2 w-full rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 outline-none focus:border-[#2D8EFF]"
                    placeholder={stockAdjustmentDraft.movementType === "fulfilled" ? "-12" : "24"}
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Note</span>
                <textarea
                  rows={3}
                  value={stockAdjustmentDraft.note}
                  onChange={(event) => setStockAdjustmentDraft((current) => ({ ...current, note: event.target.value }))}
                  className="mt-2 w-full rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 outline-none focus:border-[#2D8EFF]"
                  placeholder="Optional context, like damaged units, partial fulfillment, or received delivery."
                />
              </label>
              <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
                Use positive numbers to add stock and negative numbers to reduce it. Fulfillment-style updates should usually be negative.
                {selectedAdjustmentProduct ? (
                  <div className="mt-2 text-slate-700">
                    Current on hand: <span className="font-semibold">{formatWarehouseQuantity(selectedAdjustmentProduct.currentStock)} {selectedAdjustmentProduct.unit || "units"}</span>
                  </div>
                ) : null}
              </div>
              <button
                type="submit"
                disabled={stockAdjustmentSubmitting || !stockAdjustmentDraft.productId || !stockAdjustmentDraft.quantityDelta}
                className="rounded-full bg-[#2D8EFF] px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
              >
                {stockAdjustmentSubmitting ? "Saving stock change..." : "Record stock change"}
              </button>
            </form>
          ) : (
            <div className="mt-5 rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              Add products to the warehouse catalog before recording stock changes.
            </div>
          )}
          <div className="mt-6 rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Reorder review</div>
            <h4 className="mt-2 text-base font-semibold text-slate-900">
              {selectedReviewProduct ? selectedReviewProduct.name : "Pick a product to review"}
            </h4>
            {productMovementLoading ? (
              <p className="mt-3 text-sm text-slate-500">Loading recent stock history...</p>
            ) : productMovementError ? (
              <p className="mt-3 text-sm text-rose-600">{productMovementError}</p>
            ) : productMovementReview ? (
              <div className="mt-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-[14px] border border-slate-200 bg-white px-3 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">On hand</div>
                    <div className="mt-2 text-lg font-bold text-slate-900">
                      {formatWarehouseQuantity(productMovementReview.product.currentStock)} {productMovementReview.product.unit || "units"}
                    </div>
                  </div>
                  <div className="rounded-[14px] border border-slate-200 bg-white px-3 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Stock gap</div>
                    <div className="mt-2 text-lg font-bold text-slate-900">
                      {formatWarehouseQuantity(productMovementReview.reorderReview?.stockGap || 0)}
                    </div>
                  </div>
                  <div className="rounded-[14px] border border-slate-200 bg-white px-3 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Movement mix</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">
                      {productMovementReview.reorderReview?.receivedCount || 0} in · {productMovementReview.reorderReview?.reducedCount || 0} out
                    </div>
                  </div>
                </div>
                {productMovementReview.reorderReview?.latestMovement ? (
                  <div className="mt-4 rounded-[14px] border border-slate-200 bg-white px-3 py-3 text-sm text-slate-600">
                    Latest change: {formatWarehouseQuantityDelta(
                      productMovementReview.reorderReview.latestMovement.quantityDelta,
                      productMovementReview.product.unit || "units"
                    )} on {formatDateTime(productMovementReview.reorderReview.latestMovement.createdAt)}
                  </div>
                ) : null}
                <div className="mt-4 space-y-3">
                  {productMovementReview.movements.length ? productMovementReview.movements.map((movement) => {
                    const positiveChange = Number(movement.quantityDelta || 0) > 0;
                    return (
                      <div key={movement.id} className="rounded-[14px] border border-slate-200 bg-white px-3 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-slate-900">{movement.movementLabel || warehouseMovementTypeLabel(movement.movementType)}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              {movement.actor?.name || "Warehouse teammate"} · {formatDateTime(movement.createdAt)}
                            </div>
                            <div className="mt-2 text-xs text-slate-500">
                              {formatWarehouseQuantity(movement.previousStock)} {movement.unit} → {formatWarehouseQuantity(movement.resultingStock)} {movement.unit}
                            </div>
                            {movement.note ? <div className="mt-2 text-xs text-slate-500">{movement.note}</div> : null}
                          </div>
                          <div className={`text-sm font-semibold ${positiveChange ? "text-emerald-600" : "text-rose-600"}`}>
                            {formatWarehouseQuantityDelta(movement.quantityDelta, movement.unit)}
                          </div>
                        </div>
                      </div>
                    );
                  }) : (
                    <div className="rounded-[14px] border border-slate-200 bg-white px-3 py-3 text-sm text-slate-500">
                      No stock movement has been recorded for this product yet.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-500">
                Use the low-stock or product cards to inspect the recent movement that led to the current reorder signal.
              </p>
            )}
          </div>
          <div className="mt-6 rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Shipment review</div>
            <h4 className="mt-2 text-base font-semibold text-slate-900">
              {shipmentReview?.order?.orderNumber || "Pick a shipment to review"}
            </h4>
            {shipmentReviewLoading ? (
              <p className="mt-3 text-sm text-slate-500">Loading shipment history...</p>
            ) : shipmentReviewError ? (
              <p className="mt-3 text-sm text-rose-600">{shipmentReviewError}</p>
            ) : shipmentReview ? (
              <div className="mt-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-[14px] border border-slate-200 bg-white px-3 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Status</div>
                    <div className="mt-2 text-base font-bold text-slate-900">{warehouseStatusLabel(shipmentReview.review?.currentStatus || shipmentReview.order?.status)}</div>
                  </div>
                  <div className="rounded-[14px] border border-slate-200 bg-white px-3 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Destination</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">{shipmentReview.order?.destination}</div>
                  </div>
                  <div className="rounded-[14px] border border-slate-200 bg-white px-3 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Review</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">
                      {shipmentReview.review?.totalStatusChanges || 0} changes · {shipmentReview.review?.delayedEvents || 0} delay{shipmentReview.review?.delayedEvents === 1 ? "" : "s"}
                    </div>
                  </div>
                </div>
                <div className="mt-4 rounded-[14px] border border-slate-200 bg-white px-3 py-3 text-sm text-slate-600">
                  {warehouseShipmentTypeLabel(shipmentReview.order?.shipmentType)} shipment · ETA {formatDate(shipmentReview.order?.estimatedDelivery)} ·
                  Last progress {shipmentReview.review?.lastProgressAt ? ` ${formatDateTime(shipmentReview.review.lastProgressAt)}` : " not recorded"}
                </div>
                <div className="mt-4 space-y-3">
                  {(shipmentReview.recentHistory || []).length ? shipmentReview.recentHistory.map((entry, index) => (
                    <div key={`${entry.changedAt || index}-${entry.status}`} className="rounded-[14px] border border-slate-200 bg-white px-3 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">{warehouseStatusLabel(entry.status)}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {entry.actor?.name || "Warehouse teammate"} · {formatDateTime(entry.changedAt)}
                          </div>
                          {entry.note ? <div className="mt-2 text-xs text-slate-500">{entry.note}</div> : null}
                        </div>
                        <div className="text-xs text-slate-500">
                          Step {Math.min(Number(entry.currentStep || 0) + 1, SHIPMENT_STEPS.length)} / {SHIPMENT_STEPS.length}
                        </div>
                      </div>
                    </div>
                  )) : (
                    <div className="rounded-[14px] border border-slate-200 bg-white px-3 py-3 text-sm text-slate-500">
                      No shipment history is recorded yet.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-500">
                Use the shipment activity cards to inspect one shipment’s recent path and timing.
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="mt-6 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2D8EFF]">Most active products</div>
        <h3 className="mt-2 text-xl font-bold text-slate-900">Recently updated catalog items</h3>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {mostActiveProducts.length ? mostActiveProducts.map((product) => (
            <div key={product.id} className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="text-sm font-semibold text-slate-900">{product.name}</div>
              <div className="mt-1 text-xs text-slate-500">{product.sku} · {product.itemType || "inventory"}</div>
              <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-500">
                <span>{product.currentStock} {product.unit || "units"}</span>
                <span>{warehouseStockSignalLabel(product.stockSignal || (isWarehouseLowStock(product) ? "low_stock" : "healthy"))}</span>
              </div>
              {canManageStock ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {canReviewProductMovement ? (
                    <button
                      type="button"
                      onClick={() => openProductMovementReview(product.id)}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-[#2D8EFF] hover:text-[#2D8EFF]"
                    >
                      Review movement
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setStockAdjustmentDraft((current) => ({
                      ...current,
                      productId: product.id,
                      movementType: Number(product.currentStock || 0) <= Number(product.minimumStock || 0) ? "received" : current.movementType
                    }))}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-[#2D8EFF] hover:text-[#2D8EFF]"
                  >
                    Adjust stock
                  </button>
                </div>
              ) : (
                canReviewProductMovement ? (
                  <button
                    type="button"
                    onClick={() => openProductMovementReview(product.id)}
                    className="mt-3 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-[#2D8EFF] hover:text-[#2D8EFF]"
                  >
                    Review movement
                  </button>
                ) : null
              )}
            </div>
          )) : (
            <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              No product activity yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
