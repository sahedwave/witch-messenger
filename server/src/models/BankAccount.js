import mongoose from "mongoose";

const bankAccountSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true
    },
    accountName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 140
    },
    accountType: {
      type: String,
      enum: ["checking", "savings", "credit", "other"],
      default: "checking"
    },
    currency: {
      type: String,
      default: "USD",
      uppercase: true,
      trim: true,
      maxlength: 8
    },
    currentBalance: {
      type: Number,
      default: 0
    },
    lastSyncedAt: {
      type: Date,
      default: null
    },
    provider: {
      type: String,
      trim: true,
      default: "manual",
      maxlength: 60
    },
    providerAccountId: {
      type: String,
      trim: true,
      default: "",
      maxlength: 120
    },
    plaidAccessToken: {
      type: String,
      trim: true,
      default: "",
      maxlength: 500
    },
    plaidItemId: {
      type: String,
      trim: true,
      default: "",
      maxlength: 180
    },
    plaidAccountId: {
      type: String,
      trim: true,
      default: "",
      maxlength: 180
    },
    plaidInstitutionName: {
      type: String,
      trim: true,
      default: "",
      maxlength: 160
    },
    plaidMask: {
      type: String,
      trim: true,
      default: "",
      maxlength: 20
    },
    isManual: {
      type: Boolean,
      default: true
    },
    status: {
      type: String,
      enum: ["active", "disconnected", "error"],
      default: "active"
    }
  },
  {
    timestamps: true
  }
);

bankAccountSchema.index({ workspaceId: 1, status: 1, updatedAt: -1 });
bankAccountSchema.index(
  { workspaceId: 1, plaidAccountId: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: {
      plaidAccountId: { $type: "string", $ne: "" }
    }
  }
);

export const BankAccount = mongoose.model("BankAccount", bankAccountSchema);
