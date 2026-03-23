import mongoose from "mongoose";

const payrollDeductionSchema = new mongoose.Schema(
  {
    label: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    }
  },
  { _id: false }
);

const payrollRecordSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true
    },
    employeeName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 140
    },
    employeeId: {
      type: String,
      trim: true,
      default: "",
      maxlength: 120
    },
    payPeriodStart: {
      type: Date,
      required: true
    },
    payPeriodEnd: {
      type: Date,
      required: true
    },
    grossAmount: {
      type: Number,
      required: true,
      min: 0
    },
    deductions: {
      type: [payrollDeductionSchema],
      default: []
    },
    netAmount: {
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
    status: {
      type: String,
      enum: ["draft", "approved", "paid", "cancelled"],
      default: "draft"
    },
    paidAt: {
      type: Date,
      default: null
    },
    paymentMethod: {
      type: String,
      trim: true,
      default: "",
      maxlength: 80
    },
    paymentReference: {
      type: String,
      trim: true,
      default: "",
      maxlength: 120
    },
    linkedExpenseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExpenseRecord",
      default: null
    },
    notes: {
      type: String,
      trim: true,
      default: "",
      maxlength: 2000
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    approvedAt: {
      type: Date,
      default: null
    },
    completedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

payrollRecordSchema.index({ workspaceId: 1, payPeriodEnd: -1, createdAt: -1 });

export const PayrollRecord = mongoose.model("PayrollRecord", payrollRecordSchema);
