import mongoose from "mongoose";

const workspaceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 80,
      unique: true
    },
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    accountingEnabled: {
      type: Boolean,
      default: false
    },
    accountingEnabledAt: {
      type: Date,
      default: null
    },
    defaultCurrency: {
      type: String,
      default: "USD",
      uppercase: true,
      trim: true,
      maxlength: 8
    },
    status: {
      type: String,
      enum: ["active", "archived"],
      default: "active"
    }
  },
  {
    timestamps: true
  }
);

workspaceSchema.index({ status: 1, createdAt: -1 });

export const Workspace = mongoose.model("Workspace", workspaceSchema);
