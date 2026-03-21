import cors from "cors";
import express from "express";
import helmet from "helmet";
import http from "http";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";

import { User } from "./models/User.js";
import adminRoutes from "./routes/adminRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import bankRoutes from "./routes/bankRoutes.js";
import financeRoutes from "./routes/financeRoutes.js";
import memoryCapsuleRoutes from "./routes/memoryCapsuleRoutes.js";
import messageRoutes from "./routes/messageRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import payrollRoutes from "./routes/payrollRoutes.js";
import platformRoutes from "./routes/platformRoutes.js";
import plaidWebhookRoutes from "./routes/plaidWebhookRoutes.js";
import pdfReviewRoutes from "./routes/pdfReviewRoutes.js";
import projectRoutes from "./routes/projectRoutes.js";
import purchaseOrderRoutes from "./routes/purchaseOrderRoutes.js";
import quranRoutes from "./routes/quranRoutes.js";
import taskRoutes from "./routes/taskRoutes.js";
import warehouseRoutes from "./routes/warehouseRoutes.js";
import workspaceRoutes from "./routes/workspaceRoutes.js";
import { startMemoryCapsuleReminderLoop } from "./utils/memoryCapsuleReminders.js";
import { getPdfReviewStorageRoot } from "./utils/pdfReviewStorage.js";
import userRoutes from "./routes/userRoutes.js";

