import mongoose from "mongoose";

const financeVendorSchema = new mongoose.Schema(
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
      maxlength: 160
    },
    normalizedName: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 160
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
      maxlength: 160
    },
    phone: {
      type: String,
      trim: true,
      default: "",
      maxlength: 40
    },
    contactName: {
      type: String,
      trim: true,
      default: "",
      maxlength: 120
    },
    notes: {
      type: String,
      trim: true,
      default: "",
      maxlength: 1000
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active"
    },
    lastUsedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

financeVendorSchema.index({ workspaceId: 1, normalizedName: 1 }, { unique: true });
financeVendorSchema.index({ workspaceId: 1, status: 1, lastUsedAt: -1 });

export const FinanceVendor = mongoose.model("FinanceVendor", financeVendorSchema);
