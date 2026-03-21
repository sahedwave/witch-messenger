import mongoose from "mongoose";

const expenseReceiptSchema = new mongoose.Schema(
  {
    fileName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120
    },
    fileUrl: {
      type: String,
      required: true,
      trim: true
    },
    fileType: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  },
  { _id: false }
);

const expenseRecordSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    taxRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    taxAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    taxLabel: {
      type: String,
      trim: true,
      default: "Tax",
      maxlength: 40
    },
    totalWithTax: {
      type: Number,
      default: 0,
      min: 0
    },
    currency: {
      type: String,
      default: "USD",
      uppercase: true,
      trim: true,
      maxlength: 8
    },
    category: {
      type: String,
      enum: ["travel", "supplies", "utilities", "salary", "marketing", "other"],
      default: "other"
    },
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FinanceVendor",
      default: null,
      index: true
    },
    vendorName: {
      type: String,
      trim: true,
      default: "",
      maxlength: 140
    },
    vendorEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
      maxlength: 160
    },
    expenseDate: {
      type: Date,
      default: Date.now
    },
    note: {
      type: String,
      trim: true,
      default: "",
      maxlength: 2000
    },
    source: {
      type: String,
      trim: true,
      default: "",
      maxlength: 60
    },
    sourceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true
    },
    status: {
      type: String,
      enum: ["draft", "submitted", "pending_review", "approved", "rejected", "reimbursed", "reconciled"],
      default: "pending_review"
    },
    threadKey: {
      type: String,
      default: "financebot",
      trim: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    approvedAt: {
      type: Date,
      default: null
    },
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    rejectedAt: {
      type: Date,
      default: null
    },
    rejectionReason: {
      type: String,
      trim: true,
      default: "",
      maxlength: 1000
    },
    reimbursedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    reimbursedAt: {
      type: Date,
      default: null
    },
    reimbursement: {
      method: {
        type: String,
        trim: true,
        default: "",
        maxlength: 60
      },
      reference: {
        type: String,
        trim: true,
        default: "",
        maxlength: 120
      },
      note: {
        type: String,
        trim: true,
        default: "",
        maxlength: 1000
      }
    },
    reconciledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    sourceMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null
    },
    receipt: {
      type: expenseReceiptSchema,
      default: null
    },
    accounting: {
      expenseEntryId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "JournalEntry",
        default: null
      },
      expenseEntryStatus: {
        type: String,
        enum: ["unposted", "posted", "voided"],
        default: "unposted"
      },
      settlementEntryId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "JournalEntry",
        default: null
      },
      settlementEntryStatus: {
        type: String,
        enum: ["unposted", "pending", "posted", "voided"],
        default: "unposted"
      },
      controlStatus: {
        type: String,
        enum: ["clear", "blocked"],
        default: "clear"
      },
      blockedReason: {
        type: String,
        trim: true,
        default: ""
      },
      blockedAt: {
        type: Date,
        default: null
      },
      blockedPeriodKey: {
        type: String,
        trim: true,
        default: ""
      },
      lastSyncedAt: {
        type: Date,
        default: null
      }
    }
  },
  {
    timestamps: true
  }
);

expenseRecordSchema.index({ status: 1, expenseDate: -1 });
expenseRecordSchema.index({ createdBy: 1, createdAt: -1 });
expenseRecordSchema.index({ workspaceId: 1, status: 1, expenseDate: -1 });
expenseRecordSchema.index({ workspaceId: 1, source: 1, sourceId: 1 });

export const ExpenseRecord = mongoose.model("ExpenseRecord", expenseRecordSchema);
