import mongoose from "mongoose";

const workspaceTaskSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180
    },
    note: {
      type: String,
      trim: true,
      maxlength: 1200,
      default: ""
    },
    status: {
      type: String,
      enum: ["todo", "doing", "done", "later"],
      default: "todo",
      index: true
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent", "Low", "Medium", "High"],
      default: "medium",
      index: true
    },
    dueDate: {
      type: Date,
      default: null,
      index: true
    },
    completedAt: {
      type: Date,
      default: null,
      index: true
    },
    mode: {
      type: String,
      enum: ["professional", "student"],
      default: "professional",
      index: true
    },
    assignedTo: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      }
    ],
    assigneeNames: [
      {
        type: String,
        trim: true,
        maxlength: 140
      }
    ],
    assigneeUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true
    },
    assigneeName: {
      type: String,
      trim: true,
      maxlength: 140,
      default: ""
    },
    projectId: {
      type: String,
      trim: true,
      default: null
    },
    sourceConversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WorkspaceConversation",
      default: null,
      index: true
    },
    sourceThreadId: {
      type: String,
      trim: true,
      maxlength: 180,
      default: ""
    },
    sourceMessageId: {
      type: String,
      trim: true,
      maxlength: 180,
      default: ""
    },
    sourceThreadName: {
      type: String,
      trim: true,
      maxlength: 180,
      default: ""
    },
    sourceMessageExcerpt: {
      type: String,
      trim: true,
      maxlength: 400,
      default: ""
    },
    createdByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    updatedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    }
  },
  {
    timestamps: true
  }
);

workspaceTaskSchema.index({ workspaceId: 1, mode: 1, updatedAt: -1 });
workspaceTaskSchema.index({ workspaceId: 1, assignedTo: 1, updatedAt: -1 });
workspaceTaskSchema.index({ workspaceId: 1, assigneeUserId: 1, updatedAt: -1 });
workspaceTaskSchema.index({ workspaceId: 1, sourceConversationId: 1, updatedAt: -1 });

export const WorkspaceTask = mongoose.model("WorkspaceTask", workspaceTaskSchema);
