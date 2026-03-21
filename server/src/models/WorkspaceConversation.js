import mongoose from "mongoose";

const workspaceConversationMessageSchema = new mongoose.Schema(
  {
    senderUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    senderKey: {
      type: String,
      trim: true,
      maxlength: 80,
      default: ""
    },
    senderName: {
      type: String,
      trim: true,
      maxlength: 160,
      default: ""
    },
    type: {
      type: String,
      enum: ["text", "system"],
      default: "text"
    },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 4000
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    _id: true
  }
);

const workspaceConversationSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true
    },
    key: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160
    },
    kind: {
      type: String,
      enum: ["bot", "direct"],
      required: true
    },
    botType: {
      type: String,
      enum: ["finance", "warehouse", null],
      default: null
    },
    title: {
      type: String,
      trim: true,
      maxlength: 160,
      default: ""
    },
    participantUserIds: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User"
        }
      ],
      default: []
    },
    messages: {
      type: [workspaceConversationMessageSchema],
      default: []
    },
    status: {
      type: String,
      enum: ["active", "archived"],
      default: "active"
    },
    archived: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
);

workspaceConversationSchema.index({ workspaceId: 1, key: 1 }, { unique: true });
workspaceConversationSchema.index({ workspaceId: 1, kind: 1, updatedAt: -1 });
workspaceConversationSchema.index({ workspaceId: 1, participantUserIds: 1 });

export const WorkspaceConversation = mongoose.model("WorkspaceConversation", workspaceConversationSchema);
