import mongoose from "mongoose";

const memoryCapsuleSchema = new mongoose.Schema(
  {
    conversationKey: {
      type: String,
      required: true,
      index: true
    },
    initiator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    participant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    title: {
      type: String,
      trim: true,
      maxlength: 120,
      default: ""
    },
    note: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: ""
    },
    tone: {
      type: String,
      enum: ["warm", "playful", "future", "promise"],
      default: "warm"
    },
    openMode: {
      type: String,
      enum: ["solo", "together"],
      default: "solo"
    },
    privacyMode: {
      type: String,
      enum: ["shared", "gift", "mutual"],
      default: "shared"
    },
    retentionMode: {
      type: String,
      enum: ["archive", "auto-delete"],
      default: "archive"
    },
    unlockAt: {
      type: Date,
      required: true,
      index: true
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
    linkUrl: {
      type: String,
      trim: true,
      maxlength: 400,
      default: ""
    },
    openRequestBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    openRequestExpiresAt: {
      type: Date,
      default: null
    },
    openedAt: {
      type: Date,
      default: null
    },
    reminderNotifiedAt: {
      type: Date,
      default: null
    },
    readyNotifiedAt: {
      type: Date,
      default: null
    },
    deletedAt: {
      type: Date,
      default: null,
      index: true
    },
    reactions: [
      {
        emoji: {
          type: String,
          maxlength: 8,
          required: true
        },
        users: [
          {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User"
          }
        ]
      }
    ],
    replies: [
      {
        author: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true
        },
        text: {
          type: String,
          trim: true,
          maxlength: 500,
          required: true
        },
        createdAt: {
          type: Date,
          default: Date.now
        }
      }
    ]
  },
  {
    timestamps: true
  }
);

memoryCapsuleSchema.index({ conversationKey: 1, createdAt: -1 });

export const MemoryCapsule = mongoose.model("MemoryCapsule", memoryCapsuleSchema);
