import bcrypt from "bcryptjs";
import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 40
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true
    },
    password: {
      type: String,
      required: true,
      minlength: 8,
      select: false
    },
    avatarColor: {
      type: String,
      default: "#0084ff"
    },
    avatarUrl: {
      type: String,
      default: null
    },
    statusMessage: {
      type: String,
      trim: true,
      maxlength: 120,
      default: ""
    },
    language: {
      type: String,
      enum: ["en", "bn"],
      default: "en"
    },
    showLastSeen: {
      type: Boolean,
      default: true
    },
    isAdmin: {
      type: Boolean,
      default: false
    },
    isVerified: {
      type: Boolean,
      default: false
    },
    workspaceEnabled: {
      type: Boolean,
      default: true
    },
    workspaceRole: {
      type: String,
      enum: ["owner", "manager", "finance", "warehouse", "staff"],
      default: undefined
    },
    workspaceRoles: {
      type: [
        {
          type: String,
          enum: ["viewer", "approver", "finance_staff", "accountant"]
        }
      ],
      default: undefined
    },
    workspaceModules: {
      type: [
        {
          type: String,
          enum: ["finance", "warehouse"]
        }
      ],
      default: undefined
    },
    lastActiveAt: {
      type: Date,
      default: null
    },
    presenceStatus: {
      type: String,
      enum: ["online", "away", "offline"],
      default: "offline"
    },
    sessionVersion: {
      type: Number,
      default: 0
    },
    activeSessions: [
      {
        sessionId: {
          type: String,
          required: true
        },
        createdAt: {
          type: Date,
          default: Date.now
        },
        lastSeenAt: {
          type: Date,
          default: Date.now
        },
        userAgent: {
          type: String,
          default: ""
        },
        ipAddress: {
          type: String,
          default: ""
        }
      }
    ],
    twoFactorEnabled: {
      type: Boolean,
      default: false
    },
    twoFactorCodeHash: {
      type: String,
      default: null,
      select: false
    },
    twoFactorExpiresAt: {
      type: Date,
      default: null,
      select: false
    },
    resetPasswordCodeHash: {
      type: String,
      default: null,
      select: false
    },
    resetPasswordExpiresAt: {
      type: Date,
      default: null,
      select: false
    },
    pushSubscriptions: [
      {
        endpoint: {
          type: String,
          required: true
        },
        expirationTime: {
          type: Date,
          default: null
        },
        keys: {
          p256dh: {
            type: String,
            required: true
          },
          auth: {
            type: String,
            required: true
          }
        },
        userAgent: {
          type: String,
          default: ""
        },
        createdAt: {
          type: Date,
          default: Date.now
        },
        lastUsedAt: {
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

userSchema.pre("save", async function hashPassword(next) {
  if (!this.isModified("password")) {
    return next();
  }

  this.password = await bcrypt.hash(this.password, Number(process.env.BCRYPT_ROUNDS || 12));
  return next();
});

userSchema.methods.comparePassword = function comparePassword(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.touchPresence = function touchPresence(status = "online") {
  this.presenceStatus = status;
  this.lastActiveAt = new Date();
};

userSchema.methods.findActiveSession = function findActiveSession(sessionId) {
  return (this.activeSessions || []).find((session) => session.sessionId === sessionId) || null;
};

userSchema.methods.registerSession = function registerSession(session) {
  this.activeSessions = [
    ...(this.activeSessions || []).filter((entry) => entry.sessionId !== session.sessionId),
    session
  ].slice(-10);
};

userSchema.methods.revokeSession = function revokeSession(sessionId) {
  this.activeSessions = (this.activeSessions || []).filter((session) => session.sessionId !== sessionId);
};

userSchema.methods.getWorkspaceRole = function getWorkspaceRole() {
  if (this.workspaceRole) {
    return this.workspaceRole;
  }

  if (this.isAdmin) {
    return "owner";
  }

  return "manager";
};

userSchema.methods.getWorkspaceModules = function getWorkspaceModules() {
  if (Array.isArray(this.workspaceModules) && this.workspaceModules.length > 0) {
    return [...new Set(this.workspaceModules)];
  }

  const role = this.getWorkspaceRole();
  if (role === "finance") {
    return ["finance"];
  }

  if (role === "warehouse") {
    return ["warehouse"];
  }

  return ["finance", "warehouse"];
};

userSchema.methods.getWorkspaceRoles = function getWorkspaceRoles() {
  if (Array.isArray(this.workspaceRoles) && this.workspaceRoles.length > 0) {
    return [...new Set(this.workspaceRoles)];
  }

  const role = this.getWorkspaceRole();
  if (role === "finance") {
    return ["finance_staff"];
  }

  if (role === "owner" || role === "manager") {
    return ["approver", "finance_staff"];
  }

  if (role === "accountant") {
    return ["accountant"];
  }

  if (role === "staff") {
    return ["viewer"];
  }

  return [];
};

userSchema.methods.hasWorkspaceRole = function hasWorkspaceRole(role) {
  return this.getWorkspaceRoles().includes(role);
};

userSchema.methods.hasWorkspaceModuleAccess = function hasWorkspaceModuleAccess(module) {
  if (this.workspaceEnabled === false) {
    return false;
  }

  return this.getWorkspaceModules().includes(module);
};

export const User = mongoose.model("User", userSchema);
