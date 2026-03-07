import express from "express";

import { authMiddleware } from "../middleware/auth.js";
import { Conversation } from "../models/Conversation.js";
import { Message } from "../models/Message.js";
import { User } from "../models/User.js";

const router = express.Router();

router.use(authMiddleware);

router.use((req, res, next) => {
  if (!req.user.isAdmin) {
    return res.status(403).json({ message: "Admin access required." });
  }

  return next();
});

router.get("/analytics", async (_req, res) => {
  try {
    const [users, conversations, messages, todayMessages] = await Promise.all([
      User.countDocuments(),
      Conversation.countDocuments(),
      Message.countDocuments({ deletedAt: null }),
      Message.countDocuments({
        deletedAt: null,
        createdAt: {
          $gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
        }
      })
    ]);

    return res.json({
      users,
      conversations,
      messages,
      todayMessages
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load analytics." });
  }
});

export default router;
