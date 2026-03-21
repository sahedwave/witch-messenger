import mongoose from "mongoose";

const pdfReviewSessionSchema = new mongoose.Schema(
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
    presenter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
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
      maxlength: 400,
      default: ""
    },
    file: {
      dataUrl: {
        type: String,
        default: null
      },
      storageKey: {
        type: String,
        default: null
      },
      publicUrl: {
        type: String,
        default: null
      },
      mimeType: {
        type: String,
        default: null
      },
      name: {
        type: String,
        required: true
      },
      size: {
        type: Number,
        default: 0
      }
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "declined", "completed"],
      default: "pending",
      index: true
    },
    syncEnabled: {
      type: Boolean,
      default: true
    },
    viewerState: {
      page: {
        type: Number,
        default: 1
      },
      zoom: {
        type: Number,
        default: 100
      }
    },
    acceptedAt: {
      type: Date,
      default: null
    },
    expiresAt: {
      type: Date,
      default: null,
      index: true
    },
    endedAt: {
      type: Date,
      default: null
    },
    fileDeletedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

pdfReviewSessionSchema.index({ conversationKey: 1, createdAt: -1 });

export const PdfReviewSession = mongoose.model("PdfReviewSession", pdfReviewSessionSchema);
