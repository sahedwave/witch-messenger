import express from "express";
import mongoose from "mongoose";

import { authMiddleware } from "../middleware/auth.js";
import { WorkspaceNotification } from "../models/WorkspaceNotification.js";
import {
  buildWorkspaceFilter,
  workspaceContextMiddleware,
  workspaceMembershipMiddleware
} from "../utils/workspaceContext.js";
import { serializeWorkspaceNotification } from "../utils/workspaceNotifications.js";

const router = express.Router();

router.use(authMiddleware);
router.use(workspaceContextMiddleware({ allowDefault: false, allowSingleMembershipFallback: true }));
router.use(workspaceMembershipMiddleware({ allowLegacyFallback: true }));

function buildScopedWorkspaceFilter(req, baseFilter = {}) {
  return buildWorkspaceFilter(req.workspace, baseFilter, {
    includeLegacy: Boolean(req.workspaceMembership?.isLegacyFallback)
  });
}

function requireNotificationViewer(req, res, next) {
  if (req.workspaceMembership && req.workspaceMembership.status !== "suspended") {
    return next();
  }

  return res.status(403).json({ message: "Workspace notification access is required." });
}

router.get("/count", requireNotificationViewer, async (req, res) => {
  try {
    const unread = await WorkspaceNotification.countDocuments(
      buildScopedWorkspaceFilter(req, {
        recipientId: req.user._id,
        read: false
      })
    );

    return res.json({ unread });
  } catch (_error) {
    return res.status(500).json({ message: "Unable to load workspace notification count." });
  }
});

router.get("/", requireNotificationViewer, async (req, res) => {
  try {
    const notifications = await WorkspaceNotification.find(
      buildScopedWorkspaceFilter(req, {
        recipientId: req.user._id,
        read: false
      })
    )
      .sort({ createdAt: -1 })
      .limit(50);

    return res.json({
      notifications: notifications.map(serializeWorkspaceNotification)
    });
  } catch (_error) {
    return res.status(500).json({ message: "Unable to load workspace notifications." });
  }
});

router.patch("/read-all", requireNotificationViewer, async (req, res) => {
  try {
    const result = await WorkspaceNotification.updateMany(
      buildScopedWorkspaceFilter(req, {
        recipientId: req.user._id,
        read: false
      }),
      {
        $set: {
          read: true,
          readAt: new Date()
        }
      }
    );

    return res.json({
      success: true,
      updated: result.modifiedCount || 0
    });
  } catch (_error) {
    return res.status(500).json({ message: "Unable to mark workspace notifications as read." });
  }
});

router.patch("/:id/read", requireNotificationViewer, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid workspace notification id." });
    }

    const notification = await WorkspaceNotification.findOneAndUpdate(
      buildScopedWorkspaceFilter(req, {
        _id: req.params.id,
        recipientId: req.user._id
      }),
      {
        $set: {
          read: true,
          readAt: new Date()
        }
      },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ message: "Workspace notification not found." });
    }

    return res.json(serializeWorkspaceNotification(notification));
  } catch (_error) {
    return res.status(500).json({ message: "Unable to update the workspace notification." });
  }
});

export default router;
