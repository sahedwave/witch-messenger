import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    conversationKey: {
      type: String,
      required: true,
      index: true
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    text: {
      type: String,
      trim: true,
      maxlength: 1000
    },
    linkPreview: {
      url: {
        type: String,
        default: null
      },
      domain: {
        type: String,
        default: null
      }
    },
    attachment: {
      dataUrl: {
        type: String,
        default: null
      },
      mimeType: {
        type: String,
        default: null
      },
      name: {
        type: String,
        default: null
      },
      size: {
        type: Number,
        default: 0
      }
    },
    isSnap: {
      type: Boolean,
      default: false
    },
    snapOpenedAt: {
      type: Date,
      default: null
    },
    snapViewSeconds: {
      type: Number,
      default: 0
    },
    seenAt: {
      type: Date,
      default: null
    },
    editedAt: {
      type: Date,
      default: null
    },
    deletedAt: {
      type: Date,
      default: null
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null
    },
    forwardedFrom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    starredBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      }
    ],
    autoDeleteAt: {
      type: Date,
      default: null
    },
    reactions: [
      {
        emoji: {
          type: String,
          required: true
        },
        users: [
          {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User"
          }
        ]
      }
    ]
  },
  {
    timestamps: true,
    minimize: false
  }
);

messageSchema.pre("validate", function validateMessage(next) {
  if (this.deletedAt) {
    return next();
  }

  if (!this.text && !this.attachment?.dataUrl) {
    this.invalidate("text", "Message text or an attachment is required.");
  }

  return next();
});

messageSchema.methods.toggleReaction = function toggleReaction(userId, emoji) {
  const existingReaction = this.reactions.find((reaction) => reaction.emoji === emoji);

  if (!existingReaction) {
    this.reactions.push({
      emoji,
      users: [userId]
    });
    return;
  }

  const hasReacted = existingReaction.users.some((entry) => entry.toString() === userId.toString());

  if (hasReacted) {
    existingReaction.users = existingReaction.users.filter(
      (entry) => entry.toString() !== userId.toString()
    );
  } else {
    existingReaction.users.push(userId);
  }

  this.reactions = this.reactions.filter((reaction) => reaction.users.length > 0);
};

messageSchema.methods.toggleStar = function toggleStar(userId) {
  const exists = this.starredBy.some((entry) => entry.toString() === userId.toString());

  if (exists) {
    this.starredBy = this.starredBy.filter((entry) => entry.toString() !== userId.toString());
    return;
  }

  this.starredBy.push(userId);
};

messageSchema.index({ conversationKey: 1, createdAt: 1 });
messageSchema.index({ conversationKey: 1, deletedAt: 1 });
messageSchema.index({ conversationKey: 1, starredBy: 1 });
messageSchema.index({ sender: 1, recipient: 1, createdAt: -1 });

export const Message = mongoose.model("Message", messageSchema);
