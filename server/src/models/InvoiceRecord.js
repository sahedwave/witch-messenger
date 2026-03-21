import mongoose from "mongoose";

const invoiceAttachmentSchema = new mongoose.Schema(
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

const recurringInvoiceSchema = new mongoose.Schema(
  {
    enabled: {
      type: Boolean,
      default: false
    },
    frequency: {
      type: String,
      enum: ["weekly", "monthly", "quarterly"],
      default: "monthly"
    },
    interval: {
      type: Number,
      min: 1,
      max: 12,
      default: 1
    },
    nextIssueDate: {
      type: Date,
      default: null
    },
    lastIssuedAt: {
      type: Date,
      default: null
    }
  },
  { _id: false }
);

const invoicePaymentSchema = new mongoose.Schema(
  {
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    recordedAt: {
      type: Date,
      default: Date.now
    },
    remainingBalance: {
      type: Number,
      min: 0,
      default: 0
    },
    method: {
      type: String,
      trim: true,
      default: "",
      maxlength: 40
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
      maxlength: 500
    },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    }
  },
  {
    timestamps: false
  }
);

const invoiceRecordSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true
    },
    invoiceNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 40
    },
    vendorName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 140
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FinanceCustomer",
      default: null,
      index: true
    },
    customerName: {
      type: String,
      trim: true,
      default: "",
      maxlength: 160
    },
    customerEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
      maxlength: 160
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    subtotal: {
      type: Number,
      default: 0,
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
    dueDate: {
      type: Date,
      required: true
    },
    status: {
      type: String,
      enum: ["new", "pending_review", "approved", "partial", "rejected", "paid", "overdue", "reconciled", "flagged"],
      default: "pending_review"
    },
    paidAmount: {
      type: Number,
      min: 0,
      default: 0
    },
    paidAt: {
      type: Date,
      default: null
    },
    payments: {
      type: [invoicePaymentSchema],
      default: []
    },
    note: {
      type: String,
      trim: true,
      default: "",
      maxlength: 2000
    },
    rejectionReason: {
      type: String,
      trim: true,
      default: "",
      maxlength: 1000
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
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    paidBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
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
    recurringSourceInvoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InvoiceRecord",
      default: null,
      index: true
    },
    recurringSequence: {
      type: Number,
      min: 0,
      default: 0
    },
    attachments: {
      type: [invoiceAttachmentSchema],
      default: []
    },
    recurring: {
      type: recurringInvoiceSchema,
      default: () => ({
        enabled: false,
        frequency: "monthly",
        interval: 1,
        nextIssueDate: null,
        lastIssuedAt: null
      })
    },
    accounting: {
      revenueEntryId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "JournalEntry",
        default: null
      },
      revenueEntryStatus: {
        type: String,
        enum: ["unposted", "posted", "voided"],
        default: "unposted"
      },
      paymentEntryIds: {
        type: [mongoose.Schema.Types.ObjectId],
        ref: "JournalEntry",
        default: []
      },
      paymentPostedCount: {
        type: Number,
        min: 0,
        default: 0
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

invoiceRecordSchema.index({ status: 1, dueDate: 1 });
invoiceRecordSchema.index({ createdBy: 1, createdAt: -1 });
invoiceRecordSchema.index({ workspaceId: 1, invoiceNumber: 1 }, { unique: true });
invoiceRecordSchema.index({ workspaceId: 1, status: 1, dueDate: 1 });
invoiceRecordSchema.index({ workspaceId: 1, "recurring.enabled": 1, "recurring.nextIssueDate": 1 });

export const InvoiceRecord = mongoose.model("InvoiceRecord", invoiceRecordSchema);
