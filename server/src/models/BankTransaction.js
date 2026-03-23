import mongoose from "mongoose";

const bankTransactionSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true
    },
    bankAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BankAccount",
      required: true,
      index: true
    },
    transactionDate: {
      type: Date,
      required: true
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 240
    },
    amount: {
      type: Number,
      required: true
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
      trim: true,
      default: "other",
      maxlength: 80
    },
    providerTransactionId: {
      type: String,
      trim: true,
      default: "",
      maxlength: 160
    },
    matchedExpenseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExpenseRecord",
      default: null
    },
    matchedInvoicePaymentId: {
      type: String,
      trim: true,
      default: ""
    },
    reconciled: {
      type: Boolean,
      default: false
    },
    reconciledAt: {
      type: Date,
      default: null
    },
    matchConfidence: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    matchSuggestions: {
      type: [
        {
          referenceType: {
            type: String,
            enum: ["expense", "invoice_payment"],
            required: true
          },
          referenceId: {
            type: String,
            required: true,
            trim: true
          },
          confidence: {
            type: Number,
            default: 0
          },
          label: {
            type: String,
            trim: true,
            default: ""
          },
          amount: {
            type: Number,
            default: 0
          },
          currency: {
            type: String,
            default: "USD",
            uppercase: true,
            trim: true,
            maxlength: 8
          },
          transactionDate: {
            type: Date,
            default: null
          }
        }
      ],
      default: []
    },
    source: {
      type: String,
      enum: ["manual", "bank_sync"],
      default: "manual"
    }
  },
  {
    timestamps: true
  }
);

bankTransactionSchema.index({ workspaceId: 1, bankAccountId: 1, transactionDate: -1 });
bankTransactionSchema.index({ workspaceId: 1, reconciled: 1, transactionDate: -1 });
bankTransactionSchema.index(
  { workspaceId: 1, providerTransactionId: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: {
      providerTransactionId: { $type: "string", $ne: "" }
    }
  }
);

export const BankTransaction = mongoose.model("BankTransaction", bankTransactionSchema);
