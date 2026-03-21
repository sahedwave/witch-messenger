import mongoose from "mongoose";

const warehouseProductSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 140
    },
    sku: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 60
    },
    itemType: {
      type: String,
      trim: true,
      default: "inventory",
      maxlength: 40
    },
    unit: {
      type: String,
      trim: true,
      default: "units",
      maxlength: 40
    },
    unitCost: {
      type: Number,
      default: 0,
      min: 0
    },
    currency: {
      type: String,
      default: "USD",
      uppercase: true,
      trim: true,
      maxlength: 8
    },
    currentStock: {
      type: Number,
      required: true,
      min: 0
    },
    minimumStock: {
      type: Number,
      required: true,
      min: 0
    },
    reorderThreshold: {
      type: Number,
      default: 0,
      min: 0
    },
    reorderQuantity: {
      type: Number,
      default: 0,
      min: 0
    },
    alertStatus: {
      type: String,
      enum: ["active", "resolved", "dismissed"],
      default: "active"
    },
    productStatus: {
      type: String,
      enum: ["active", "paused", "discontinued"],
      default: "active"
    },
    lastReorderQuantity: {
      type: Number,
      default: null
    },
    threadKey: {
      type: String,
      default: "warebot",
      trim: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    }
  },
  {
    timestamps: true
  }
);

warehouseProductSchema.index({ workspaceId: 1, sku: 1 }, { unique: true });
warehouseProductSchema.index({ workspaceId: 1, alertStatus: 1, updatedAt: -1 });
warehouseProductSchema.index({ workspaceId: 1, currentStock: 1, minimumStock: 1 });
warehouseProductSchema.index({ workspaceId: 1, currentStock: 1, reorderThreshold: 1 });

export const WarehouseProduct = mongoose.model("WarehouseProduct", warehouseProductSchema);
