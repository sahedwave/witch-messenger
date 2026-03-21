import express from "express";
import mongoose from "mongoose";

import { authMiddleware } from "../middleware/auth.js";
import { WorkspaceConversation } from "../models/WorkspaceConversation.js";
import { WorkspaceMembership } from "../models/WorkspaceMembership.js";
import { WorkspaceTask } from "../models/WorkspaceTask.js";
import { writeAuditLog } from "../utils/audit.js";
import {
  createTaskAssignmentNotifications,
  ensureTaskScheduleNotifications
} from "../utils/workspaceNotifications.js";
import {
  buildWorkspaceFilter,
  serializeWorkspace,
  serializeWorkspaceMembership,
  workspaceContextMiddleware,
  workspaceMembershipMiddleware
} from "../utils/workspaceContext.js";

const router = express.Router();

const TASK_STATUS_OPTIONS = new Set(["todo", "doing", "done", "later", "completed"]);
const TASK_PRIORITY_OPTIONS = new Set(["low", "medium", "high", "urgent", "Low", "Medium", "High"]);
const TASK_MODE_OPTIONS = new Set(["professional", "student"]);

router.use(authMiddleware);
router.use(workspaceContextMiddleware({ allowDefault: false, allowSingleMembershipFallback: true }));
router.use(workspaceMembershipMiddleware({ allowLegacyFallback: true }));

function buildScopedWorkspaceFilter(req, baseFilter = {}) {
  return buildWorkspaceFilter(req.workspace, baseFilter, {
    includeLegacy: Boolean(req.workspaceMembership?.isLegacyFallback)
  });
}

function requireTaskViewer(req, res, next) {
  if (req.workspaceMembership && req.workspaceMembership.status !== "suspended") {
    return next();
  }

  return res.status(403).json({ message: "Workspace task access is required." });
}

function serializeTaskActor(user, fallbackName = "Workspace member") {
  if (!user?._id) {
    return {
      id: null,
      name: fallbackName,
      email: ""
    };
  }

  return {
    id: user._id.toString(),
    name: user.name || fallbackName,
    email: user.email || ""
  };
}

function normalizeTaskPriority(priority) {
  const normalized = String(priority || "").trim().toLowerCase();
  return TASK_PRIORITY_OPTIONS.has(priority) || TASK_PRIORITY_OPTIONS.has(normalized)
    ? normalized || "medium"
    : "medium";
}

function normalizeTaskStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "completed") {
    return "done";
  }
  return TASK_STATUS_OPTIONS.has(normalized) ? normalized : "todo";
}

function serializeTaskAssignee(user, fallbackName = "Workspace member") {
  if (!user) {
    return null;
  }

  return {
    id: user._id?.toString?.() || user.id?.toString?.() || user.toString?.() || null,
    name: user.name || fallbackName,
    email: user.email || ""
  };
}

