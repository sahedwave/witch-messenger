import mongoose from "mongoose";

const workspaceNotificationSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true
    },
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    type: {
      type: String,
      enum: ["task_assigned", "task_due_soon", "task_overdue", "project_assigned"],
      required: true,
      index: true
    },
    referenceType: {
      type: String,
      enum: ["task", "project"],
      required: true
    },
    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 280
    },
    read: {
      type: Boolean,
      default: false,
      index: true
    },
    readAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

workspaceNotificationSchema.index({ workspaceId: 1, recipientId: 1, read: 1, createdAt: -1 });
workspaceNotificationSchema.index({ workspaceId: 1, recipientId: 1, type: 1, referenceId: 1, createdAt: -1 });

export const WorkspaceNotification = mongoose.model("WorkspaceNotification", workspaceNotificationSchema);
