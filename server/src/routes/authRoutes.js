import express from "express";
import crypto from "node:crypto";

import { authMiddleware } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { User } from "../models/User.js";
import { pickAvatarColor } from "../utils/avatarColor.js";
import { writeAuditLog } from "../utils/audit.js";
import { sendTransactionalEmail } from "../utils/email.js";
import { serializeUser } from "../utils/serializers.js";
import { createSessionId, signToken } from "../utils/token.js";
import { isValidEmail, validateName, validatePassword } from "../utils/validation.js";

const router = express.Router();
const authLimiter = createRateLimiter({
  prefix: "auth",
  windowMs: 60 * 1000,
  max: 10,
  message: "Too many authentication attempts. Please wait a minute and try again."
});

function createPublicError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.isPublic = true;
  return error;
}

function hashResetCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function getRequestContext(req) {
  return {
    ipAddress:
      req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() ||
      req.socket.remoteAddress ||
      "",
    userAgent: req.headers["user-agent"]?.toString().slice(0, 200) || ""
  };
}

async function createAuthenticatedSession(user, req) {
  const sessionId = createSessionId();
  const context = getRequestContext(req);

  user.registerSession({
    sessionId,
    createdAt: new Date(),
    lastSeenAt: new Date(),
    userAgent: context.userAgent,
    ipAddress: context.ipAddress
  });
  await user.save();

  return {
    token: signToken(user, sessionId),
    user: serializeUser(user)
  };
}

function signTwoFactorChallenge(user) {
  return crypto
    .createHmac("sha256", process.env.JWT_SECRET)
    .update(`${user._id.toString()}:${user.sessionVersion || 0}`)
    .digest("hex");
}

async function issueTwoFactorChallenge(user, options = {}) {
  const code = `${Math.floor(100000 + Math.random() * 900000)}`;
  user.twoFactorCodeHash = hashResetCode(code);
  user.twoFactorExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await user.save();

  const delivery = await sendTransactionalEmail({
    to: user.email,
    subject: options.subject || "Your WITCH security code",
    html: `<p>Your security code is <strong>${code}</strong>.</p><p>This code expires in 10 minutes.</p>`,
    text: `Your security code is ${code}. This code expires in 10 minutes.`
  });

  if (!delivery.delivered && process.env.NODE_ENV === "production") {
    user.twoFactorCodeHash = null;
    user.twoFactorExpiresAt = null;
    await user.save();

    throw createPublicError(
      options.failureMessage || "Email delivery for security codes is not configured on the server yet.",
      503
    );
  }

  return {
    challengeToken: signTwoFactorChallenge(user),
    code
  };
}

router.post("/register", authLimiter, async (req, res) => {
  try {
    const name = req.body.name?.trim() || "";
    const email = req.body.email?.trim().toLowerCase() || "";
    const password = req.body.password?.trim() || "";

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email, and password are required." });
    }

    const nameError = validateName(name);
    if (nameError) {
      return res.status(400).json({ message: nameError });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: "Please enter a valid email address." });
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ message: passwordError });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ message: "An account with this email already exists." });
    }

    const user = await User.create({
      name,
      email,
      password,
      avatarColor: pickAvatarColor(email)
    });

    await writeAuditLog({
      actor: user._id,
      action: "auth.register",
      targetId: user._id.toString(),
      targetType: "User",
      metadata: { email, ...getRequestContext(req) }
    });

    return res.status(201).json(await createAuthenticatedSession(user, req));
  } catch (error) {
    return res.status(500).json({ message: "Unable to register right now." });
  }
});

router.post("/login", authLimiter, async (req, res) => {
  try {
    const email = req.body.email?.trim().toLowerCase() || "";
    const password = req.body.password?.trim() || "";

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    const user = await User.findOne({ email }).select("+password");
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const passwordMatches = await user.comparePassword(password);
    if (!passwordMatches) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    user.touchPresence("online");
    await user.save();

    await writeAuditLog({
      actor: user._id,
      action: "auth.login",
      targetId: user._id.toString(),
      targetType: "User",
      metadata: { email, ...getRequestContext(req) }
    });

    if (user.twoFactorEnabled) {
      const { challengeToken, code } = await issueTwoFactorChallenge(user, {
        subject: "Your WITCH login security code",
        failureMessage: "Two-step verification email is not configured on the server yet."
      });
      return res.json({
        requiresTwoFactor: true,
        challengeToken,
        message: "Enter the security code to finish logging in.",
        devTwoFactorCode: process.env.NODE_ENV === "production" ? undefined : code
      });
    }

    return res.json(await createAuthenticatedSession(user, req));
  } catch (error) {
    if (error.isPublic) {
      return res.status(error.statusCode || 500).json({ message: error.message });
    }

    return res.status(500).json({ message: "Unable to log in right now." });
  }
});

