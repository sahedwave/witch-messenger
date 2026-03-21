import mongoose from "mongoose";

const workspaceMembershipSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 160
    },
    workspaceRole: {
      type: String,
      enum: ["owner", "manager", "member"],
      default: "member"
    },
    financeRoles: {
      type: [
        {
          type: String,
          enum: ["viewer", "approver", "finance_staff", "accountant"]
        }
      ],
      default: []
    },
    modules: {
      type: [
        {
          type: String,
          enum: ["finance", "warehouse"]
        }
      ],
      default: []
    },
    status: {
      type: String,
      enum: ["active", "invited", "suspended"],
      default: "active"
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    }
  },
  {
    timestamps: true
  }
);

workspaceMembershipSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });
workspaceMembershipSchema.index({ workspaceId: 1, email: 1 }, { unique: true });
workspaceMembershipSchema.index({ status: 1, workspaceRole: 1 });

export const WorkspaceMembership = mongoose.model("WorkspaceMembership", workspaceMembershipSchema);
