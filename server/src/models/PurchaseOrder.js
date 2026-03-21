import mongoose from "mongoose";

const purchaseOrderLineItemSchema = new mongoose.Schema(
  {
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WarehouseProduct",
      default: null
    },
    itemName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 140
    },
    sku: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 60,
      default: ""
    },
    quantity: {
      type: Number,
      required: true,
      min: 0.01
    },
    unitCost: {
      type: Number,
      required: true,
      min: 0
    },
    taxRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    taxAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    lineTotalWithTax: {
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
    receivedQuantity: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  {
    _id: true
  }
);

const purchaseOrderSchema = new mongoose.Schema(
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
      maxlength: 40
    },
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FinanceVendor",
      default: null
    },
    vendorName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 140
    },
    status: {
      type: String,
      enum: ["draft", "sent", "acknowledged", "partially_received", "received", "cancelled"],
      default: "draft"
    },
    lineItems: {
      type: [purchaseOrderLineItemSchema],
      default: []
    },
    totalAmount: {
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
    expectedDeliveryDate: {
      type: Date,
      default: null
    },
    notes: {
      type: String,
      trim: true,
      default: "",
      maxlength: 2000
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
    sentAt: {
      type: Date,
      default: null
    },
    receivedAt: {
      type: Date,
      default: null
    },
    financeExpenseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExpenseRecord",
      default: null
    }
  },
  {
    timestamps: true
  }
);

purchaseOrderSchema.index({ workspaceId: 1, orderNumber: 1 }, { unique: true });
purchaseOrderSchema.index({ workspaceId: 1, status: 1, createdAt: -1 });
purchaseOrderSchema.index({ workspaceId: 1, vendorId: 1, createdAt: -1 });

export const PurchaseOrder = mongoose.model("PurchaseOrder", purchaseOrderSchema);