router.post("/verify-2fa", authLimiter, async (req, res) => {
  try {
    const email = req.body.email?.trim().toLowerCase() || "";
    const code = req.body.code?.trim() || "";
    const challengeToken = req.body.challengeToken?.trim() || "";

    if (!email || !code || !challengeToken) {
      return res.status(400).json({ message: "Email, challenge token, and code are required." });
    }

    const user = await User.findOne({ email }).select("+twoFactorCodeHash +twoFactorExpiresAt");

    if (
      !user ||
      !user.twoFactorEnabled ||
      challengeToken !== signTwoFactorChallenge(user) ||
      !user.twoFactorCodeHash ||
      !user.twoFactorExpiresAt ||
      user.twoFactorExpiresAt.getTime() < Date.now() ||
      user.twoFactorCodeHash !== hashResetCode(code)
    ) {
      return res.status(400).json({ message: "Invalid or expired security code." });
    }

    user.twoFactorCodeHash = null;
    user.twoFactorExpiresAt = null;

    await writeAuditLog({
      actor: user._id,
      action: "auth.2fa.login",
      targetId: user._id.toString(),
      targetType: "User",
      metadata: { email, ...getRequestContext(req) }
    });

    return res.json(await createAuthenticatedSession(user, req));
  } catch (error) {
    return res.status(500).json({ message: "Unable to verify the security code right now." });
  }
});

router.post("/forgot-password", authLimiter, async (req, res) => {
  try {
    const email = req.body.email?.trim().toLowerCase() || "";

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ message: "Please enter a valid email address." });
    }

    const user = await User.findOne({ email }).select("+resetPasswordCodeHash +resetPasswordExpiresAt");
    const genericResponse = {
      message: "If an account exists for that email, a reset code has been generated."
    };

    if (!user) {
      return res.json(genericResponse);
    }

    const resetCode = `${Math.floor(100000 + Math.random() * 900000)}`;
    user.resetPasswordCodeHash = hashResetCode(resetCode);
    user.resetPasswordExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    await writeAuditLog({
      actor: user._id,
      action: "auth.password_reset.request",
      targetId: user._id.toString(),
      targetType: "User",
      metadata: { email, ...getRequestContext(req) }
    });

    const delivery = await sendTransactionalEmail({
      to: user.email,
      subject: "Your WITCH password reset code",
      html: `<p>Your password reset code is <strong>${resetCode}</strong>.</p><p>This code expires in 10 minutes.</p>`,
      text: `Your password reset code is ${resetCode}. This code expires in 10 minutes.`
    });

    if (!delivery.delivered && process.env.NODE_ENV === "production") {
      user.resetPasswordCodeHash = null;
      user.resetPasswordExpiresAt = null;
      await user.save();

      return res.status(503).json({
        message: "Password recovery email is not configured on the server yet."
      });
    }

    return res.json({
      ...genericResponse,
      devResetCode: process.env.NODE_ENV === "production" ? undefined : resetCode
    });
  } catch (error) {
    if (error.isPublic) {
      return res.status(error.statusCode || 500).json({ message: error.message });
    }

    return res.status(500).json({ message: "Unable to start password recovery right now." });
  }
});

router.post("/reset-password", authLimiter, async (req, res) => {
  try {
    const email = req.body.email?.trim().toLowerCase() || "";
    const resetCode = req.body.resetCode?.trim() || "";
    const newPassword = req.body.newPassword?.trim() || "";

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ message: "Please enter a valid email address." });
    }

    if (!resetCode) {
      return res.status(400).json({ message: "Reset code is required." });
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return res.status(400).json({ message: passwordError });
    }

    const user = await User.findOne({ email }).select(
      "+password +resetPasswordCodeHash +resetPasswordExpiresAt"
    );

    if (
      !user ||
      !user.resetPasswordCodeHash ||
      !user.resetPasswordExpiresAt ||
      user.resetPasswordExpiresAt.getTime() < Date.now() ||
      user.resetPasswordCodeHash !== hashResetCode(resetCode)
    ) {
      return res.status(400).json({ message: "Invalid or expired reset code." });
    }

    user.password = newPassword;
    user.resetPasswordCodeHash = null;
    user.resetPasswordExpiresAt = null;
    user.twoFactorCodeHash = null;
    user.twoFactorExpiresAt = null;
    user.activeSessions = [];
    user.sessionVersion += 1;
    await user.save();

    req.app.get("io").to(user._id.toString()).emit("session:expired", {
      message: "Your password was changed. Please log in again."
    });
    setTimeout(() => {
      req.app.get("io").in(user._id.toString()).disconnectSockets(true);
    }, 100);

    await writeAuditLog({
      actor: user._id,
      action: "auth.password_reset.complete",
      targetId: user._id.toString(),
      targetType: "User",
      metadata: { email, ...getRequestContext(req) }
    });

    return res.json({ message: "Password updated. You can log in with your new password." });
  } catch (error) {
    return res.status(500).json({ message: "Unable to reset password right now." });
  }
});