function serializeTask(task) {
  const assignedUsers = Array.isArray(task.assignedTo) ? task.assignedTo : [];
  const legacyAssignee =
    task.assigneeUserId && !assignedUsers.length
      ? [task.assigneeUserId]
      : [];
  const assignedTo = [...assignedUsers, ...legacyAssignee]
    .map((user, index) => serializeTaskAssignee(user, task.assigneeNames?.[index] || task.assigneeName || "Workspace member"))
    .filter((entry) => entry?.id);
  const primaryAssignee = assignedTo[0] || null;

  return {
    id: task._id.toString(),
    workspaceId: task.workspaceId?.toString?.() || null,
    title: task.title,
    note: task.note || "",
    status: normalizeTaskStatus(task.status || "todo"),
    priority: normalizeTaskPriority(task.priority || "medium"),
    dueDate: task.dueDate || null,
    completedAt: task.completedAt || null,
    mode: task.mode || "professional",
    assignedTo,
    assigneeUserId: primaryAssignee?.id || task.assigneeUserId?._id?.toString?.() || task.assigneeUserId?.toString?.() || null,
    assigneeName: primaryAssignee?.name || task.assigneeName || task.assigneeUserId?.name || "",
    projectId: task.projectId || null,
    sourceLink:
      task.sourceConversationId || task.sourceThreadId || task.sourceMessageId
        ? {
            conversationId: task.sourceConversationId?._id?.toString?.() || task.sourceConversationId?.toString?.() || null,
            threadId: task.sourceThreadId || null,
            messageId: task.sourceMessageId || null,
            threadName: task.sourceThreadName || "",
            messageExcerpt: task.sourceMessageExcerpt || ""
          }
        : null,
    createdBy: serializeTaskActor(task.createdByUserId, primaryAssignee?.name || task.assigneeName || "Workspace member"),
    updatedBy: serializeTaskActor(task.updatedByUserId, primaryAssignee?.name || task.assigneeName || "Workspace member"),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}

function serializeAssignableMember(membership) {
  return {
    id: membership.userId?._id?.toString?.() || "",
    name: membership.userId?.name || membership.email || "Workspace member",
    email: membership.userId?.email || membership.email || "",
    workspaceRole: membership.workspaceRole || "member"
  };
}

function parseOptionalDueDate(value) {
  if (value === undefined) {
    return { provided: false, value: undefined };
  }

  if (value === null || value === "") {
    return { provided: true, value: null };
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { error: "Due date must be a valid date." };
  }

  return { provided: true, value: date };
}

async function resolveAssignableMembers(req, assignedTo, legacyAssigneeUserId = undefined) {
  const source =
    assignedTo !== undefined
      ? assignedTo
      : legacyAssigneeUserId !== undefined
        ? legacyAssigneeUserId
        : undefined;

  if (source === undefined) {
    return { provided: false, memberships: [] };
  }

  const requestedIds = Array.isArray(source)
    ? source
    : source == null || source === ""
      ? []
      : [source];

  if (!requestedIds.length) {
    return { provided: true, memberships: [] };
  }

  const normalizedIds = [...new Set(requestedIds.map((entry) => String(entry || "").trim()).filter(Boolean))];

  if (!normalizedIds.every((entry) => mongoose.isValidObjectId(entry))) {
    return { error: "Assigned users must be active workspace members." };
  }

  const memberships = await WorkspaceMembership.find({
    workspaceId: req.workspaceId,
    userId: { $in: normalizedIds },
    status: { $ne: "suspended" }
  }).populate("userId", "name email");

  const membershipsById = new Map(
    memberships
      .filter((membership) => membership?.userId?._id)
      .map((membership) => [membership.userId._id.toString(), membership])
  );

  if (membershipsById.size !== normalizedIds.length) {
    return { error: "Assigned users must be active workspace members." };
  }

  return {
    provided: true,
    memberships: normalizedIds.map((entry) => membershipsById.get(entry)).filter(Boolean)
  };
}

function buildTaskPatch(body = {}) {
  const patch = {};

  if (body.title !== undefined) {
    const title = String(body.title || "").trim();
    if (!title) {
      return { error: "Task title is required." };
    }
    patch.title = title;
  }

  if (body.note !== undefined) {
    patch.note = String(body.note || "").trim();
  }

  if (body.status !== undefined) {
    const status = normalizeTaskStatus(body.status || "");
    if (!TASK_STATUS_OPTIONS.has(String(body.status || "").trim()) && String(body.status || "").trim().toLowerCase() !== "completed") {
      return { error: "Invalid task status." };
    }
    patch.status = status;
  }

  if (body.priority !== undefined) {
    const rawPriority = String(body.priority || "").trim();
    if (!TASK_PRIORITY_OPTIONS.has(rawPriority) && !TASK_PRIORITY_OPTIONS.has(rawPriority.toLowerCase())) {
      return { error: "Invalid task priority." };
    }
    patch.priority = normalizeTaskPriority(rawPriority);
  }

  if (body.mode !== undefined) {
    const mode = String(body.mode || "").trim();
    if (!TASK_MODE_OPTIONS.has(mode)) {
      return { error: "Invalid task mode." };
    }
    patch.mode = mode;
  }

  if (body.projectId !== undefined) {
    patch.projectId = body.projectId == null || body.projectId === "" ? null : String(body.projectId).trim();
  }

  return { patch };
}

function parseSourceLink(body = {}) {
  const hasSource =
    body.sourceConversationId !== undefined ||
    body.sourceThreadId !== undefined ||
    body.sourceMessageId !== undefined ||
    body.sourceThreadName !== undefined ||
    body.sourceMessageExcerpt !== undefined;

  if (!hasSource) {
    return { provided: false, value: null };
  }

  const conversationId =
    body.sourceConversationId == null || body.sourceConversationId === ""
      ? null
      : String(body.sourceConversationId).trim();

  if (conversationId && !mongoose.isValidObjectId(conversationId)) {
    return { error: "Invalid source conversation id." };
  }

  return {
    provided: true,
    value: {
      sourceConversationId: conversationId,
      sourceThreadId: String(body.sourceThreadId || "").trim().slice(0, 180),
      sourceMessageId: String(body.sourceMessageId || "").trim().slice(0, 180),
      sourceThreadName: String(body.sourceThreadName || "").trim().slice(0, 180),
      sourceMessageExcerpt: String(body.sourceMessageExcerpt || "").trim().slice(0, 400)
    }
  };
}

async function resolveSourceConversation(req, sourceLink) {
  if (!sourceLink?.sourceConversationId) {
    return { conversation: null };
  }

  const conversation = await WorkspaceConversation.findOne({
    _id: sourceLink.sourceConversationId,
    workspaceId: req.workspaceId,
    archived: false,
    status: "active"
  });

  if (!conversation) {
    return { error: "Source conversation was not found in this workspace." };
  }

  if (
    conversation.kind === "direct" &&
    !(Array.isArray(conversation.participantUserIds) ? conversation.participantUserIds : []).some(
      (participantId) => participantId?.toString?.() === req.user._id.toString()
    )
  ) {
    return { error: "You cannot link work from this conversation." };
  }

  return { conversation };
}

async function appendConversationLinkedWorkMessage(conversation, req, task, sourceLink) {
  if (!conversation) {
    return;
  }

  conversation.messages.push({
    senderUserId: req.user._id,
    senderKey: "workspace-system",
    senderName: req.user.name || req.user.email || "Workspace member",
    type: "system",
    content: `Task "${task.title}" was created from this conversation.`,
    metadata: {
      linkedWork: {
        kind: "task",
        action: "created",
        id: task._id.toString(),
        title: task.title,
        status: normalizeTaskStatus(task.status || "todo"),
        sourceMessageId: sourceLink?.sourceMessageId || null,
        sourceThreadId: sourceLink?.sourceThreadId || null
      }
    },
    createdAt: new Date()
  });

  await conversation.save();
}

function sortTasksByDueDateAndPriority(tasks = []) {
  return [...tasks].sort((left, right) => {
    const leftDue = left.dueDate ? new Date(left.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
    const rightDue = right.dueDate ? new Date(right.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
    if (leftDue !== rightDue) {
      return leftDue - rightDue;
    }

    const priorityWeight = { urgent: 4, high: 3, medium: 2, low: 1 };
    const leftPriority = priorityWeight[normalizeTaskPriority(left.priority)] || 0;
    const rightPriority = priorityWeight[normalizeTaskPriority(right.priority)] || 0;
    if (leftPriority !== rightPriority) {
      return rightPriority - leftPriority;
    }

    return new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime();
  });
}

function taskIsCompleted(task) {
  return normalizeTaskStatus(task?.status) === "done";
}

function isSameUtcDate(left, right) {
  return (
    left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth() &&
    left.getUTCDate() === right.getUTCDate()
  );
}

router.get("/my-tasks", requireTaskViewer, async (req, res) => {
  try {
    const tasks = await WorkspaceTask.find(
      buildScopedWorkspaceFilter(req, {
        $or: [
          { assignedTo: req.user._id },
          { assigneeUserId: req.user._id }
        ]
      })
    )
      .populate("assignedTo", "name email")
      .populate("assigneeUserId", "name email")
      .populate("createdByUserId", "name email")
      .populate("updatedByUserId", "name email");

    await ensureTaskScheduleNotifications(tasks);
    return res.json({
      tasks: sortTasksByDueDateAndPriority(tasks).map(serializeTask)
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load assigned tasks." });
  }
});

router.get("/overdue", requireTaskViewer, async (req, res) => {
  try {
    const now = new Date();
    const tasks = await WorkspaceTask.find(
      buildScopedWorkspaceFilter(req, {
        dueDate: { $lt: now }
      })
    )
      .populate("assignedTo", "name email")
      .populate("assigneeUserId", "name email")
      .populate("createdByUserId", "name email")
      .populate("updatedByUserId", "name email");

    await ensureTaskScheduleNotifications(tasks);
    return res.json({
      tasks: sortTasksByDueDateAndPriority(tasks.filter((task) => !taskIsCompleted(task))).map(serializeTask)
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load overdue tasks." });
  }
});

router.get("/", requireTaskViewer, async (req, res) => {
  try {
    const requestedMode = String(req.query.mode || "all").trim();
    const modeFilter = TASK_MODE_OPTIONS.has(requestedMode) ? requestedMode : null;

    const [tasks, memberships] = await Promise.all([
      WorkspaceTask.find(
        buildScopedWorkspaceFilter(req, modeFilter ? { mode: modeFilter } : {})
      )
        .sort({ dueDate: 1, updatedAt: -1 })
        .populate("assignedTo", "name email")
        .populate("assigneeUserId", "name email")
        .populate("createdByUserId", "name email")
        .populate("updatedByUserId", "name email"),
      WorkspaceMembership.find({
        workspaceId: req.workspaceId,
        status: { $ne: "suspended" }
      })
        .sort({ createdAt: 1 })
        .populate("userId", "name email")
    ]);

    await ensureTaskScheduleNotifications(tasks);
    return res.json({
      workspace: serializeWorkspace(req.workspace),
      membership: serializeWorkspaceMembership(req.workspaceMembership),
      members: memberships.filter((membership) => membership.userId?._id).map(serializeAssignableMember),
      tasks: sortTasksByDueDateAndPriority(tasks).map(serializeTask)
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load workspace tasks." });
  }
});

router.post("/", requireTaskViewer, async (req, res) => {
  try {
    const { patch, error: patchError } = buildTaskPatch(req.body);
    if (patchError) {
      return res.status(400).json({ message: patchError });
    }

    if (!patch.title) {
      return res.status(400).json({ message: "Task title is required." });
    }

    const dueDateResult = parseOptionalDueDate(req.body.dueDate);
    if (dueDateResult.error) {
      return res.status(400).json({ message: dueDateResult.error });
    }

    const assignedResult = await resolveAssignableMembers(req, req.body.assignedTo, req.body.assigneeUserId);
    if (assignedResult.error) {
      return res.status(400).json({ message: assignedResult.error });
    }

    const sourceLinkResult = parseSourceLink(req.body);
    if (sourceLinkResult.error) {
      return res.status(400).json({ message: sourceLinkResult.error });
    }

    const sourceConversationResult = await resolveSourceConversation(req, sourceLinkResult.value);
    if (sourceConversationResult.error) {
      return res.status(400).json({ message: sourceConversationResult.error });
    }

    const primaryMembership = assignedResult.memberships[0] || null;
    const task = await WorkspaceTask.create({
      workspaceId: req.workspaceId,
      title: patch.title,
      note: patch.note || "",
      status: patch.status || "todo",
      priority: patch.priority || "medium",
      mode: patch.mode || "professional",
      dueDate: dueDateResult.provided ? dueDateResult.value : null,
      completedAt: normalizeTaskStatus(patch.status || "todo") === "done" ? new Date() : null,
      assignedTo: assignedResult.memberships.map((membership) => membership.userId._id),
      assigneeNames: assignedResult.memberships.map((membership) => membership.userId?.name || membership.email || "Workspace member"),
      assigneeUserId: primaryMembership?.userId?._id || null,
      assigneeName: primaryMembership?.userId?.name || "",
      projectId: patch.projectId || null,
      sourceConversationId: sourceLinkResult.value?.sourceConversationId || null,
      sourceThreadId: sourceLinkResult.value?.sourceThreadId || "",
      sourceMessageId: sourceLinkResult.value?.sourceMessageId || "",
      sourceThreadName: sourceLinkResult.value?.sourceThreadName || "",
      sourceMessageExcerpt: sourceLinkResult.value?.sourceMessageExcerpt || "",
      createdByUserId: req.user._id,
      updatedByUserId: req.user._id
    });

    await task.populate("assignedTo", "name email");
    await task.populate("assigneeUserId", "name email");
    await task.populate("createdByUserId", "name email");
    await task.populate("updatedByUserId", "name email");
    await appendConversationLinkedWorkMessage(
      sourceConversationResult.conversation,
      req,
      task,
      sourceLinkResult.value
    );
    await createTaskAssignmentNotifications(task, []);

    await writeAuditLog({
      actor: req.user._id,
      action: "workspace.task.create",
      targetId: task._id.toString(),
      targetType: "WorkspaceTask",
      metadata: {
        workspaceId: req.workspaceId?.toString?.() || null,
        mode: task.mode,
        status: task.status,
        priority: task.priority,
        sourceConversationId: task.sourceConversationId?.toString?.() || null
      }
    });

    return res.status(201).json(serializeTask(task));
  } catch (error) {
    return res.status(500).json({ message: "Unable to create the workspace task." });
  }
});

router.patch("/:id", requireTaskViewer, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid workspace task id." });
    }

    const task = await WorkspaceTask.findOne(
      buildScopedWorkspaceFilter(req, { _id: req.params.id })
    )
      .populate("assignedTo", "name email")
      .populate("assigneeUserId", "name email")
      .populate("createdByUserId", "name email")
      .populate("updatedByUserId", "name email");

    if (!task) {
      return res.status(404).json({ message: "Workspace task not found." });
    }

    const previousAssigneeIds = [
      ...(Array.isArray(task.assignedTo) ? task.assignedTo : []).map((entry) => entry?._id?.toString?.() || entry?.toString?.() || null),
      task.assigneeUserId?._id?.toString?.() || task.assigneeUserId?.toString?.() || null
    ].filter(Boolean);
    const { patch, error: patchError } = buildTaskPatch(req.body);
    if (patchError) {
      return res.status(400).json({ message: patchError });
    }

    const dueDateResult = parseOptionalDueDate(req.body.dueDate);
    if (dueDateResult.error) {
      return res.status(400).json({ message: dueDateResult.error });
    }

    const assignedResult = await resolveAssignableMembers(req, req.body.assignedTo, req.body.assigneeUserId);
    if (assignedResult.error) {
      return res.status(400).json({ message: assignedResult.error });
    }

    Object.assign(task, patch);

    if (dueDateResult.provided) {
      task.dueDate = dueDateResult.value;
    }

    if (assignedResult.provided) {
      const primaryMembership = assignedResult.memberships[0] || null;
      task.assignedTo = assignedResult.memberships.map((membership) => membership.userId._id);
      task.assigneeNames = assignedResult.memberships.map((membership) => membership.userId?.name || membership.email || "Workspace member");
      task.assigneeUserId = primaryMembership?.userId?._id || null;
      task.assigneeName = primaryMembership?.userId?.name || "";
    }

    if (patch.status !== undefined) {
      if (normalizeTaskStatus(patch.status) === "done") {
        task.completedAt = task.completedAt || new Date();
      } else {
        task.completedAt = null;
      }
    }

    task.updatedByUserId = req.user._id;
    await task.save();
    await task.populate("assignedTo", "name email");
    await task.populate("assigneeUserId", "name email");
    await task.populate("createdByUserId", "name email");
    await task.populate("updatedByUserId", "name email");
    await createTaskAssignmentNotifications(task, previousAssigneeIds);

    await writeAuditLog({
      actor: req.user._id,
      action: "workspace.task.update",
      targetId: task._id.toString(),
      targetType: "WorkspaceTask",
      metadata: {
        workspaceId: req.workspaceId?.toString?.() || null,
        mode: task.mode,
        status: task.status,
        priority: task.priority
      }
    });

    return res.json(serializeTask(task));
  } catch (error) {
    return res.status(500).json({ message: "Unable to update the workspace task." });
  }
});

router.delete("/:id", requireTaskViewer, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid workspace task id." });
    }

    const task = await WorkspaceTask.findOneAndDelete(
      buildScopedWorkspaceFilter(req, { _id: req.params.id })
    );

    if (!task) {
      return res.status(404).json({ message: "Workspace task not found." });
    }

    await writeAuditLog({
      actor: req.user._id,
      action: "workspace.task.delete",
      targetId: task._id.toString(),
      targetType: "WorkspaceTask",
      metadata: {
        workspaceId: req.workspaceId?.toString?.() || null,
        mode: task.mode,
        status: task.status
      }
    });

    return res.json({
      success: true,
      id: task._id.toString()
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to delete the workspace task." });
  }
});

export default router;
