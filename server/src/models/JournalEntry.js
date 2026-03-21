import mongoose from "mongoose";

const journalLineSchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      required: true
    },
    accountCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 20
    },
    accountName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 140
    },
    accountType: {
      type: String,
      enum: ["asset", "liability", "equity", "income", "expense"],
      required: true
    },
    debit: {
      type: Number,
      min: 0,
      default: 0
    },
    credit: {
      type: Number,
      min: 0,
      default: 0
    },
    memo: {
      type: String,
      trim: true,
      default: "",
      maxlength: 280
    }
  },
  { _id: false }
);

const journalEntrySchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true
    },
    entryNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 40
    },
    entryType: {
      type: String,
      enum: ["invoice_accrual", "invoice_payment", "expense_accrual", "expense_payment"],
      required: true
    },
    postingDate: {
      type: Date,
      required: true
    },
    status: {
      type: String,
      enum: ["posted", "voided"],
      default: "posted"
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 240
    },
    sourceType: {
      type: String,
      enum: ["invoice", "expense"],
      required: true
    },
    sourceId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true
    },
    sourceSubId: {
      type: String,
      trim: true,
      default: null,
      maxlength: 60
    },
    lines: {
      type: [journalLineSchema],
      default: []
    },
    totalDebit: {
      type: Number,
      min: 0,
      default: 0
    },
    totalCredit: {
      type: Number,
      min: 0,
      default: 0
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    voidedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

journalEntrySchema.index(
  { workspaceId: 1, sourceType: 1, sourceId: 1, entryType: 1, sourceSubId: 1 },
  { unique: true }
);
journalEntrySchema.index({ workspaceId: 1, postingDate: -1, status: 1 });

export const JournalEntry = mongoose.model("JournalEntry", journalEntrySchema);
