import mongoose from "mongoose";

const warehouseStockMovementSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WarehouseProduct",
      required: true,
      index: true
    },
    productName: {
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
    unit: {
      type: String,
      trim: true,
      default: "units",
      maxlength: 40
    },
    movementType: {
      type: String,
      enum: ["initial", "received", "adjustment", "fulfilled"],
      required: true
    },
    quantityDelta: {
      type: Number,
      required: true
    },
    previousStock: {
      type: Number,
      required: true,
      min: 0
    },
    resultingStock: {
      type: Number,
      required: true,
      min: 0
    },
    sourceType: {
      type: String,
      enum: ["product_create", "product_update", "stock_adjustment", "purchase_order_receive"],
      default: "stock_adjustment"
    },
    sourceId: {
      type: String,
      default: null,
      trim: true
    },
    note: {
      type: String,
      trim: true,
      maxlength: 280,
      default: ""
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    }
  },
  {
    timestamps: true
  }
);

warehouseStockMovementSchema.index({ workspaceId: 1, createdAt: -1 });
warehouseStockMovementSchema.index({ workspaceId: 1, productId: 1, createdAt: -1 });

export const WarehouseStockMovement = mongoose.model("WarehouseStockMovement", warehouseStockMovementSchema);