router.get("/me", authMiddleware, async (req, res) => {
  return res.json({ user: serializeUser(req.user) });
});

router.post("/logout", authMiddleware, async (req, res) => {
  try {
    req.user.revokeSession(req.sessionId);
    await req.user.save();

    await writeAuditLog({
      actor: req.user._id,
      action: "auth.logout",
      targetId: req.user._id.toString(),
      targetType: "User",
      metadata: { sessionId: req.sessionId, ...getRequestContext(req) }
    });

    return res.json({ message: "Logged out from this device." });
  } catch (error) {
    return res.status(500).json({ message: "Unable to log out right now." });
  }
});

router.post("/2fa/request-setup", authMiddleware, async (req, res) => {
  try {
    const { code } = await issueTwoFactorChallenge(req.user, {
      subject: "Your WITCH two-step verification setup code",
      failureMessage: "Two-step verification email is not configured on the server yet."
    });

    await writeAuditLog({
      actor: req.user._id,
      action: "auth.2fa.setup_request",
      targetId: req.user._id.toString(),
      targetType: "User",
      metadata: getRequestContext(req)
    });

    return res.json({
      message: "A security code was generated to enable two-step verification.",
      devTwoFactorCode: process.env.NODE_ENV === "production" ? undefined : code
    });
  } catch (error) {
    if (error.isPublic) {
      return res.status(error.statusCode || 500).json({ message: error.message });
    }

    return res.status(500).json({ message: "Unable to start two-step verification setup." });
  }
});

router.post("/2fa/enable", authMiddleware, async (req, res) => {
  try {
    const code = req.body.code?.trim() || "";

    if (!code) {
      return res.status(400).json({ message: "Security code is required." });
    }

    const user = await User.findById(req.userId).select("+twoFactorCodeHash +twoFactorExpiresAt");

    if (
      !user ||
      !user.twoFactorCodeHash ||
      !user.twoFactorExpiresAt ||
      user.twoFactorExpiresAt.getTime() < Date.now() ||
      user.twoFactorCodeHash !== hashResetCode(code)
    ) {
      return res.status(400).json({ message: "Invalid or expired security code." });
    }

    user.twoFactorEnabled = true;
    user.twoFactorCodeHash = null;
    user.twoFactorExpiresAt = null;
    await user.save();

    await writeAuditLog({
      actor: user._id,
      action: "auth.2fa.enabled",
      targetId: user._id.toString(),
      targetType: "User",
      metadata: getRequestContext(req)
    });

    return res.json({
      message: "Two-step verification is now enabled.",
      user: serializeUser(user)
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to enable two-step verification." });
  }
});

router.post("/2fa/disable", authMiddleware, async (req, res) => {
  try {
    req.user.twoFactorEnabled = false;
    req.user.twoFactorCodeHash = null;
    req.user.twoFactorExpiresAt = null;
    await req.user.save();

    await writeAuditLog({
      actor: req.user._id,
      action: "auth.2fa.disabled",
      targetId: req.user._id.toString(),
      targetType: "User",
      metadata: getRequestContext(req)
    });

    return res.json({
      message: "Two-step verification is now disabled.",
      user: serializeUser(req.user)
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to disable two-step verification." });
  }
});

router.post("/logout-all", authMiddleware, async (req, res) => {
  try {
    req.user.activeSessions = [];
    req.user.sessionVersion += 1;
    req.user.touchPresence("offline");
    await req.user.save();

    const io = req.app.get("io");

    io.to(req.userId).emit("session:expired", {
      message: "You were logged out from all sessions."
    });
    setTimeout(() => {
      io.in(req.userId).disconnectSockets(true);
    }, 100);

    await writeAuditLog({
      actor: req.user._id,
      action: "auth.logout_all",
      targetId: req.user._id.toString(),
      targetType: "User",
      metadata: getRequestContext(req)
    });

    return res.json({ message: "Logged out from all sessions." });
  } catch (error) {
    return res.status(500).json({ message: "Unable to log out from all sessions." });
  }
});

export default router;
