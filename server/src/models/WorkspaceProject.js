import mongoose from "mongoose";

const workspaceProjectMilestoneSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180
    },
    weight: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    done: {
      type: Boolean,
      default: false
    }
  },
  {
    _id: true
  }
);

const workspaceProjectTeamMemberSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 140
    },
    email: {
      type: String,
      trim: true,
      default: ""
    }
  },
  {
    _id: true
  }
);

const workspaceProjectConversationLinkSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WorkspaceConversation",
      default: null
    },
    threadId: {
      type: String,
      trim: true,
      maxlength: 180,
      default: ""
    },
    messageId: {
      type: String,
      trim: true,
      maxlength: 180,
      default: ""
    },
    threadName: {
      type: String,
      trim: true,
      maxlength: 180,
      default: ""
    },
    messageExcerpt: {
      type: String,
      trim: true,
      maxlength: 400,
      default: ""
    },
    linkedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    linkedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    _id: true
  }
);

const workspaceProjectSchema = new mongoose.Schema(
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
      maxlength: 180
    },
    client: {
      type: String,
      trim: true,
      default: "Internal",
      maxlength: 140
    },
    type: {
      type: String,
      trim: true,
      default: "General",
      maxlength: 140
    },
    status: {
      type: String,
      enum: ["planning", "active", "completed", "hold", "on_hold", "cancelled"],
      default: "planning",
      index: true
    },
    completedAt: {
      type: Date,
      default: null
    },
    dueDate: {
      type: Date,
      default: null,
      index: true
    },
    summary: {
      type: String,
      trim: true,
      default: "",
      maxlength: 2000
    },
    milestones: {
      type: [workspaceProjectMilestoneSchema],
      default: []
    },
    team: {
      type: [workspaceProjectTeamMemberSchema],
      default: []
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
    conversationLinks: {
      type: [workspaceProjectConversationLinkSchema],
      default: []
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

workspaceProjectSchema.index({ workspaceId: 1, status: 1, updatedAt: -1 });
workspaceProjectSchema.index({ workspaceId: 1, dueDate: 1, updatedAt: -1 });
workspaceProjectSchema.index({ workspaceId: 1, sourceConversationId: 1, updatedAt: -1 });

export const WorkspaceProject = mongoose.model("WorkspaceProject", workspaceProjectSchema);
