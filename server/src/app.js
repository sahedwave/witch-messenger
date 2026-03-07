import cors from "cors";
import express from "express";
import helmet from "helmet";
import http from "http";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";

import { User } from "./models/User.js";
import adminRoutes from "./routes/adminRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import messageRoutes from "./routes/messageRoutes.js";
import userRoutes from "./routes/userRoutes.js";

export function createServerEnvironment({ clientUrls, jwtSecret }) {
  const allowedOrigins = clientUrls;
  const app = express();
  const server = http.createServer(app);
  const presenceStore = new Map();
  const presenceSockets = new Map();

  const corsOrigin = (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
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

  io.on("connection", async (socket) => {
    socket.join(socket.userId);

    const entry = ensurePresenceEntry(socket.userId);
    const sockets = ensureSocketSet(socket.userId);

    sockets.add(socket.id);
    entry.deviceCount += 1;
    socket.user.touchPresence("online");
    await socket.user.save();
    await updateUserPresence(socket.userId);

    socket.emit(
      "presence:snapshot",
      Array.from(presenceStore.entries()).map(([userId, value]) => ({
        userId,
        status: value.status,
        deviceCount: value.deviceCount,
        lastActiveAt: value.lastActiveAt
      }))
    );

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
  });

  app.set("io", io);
  app.set("presenceStore", presenceStore);
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
  app.use(express.json({ limit: "3mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/messages", messageRoutes);

  app.use((err, _req, res, _next) => {
    const errorId = Math.random().toString(36).slice(2, 10);
    console.error(`[${errorId}]`, err);
    res.status(500).json({ message: "Something went wrong.", errorId });
  });

  return { app, server, io, presenceStore };
}