export function createServerEnvironment({ clientUrls, jwtSecret }) {
  const allowedOrigins = clientUrls.filter(Boolean);
  const app = express();
  const server = http.createServer(app);
  const presenceStore = new Map();
  const presenceSockets = new Map();
  const bondStore = new Map();
  const bondTimers = new Map();

  function isAllowedOrigin(origin) {
    if (!origin) {
      return true;
    }

    if (allowedOrigins.includes(origin)) {
      return true;
    }

    let incomingUrl;

    try {
      incomingUrl = new URL(origin);
    } catch {
      return false;
    }

    return allowedOrigins.some((allowedOrigin) => {
      let allowedUrl;

      try {
        allowedUrl = new URL(allowedOrigin);
      } catch {
        return false;
      }

      if (allowedUrl.protocol !== incomingUrl.protocol) {
        return false;
      }

      if (!allowedUrl.hostname.endsWith(".vercel.app")) {
        return false;
      }

      const allowedProjectHost = allowedUrl.hostname.replace(/\.vercel\.app$/, "");
      return (
        incomingUrl.hostname.endsWith(".vercel.app") &&
        incomingUrl.hostname.startsWith(`${allowedProjectHost}-`)
      );
    });
  }

  const corsOrigin = (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Not allowed by CORS"));
  };

  const io = new Server(server, {
    cors: {
      origin: corsOrigin,
      methods: ["GET", "POST", "PATCH", "DELETE"]
    }
  });

  function ensurePresenceEntry(userId) {
    const key = userId.toString();

    if (!presenceStore.has(key)) {
      presenceStore.set(key, {
        deviceCount: 0,
        awayCount: 0,
        status: "offline",
        lastActiveAt: null
      });
    }

    return presenceStore.get(key);
  }

  function ensureSocketSet(userId) {
    const key = userId.toString();

    if (!presenceSockets.has(key)) {
      presenceSockets.set(key, new Set());
    }

    return presenceSockets.get(key);
  }

  function buildBondKey(firstUserId, secondUserId) {
    return [firstUserId.toString(), secondUserId.toString()].sort().join("::");
  }

  function ensureBondTimerEntry(key) {
    if (!bondTimers.has(key)) {
      bondTimers.set(key, {
        coupleRequest: null,
        coupleCooldown: null,
        trustRequest: null
      });
    }

    return bondTimers.get(key);
  }

  function clearBondTimer(key, timerName) {
    const timerEntry = ensureBondTimerEntry(key);

    if (timerEntry[timerName]) {
      clearTimeout(timerEntry[timerName]);
      timerEntry[timerName] = null;
    }
  }

  function ensureBondSession(firstUserId, secondUserId) {
    const participants = [firstUserId.toString(), secondUserId.toString()].sort();
    const key = buildBondKey(firstUserId, secondUserId);

    if (!bondStore.has(key)) {
      bondStore.set(key, {
        key,
        participants,
        coupleRequestedBy: null,
        coupleRequestExpiresAt: null,
        coupleCooldownUntil: null,
        coupleActive: false,
        trustPromptVisible: false,
        trustRequestedBy: null,
        trustRequestExpiresAt: null,
        trustActive: false,
        trustIgnoredBy: null,
        begEligibleUserId: null
      });
    }

    return bondStore.get(key);
  }

  function getBondContactId(session, viewerId) {
    return session.participants.find((participantId) => participantId !== viewerId) || null;
  }

  function serializeBondState(session) {
    return {
      coupleRequestedBy: session.coupleRequestedBy,
      coupleRequestExpiresAt: session.coupleRequestExpiresAt,
      coupleCooldownUntil: session.coupleCooldownUntil,
      coupleActive: session.coupleActive,
      trustPromptVisible: session.trustPromptVisible,
      trustRequestedBy: session.trustRequestedBy,
      trustRequestExpiresAt: session.trustRequestExpiresAt,
      trustActive: session.trustActive,
      trustIgnoredBy: session.trustIgnoredBy,
      begEligibleUserId: session.begEligibleUserId
    };
  }

  function emitBondState(session) {
    session.participants.forEach((participantId) => {
      io.to(participantId).emit("bond:state", {
        contactId: getBondContactId(session, participantId),
        state: serializeBondState(session)
      });
    });
  }

  function resetTrustState(session, { keepPromptVisible = false } = {}) {
    clearBondTimer(session.key, "trustRequest");
    session.trustPromptVisible = keepPromptVisible;
    session.trustRequestedBy = null;
    session.trustRequestExpiresAt = null;
    session.trustActive = false;
    session.trustIgnoredBy = null;
    session.begEligibleUserId = null;
  }

  function resetBondSession(session) {
    clearBondTimer(session.key, "coupleRequest");
    clearBondTimer(session.key, "coupleCooldown");
    resetTrustState(session);
    session.coupleRequestedBy = null;
    session.coupleRequestExpiresAt = null;
    session.coupleCooldownUntil = null;
    session.coupleActive = false;
  }

  function scheduleBondCooldown(session) {
    clearBondTimer(session.key, "coupleCooldown");

    if (!session.coupleCooldownUntil) {
      return;
    }

    const remainingMs = new Date(session.coupleCooldownUntil).getTime() - Date.now();

    if (remainingMs <= 0) {
      session.coupleCooldownUntil = null;
      emitBondState(session);
      return;
    }

    ensureBondTimerEntry(session.key).coupleCooldown = setTimeout(() => {
      session.coupleCooldownUntil = null;
      emitBondState(session);
    }, remainingMs);
  }

  function scheduleBondRequestExpiry(session) {
    clearBondTimer(session.key, "coupleRequest");

    if (!session.coupleRequestExpiresAt) {
      return;
    }

    const remainingMs = new Date(session.coupleRequestExpiresAt).getTime() - Date.now();

    if (remainingMs <= 0) {
      session.coupleRequestedBy = null;
      session.coupleRequestExpiresAt = null;
      session.coupleActive = false;
      resetTrustState(session);
      session.coupleCooldownUntil = new Date(Date.now() + 20_000).toISOString();
      scheduleBondCooldown(session);
      emitBondState(session);
      return;
    }

    ensureBondTimerEntry(session.key).coupleRequest = setTimeout(() => {
      session.coupleRequestedBy = null;
      session.coupleRequestExpiresAt = null;
      session.coupleActive = false;
      resetTrustState(session);
      session.coupleCooldownUntil = new Date(Date.now() + 20_000).toISOString();
      scheduleBondCooldown(session);
      emitBondState(session);
    }, remainingMs);
  }

  function scheduleTrustRequestExpiry(session) {
    clearBondTimer(session.key, "trustRequest");

    if (!session.trustRequestExpiresAt) {
      return;
    }

    const remainingMs = new Date(session.trustRequestExpiresAt).getTime() - Date.now();

    if (remainingMs <= 0) {
      session.trustRequestedBy = null;
      session.trustRequestExpiresAt = null;
      session.trustPromptVisible = true;
      emitBondState(session);
      return;
    }

    ensureBondTimerEntry(session.key).trustRequest = setTimeout(() => {
      session.trustRequestedBy = null;
      session.trustRequestExpiresAt = null;
      session.trustPromptVisible = true;
      emitBondState(session);
    }, remainingMs);
  }

  function normalizePresence(entry) {
    if (entry.deviceCount <= 0) {
      return "offline";
    }

    if (entry.awayCount >= entry.deviceCount) {
      return "away";
    }

    return "online";
  }

  async function broadcastPresence(userId) {
    const user = await User.findById(userId);

    if (!user) {
      return;
    }

    const entry = ensurePresenceEntry(userId);

    io.emit("presence:update", {
      userId: userId.toString(),
      status: entry.status,
      deviceCount: entry.deviceCount,
      lastActiveAt: entry.lastActiveAt || user.lastActiveAt || null
    });
  }

  async function updateUserPresence(userId) {
    const entry = ensurePresenceEntry(userId);
    entry.status = normalizePresence(entry);

    const user = await User.findById(userId);

    if (!user) {
      return;
    }

    user.presenceStatus = entry.status;
    user.lastActiveAt = new Date();
    entry.lastActiveAt = user.lastActiveAt;
    await user.save();

    await broadcastPresence(userId);
  }

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("Authentication required."));
    }

    try {
      const decoded = jwt.verify(token, jwtSecret);
      const user = await User.findById(decoded.userId);

      if (
        !user ||
        !decoded.sessionId ||
        !user.findActiveSession(decoded.sessionId) ||
        (decoded.sessionVersion || 0) !== (user.sessionVersion || 0)
      ) {
        return next(new Error("Session expired."));
      }

      socket.userId = decoded.userId.toString();
      socket.user = user;
      socket.sessionId = decoded.sessionId;
      socket.presenceStatus = "online";
      return next();
    } catch (error) {
      return next(new Error("Invalid token."));
    }
  });

  io.on("connection", (socket) => {
    socket.join(socket.userId);

    const entry = ensurePresenceEntry(socket.userId);
    const sockets = ensureSocketSet(socket.userId);

    sockets.add(socket.id);
    entry.deviceCount += 1;

    socket.on("disconnect", async () => {
      const currentSockets = ensureSocketSet(socket.userId);
      currentSockets.delete(socket.id);

      const nextEntry = ensurePresenceEntry(socket.userId);
      nextEntry.deviceCount = Math.max(0, nextEntry.deviceCount - 1);
      if (socket.presenceStatus === "away") {
        nextEntry.awayCount = Math.max(0, nextEntry.awayCount - 1);
      }

      await updateUserPresence(socket.userId);
    });

    socket.on("typing:start", ({ toUserId }) => {
      if (!toUserId || toUserId === socket.userId) {
        return;
      }

      io.to(toUserId).emit("typing:start", {
        fromUserId: socket.userId
      });
    });

    socket.on("typing:stop", ({ toUserId }) => {
      if (!toUserId || toUserId === socket.userId) {
        return;
      }

      io.to(toUserId).emit("typing:stop", {
        fromUserId: socket.userId
      });
    });

    socket.on("presence:update", async ({ status }) => {
      if (!["online", "away"].includes(status)) {
        return;
      }

      const currentEntry = ensurePresenceEntry(socket.userId);

      if (socket.presenceStatus === "away" && status !== "away") {
        currentEntry.awayCount = Math.max(0, currentEntry.awayCount - 1);
      }

      if (socket.presenceStatus !== "away" && status === "away") {
        currentEntry.awayCount += 1;
      }

      socket.presenceStatus = status;
      await updateUserPresence(socket.userId);
    });

    socket.on("bond:sync-request", ({ contactId }) => {
      if (!contactId || contactId === socket.userId) {
        return;
      }

      const session = ensureBondSession(socket.userId, contactId);
      io.to(socket.userId).emit("bond:state", {
        contactId,
        state: serializeBondState(session)
      });
    });

    socket.on("bond:couple-toggle", ({ contactId }) => {
      if (!contactId || contactId === socket.userId) {
        return;
      }

      const session = ensureBondSession(socket.userId, contactId);
      const cooldownMs = session.coupleCooldownUntil
        ? new Date(session.coupleCooldownUntil).getTime() - Date.now()
        : 0;

      if (cooldownMs > 0) {
        emitBondState(session);
        return;
      }

      if (session.coupleActive) {
        resetBondSession(session);
        emitBondState(session);
        return;
      }

      if (session.coupleRequestedBy) {
        if (session.coupleRequestedBy === socket.userId) {
          resetBondSession(session);
          emitBondState(session);
          return;
        }

        clearBondTimer(session.key, "coupleRequest");
        session.coupleRequestedBy = null;
        session.coupleRequestExpiresAt = null;
        session.coupleCooldownUntil = null;
        session.coupleActive = true;
        session.trustPromptVisible = true;
        session.trustRequestedBy = null;
        session.trustRequestExpiresAt = null;
        session.trustActive = false;
        session.trustIgnoredBy = null;
        session.begEligibleUserId = null;
        emitBondState(session);
        return;
      }

      session.coupleRequestedBy = socket.userId;
      session.coupleRequestExpiresAt = new Date(Date.now() + 5_000).toISOString();
      session.coupleActive = false;
      session.coupleCooldownUntil = null;
      resetTrustState(session);
      scheduleBondRequestExpiry(session);
      emitBondState(session);
    });

    socket.on("bond:trust-enable", ({ contactId }) => {
      if (!contactId || contactId === socket.userId) {
        return;
      }

      const session = ensureBondSession(socket.userId, contactId);

      if (!session.coupleActive || session.coupleCooldownUntil) {
        emitBondState(session);
        return;
      }

      session.trustPromptVisible = true;
      session.trustIgnoredBy = null;
      session.begEligibleUserId = null;

      if (!session.trustRequestedBy) {
        session.trustRequestedBy = socket.userId;
        session.trustRequestExpiresAt = new Date(Date.now() + 60_000).toISOString();
        scheduleTrustRequestExpiry(session);
        emitBondState(session);
        return;
      }

      if (session.trustRequestedBy !== socket.userId) {
        clearBondTimer(session.key, "trustRequest");
        session.trustRequestedBy = null;
        session.trustRequestExpiresAt = null;
        session.trustActive = true;
        session.trustPromptVisible = false;
        emitBondState(session);
        return;
      }

      emitBondState(session);
    });

    socket.on("bond:trust-ignore", ({ contactId }) => {
      if (!contactId || contactId === socket.userId) {
        return;
      }

      const session = ensureBondSession(socket.userId, contactId);

      if (!session.coupleActive || session.trustActive) {
        emitBondState(session);
        return;
      }

      clearBondTimer(session.key, "trustRequest");

      if (!session.trustIgnoredBy) {
        session.trustIgnoredBy = socket.userId;
        session.begEligibleUserId = socket.userId;
      }

      session.trustRequestedBy = null;
      session.trustRequestExpiresAt = null;
      session.trustPromptVisible = false;
      emitBondState(session);
    });

    socket.on("bond:trust-beg", ({ contactId }) => {
      if (!contactId || contactId === socket.userId) {
        return;
      }

      const session = ensureBondSession(socket.userId, contactId);

      if (
        !session.coupleActive ||
        session.trustActive ||
        session.begEligibleUserId !== socket.userId
      ) {
        emitBondState(session);
        return;
      }

      session.trustPromptVisible = true;
      session.trustRequestedBy = null;
      session.trustRequestExpiresAt = null;
      session.trustIgnoredBy = null;
      session.begEligibleUserId = null;
      emitBondState(session);
    });

    socket.emit(
      "presence:snapshot",
      Array.from(presenceStore.entries()).map(([userId, value]) => ({
        userId,
        status: value.status,
        deviceCount: value.deviceCount,
        lastActiveAt: value.lastActiveAt
      }))
    );

    void (async () => {
      try {
        socket.user.touchPresence("online");
        await socket.user.save();
        await updateUserPresence(socket.userId);
      } catch (error) {
        console.error("Failed to initialize socket presence", error);
      }
    })();
  });

  app.set("io", io);
  app.set("presenceStore", presenceStore);
  app.set("bondStore", bondStore);
  app.use(
    helmet({
      crossOriginResourcePolicy: false
    })
  );
  app.use(
    cors({
      origin: corsOrigin,
      credentials: true
    })
  );
  app.use(express.json({ limit: "150mb" }));
  app.use(
    "/review-assets",
    express.static(getPdfReviewStorageRoot(), {
      fallthrough: true,
      index: false,
      setHeaders(res) {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Cache-Control", "private, max-age=60");
      }
    })
  );

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/platform", platformRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/workspaces", workspaceRoutes);
  app.use("/api/tasks", taskRoutes);
  app.use("/api/projects", projectRoutes);
  app.use("/api/messages", messageRoutes);
  app.use("/api/notifications", notificationRoutes);
  app.use("/api/finance", financeRoutes);
  app.use("/api/finance", bankRoutes);
  app.use("/api/finance/payroll", payrollRoutes);
  app.use("/api/warehouse", warehouseRoutes);
  app.use("/api/purchase-orders", purchaseOrderRoutes);
  app.use("/webhooks", plaidWebhookRoutes);
  app.use("/api/memory-capsules", memoryCapsuleRoutes);
  app.use("/api/pdf-reviews", pdfReviewRoutes);
  app.use("/api/quran", quranRoutes);

  app.use((err, _req, res, _next) => {
    const errorId = Math.random().toString(36).slice(2, 10);
    console.error(`[${errorId}]`, err);
    res.status(500).json({ message: "Something went wrong.", errorId });
  });

  return {
    app,
    server,
    io,
    presenceStore,
    startBackgroundJobs() {
      return startMemoryCapsuleReminderLoop(io);
    }
  };
}
