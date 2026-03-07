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
    }
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

export const User = mongoose.model("User", userSchema);
