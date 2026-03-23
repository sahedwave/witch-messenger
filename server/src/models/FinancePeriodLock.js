import mongoose from "mongoose";

const financePeriodLockSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true
    },
    periodKey: {
      type: String,
      required: true,
      trim: true
    },
    periodStart: {
      type: Date,
      required: true
    },
    periodEnd: {
      type: Date,
      required: true
    },
    note: {
      type: String,
      trim: true,
      default: ""
    },
    lockedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    }
  },
  {
    timestamps: true
  }
);

financePeriodLockSchema.index({ workspaceId: 1, periodKey: 1 }, { unique: true });
financePeriodLockSchema.index({ workspaceId: 1, periodStart: -1 });

export const FinancePeriodLock = mongoose.model("FinancePeriodLock", financePeriodLockSchema);
