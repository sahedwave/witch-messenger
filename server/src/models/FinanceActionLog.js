import mongoose from "mongoose";

const financeActionLogSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true
    },
    itemType: {
      type: String,
      enum: ["invoice", "expense", "control"],
      required: true
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    action: {
      type: String,
      enum: [
        "created",
        "updated",
        "approved",
        "rejected",
        "reimbursed",
        "paid",
        "reconciled",
        "note_added",
        "flagged",
        "submitted",
        "recurring_issued",
        "locked",
        "unlocked",
        "blocked"
      ],
      required: true
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    threadKey: {
      type: String,
      default: "financebot",
      trim: true
    },
    sourceMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: true
  }
);

financeActionLogSchema.index({ itemType: 1, itemId: 1, createdAt: -1 });
financeActionLogSchema.index({ performedBy: 1, createdAt: -1 });
financeActionLogSchema.index({ workspaceId: 1, createdAt: -1 });

export const FinanceActionLog = mongoose.model("FinanceActionLog", financeActionLogSchema);
