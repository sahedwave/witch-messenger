import mongoose from "mongoose";

const chartOfAccountSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true
    },
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 20
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 140
    },
    type: {
      type: String,
      enum: ["asset", "liability", "equity", "income", "expense"],
      required: true
    },
    subtype: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80
    },
    normalBalance: {
      type: String,
      enum: ["debit", "credit"],
      required: true
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active"
    },
    isSystem: {
      type: Boolean,
      default: true
    },
    description: {
      type: String,
      trim: true,
      default: "",
      maxlength: 500
    }
  },
  {
    timestamps: true
  }
);

chartOfAccountSchema.index({ workspaceId: 1, code: 1 }, { unique: true });
chartOfAccountSchema.index({ workspaceId: 1, subtype: 1 }, { unique: true });
chartOfAccountSchema.index({ workspaceId: 1, type: 1, status: 1, code: 1 });

export const ChartOfAccount = mongoose.model("ChartOfAccount", chartOfAccountSchema);
