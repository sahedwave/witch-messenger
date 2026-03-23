import mongoose from "mongoose";

const warehouseOrderStatusHistorySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["pending", "packed", "dispatched", "in_transit", "delayed", "delivered", "cancelled"],
      required: true
    },
    currentStep: {
      type: Number,
      min: 0,
      max: 3,
      required: true
    },
    note: {
      type: String,
      trim: true,
      maxlength: 240,
      default: ""
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    changedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    _id: false
  }
);

const warehouseOrderSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true
    },
    orderNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 60
    },
    destination: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160
    },
    shipmentType: {
      type: String,
      enum: ["outgoing", "incoming"],
      default: "outgoing"
    },
    itemsCount: {
      type: Number,
      min: 1,
      default: 1
    },
    status: {
      type: String,
      enum: ["pending", "packed", "dispatched", "in_transit", "delayed", "delivered", "cancelled"],
      default: "dispatched"
    },
    currentStep: {
      type: Number,
      min: 0,
      max: 3,
      default: 1
    },
    estimatedDelivery: {
      type: Date,
      required: true
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
    },
    statusHistory: {
      type: [warehouseOrderStatusHistorySchema],
      default: []
    }
  },
  {
    timestamps: true
  }
);

warehouseOrderSchema.index({ workspaceId: 1, orderNumber: 1 }, { unique: true });
warehouseOrderSchema.index({ workspaceId: 1, status: 1, updatedAt: -1 });

export const WarehouseOrder = mongoose.model("WarehouseOrder", warehouseOrderSchema);
