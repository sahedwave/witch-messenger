import express from "express";
import mongoose from "mongoose";

import { authMiddleware } from "../middleware/auth.js";
import { WorkspaceConversation } from "../models/WorkspaceConversation.js";
import { WorkspaceMembership } from "../models/WorkspaceMembership.js";
import { WorkspaceProject } from "../models/WorkspaceProject.js";
import { WorkspaceTask } from "../models/WorkspaceTask.js";
import { writeAuditLog } from "../utils/audit.js";
import { createProjectAssignmentNotifications } from "../utils/workspaceNotifications.js";
import {
  buildWorkspaceFilter,
  serializeWorkspace,
  serializeWorkspaceMembership,
  workspaceContextMiddleware,
  workspaceMembershipMiddleware
} from "../utils/workspaceContext.js";

const router = express.Router();

const PROJECT_STATUS_OPTIONS = new Set(["planning", "active", "completed", "hold", "on_hold", "cancelled"]);
const PROJECT_STATUS_TRANSITIONS = {
  planning: ["active", "on_hold", "completed", "cancelled", "hold"],
  active: ["on_hold", "completed", "cancelled", "hold"],
  hold: ["active", "completed", "cancelled", "on_hold"],
  on_hold: ["active", "completed", "cancelled", "hold"],
  completed: [],
  cancelled: []
};

router.use(authMiddleware);
router.use(workspaceContextMiddleware({ allowDefault: false, allowSingleMembershipFallback: true }));
router.use(workspaceMembershipMiddleware({ allowLegacyFallback: true }));

function buildScopedWorkspaceFilter(req, baseFilter = {}) {
  return buildWorkspaceFilter(req.workspace, baseFilter, {
    includeLegacy: Boolean(req.workspaceMembership?.isLegacyFallback)
  });
}

function requireProjectViewer(req, res, next) {
  if (req.workspaceMembership && req.workspaceMembership.status !== "suspended") {
    return next();
  }

  return res.status(403).json({ message: "Workspace project access is required." });
}

function serializeProjectActor(user, fallbackName = "Workspace member") {
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

function serializeAssignableMember(membership) {
  return {
    id: membership.userId?._id?.toString?.() || "",
    name: membership.userId?.name || membership.email || "Workspace member",
    email: membership.userId?.email || membership.email || "",
    workspaceRole: membership.workspaceRole || "member"
  };
}

function normalizeMilestones(rawMilestones = []) {
  if (!Array.isArray(rawMilestones)) {
    return [];
  }

  return rawMilestones
    .map((milestone, index) => ({
      title: String(milestone?.title || "").trim() || `Milestone ${index + 1}`,
      weight: Math.max(0, Math.min(100, Number(milestone?.weight || 0))),
      done: Boolean(milestone?.done)
    }))
    .filter((milestone) => milestone.title.trim());
}

function calculateMilestoneProgress(milestones = []) {
  const totalWeight = milestones.reduce((sum, milestone) => sum + (Number(milestone.weight) || 0), 0);
  if (!totalWeight) {
    return 0;
  }

  const completedWeight = milestones.reduce(
    (sum, milestone) => sum + (milestone.done ? Number(milestone.weight) || 0 : 0),
    0
  );

  return Math.round((completedWeight / totalWeight) * 100);
}

function calculateTaskProgress(tasks = []) {
  if (!tasks.length) {
    return 0;
  }

  const completedCount = tasks.filter((task) => {
    const status = String(task.status || "").trim().toLowerCase();
    return status === "done" || status === "completed";
  }).length;
  return Math.round((completedCount / tasks.length) * 100);
}

function normalizeProjectStatus(status = "planning") {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "hold") {
    return "on_hold";
  }
  return PROJECT_STATUS_OPTIONS.has(normalized) ? normalized : "planning";
}

function isTaskComplete(task) {
  const status = String(task?.status || "").trim().toLowerCase();
  return status === "done" || status === "completed";
}

function priorityWeight(priority = "medium") {
  const normalized = String(priority || "").trim().toLowerCase();
  if (normalized === "urgent") {
    return 4;
  }
  if (normalized === "high") {
    return 3;
  }
  if (normalized === "medium") {
    return 2;
  }
  return 1;
}

function sortLinkedTasks(tasks = []) {
  return [...tasks].sort((left, right) => {
    const leftDue = left?.dueDate ? new Date(left.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
    const rightDue = right?.dueDate ? new Date(right.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
    if (leftDue !== rightDue) {
      return leftDue - rightDue;
    }

    const priorityDelta = priorityWeight(right?.priority) - priorityWeight(left?.priority);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return new Date(right?.updatedAt || 0).getTime() - new Date(left?.updatedAt || 0).getTime();
  });
}

function summarizeProjectTasks(linkedTasks = []) {
  const now = new Date();
  const sortedTasks = sortLinkedTasks(linkedTasks);
  const totalTasks = sortedTasks.length;
  const completedTasks = sortedTasks.filter((task) => isTaskComplete(task)).length;
  const overdueTasks = sortedTasks.filter((task) => {
    if (isTaskComplete(task) || !task?.dueDate) {
      return false;
    }

    return new Date(task.dueDate).getTime() < now.getTime();
  }).length;
  const nextDueDate = sortedTasks
    .filter((task) => !isTaskComplete(task) && task?.dueDate)
    .map((task) => new Date(task.dueDate))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((left, right) => left.getTime() - right.getTime())[0] || null;
  const assignees = [...new Map(
    sortedTasks
      .flatMap((task) => Array.isArray(task.assignedTo) ? task.assignedTo : [])
      .map((entry) => {
        const id = entry?.id || entry?._id?.toString?.() || entry?.toString?.() || null;
        return id
          ? [String(id), {
              id: String(id),
              name: entry?.name || "Workspace member",
              email: entry?.email || ""
            }]
          : null;
      })
      .filter(Boolean)
  ).values()];

  return {
    tasks: sortedTasks,
    totalTasks,
    completedTasks,
    overdueTasks,
    progress: totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0,
    nextDueDate,
    assignees
  };
}

function assertValidProjectTransition(from, to) {
  const normalizedFrom = normalizeProjectStatus(from);
  const normalizedTo = normalizeProjectStatus(to);
  const allowed = PROJECT_STATUS_TRANSITIONS[normalizedFrom] || [];

  if (!allowed.includes(normalizedTo)) {
    const error = new Error("Project status transition is not allowed.");
    error.statusCode = 409;
    throw error;
  }
}

function serializeLinkedTask(task) {
  const assignedUsers = Array.isArray(task.assignedTo) ? task.assignedTo : [];
  const primaryAssignee = assignedUsers[0] || task.assigneeUserId || null;
  return {
    id: task._id.toString(),
    title: task.title,
    status: task.status || "todo",
    priority: String(task.priority || "medium").toLowerCase(),
    dueDate: task.dueDate || null,
    completedAt: task.completedAt || null,
    projectId: task.projectId || null,
    assignedTo: assignedUsers.map((user, index) => ({
      id: user?._id?.toString?.() || user?.toString?.() || null,
      name: user?.name || task.assigneeNames?.[index] || "Workspace member",
      email: user?.email || ""
    })).filter((entry) => entry.id),
    assigneeUserId: primaryAssignee?._id?.toString?.() || primaryAssignee?.toString?.() || null,
    assigneeName: task.assigneeName || primaryAssignee?.name || ""
  };
}

function serializeProject(project, linkedTasks = []) {
  const milestones = Array.isArray(project.milestones) ? project.milestones : [];
  const taskSummary = summarizeProjectTasks(linkedTasks);
  const progress = taskSummary.totalTasks ? taskSummary.progress : calculateMilestoneProgress(milestones);
  const conversationLinks = Array.isArray(project.conversationLinks) ? project.conversationLinks : [];

  return {
    id: project._id.toString(),
    workspaceId: project.workspaceId?.toString?.() || null,
    name: project.name,
    client: project.client || "Internal",
    type: project.type || "General",
    status: normalizeProjectStatus(project.status || "planning"),
    completedAt: project.completedAt || null,
    dueDate: project.dueDate || null,
    summary: project.summary || "",
    milestones: milestones.map((milestone) => ({
      id: milestone._id?.toString?.() || null,
      title: milestone.title,
      weight: Number(milestone.weight || 0),
      done: Boolean(milestone.done)
    })),
    team: Array.isArray(project.team)
      ? project.team.map((member) => ({
          id: member._id?.toString?.() || null,
          userId: member.userId?._id?.toString?.() || member.userId?.toString?.() || null,
          name: member.name || "Workspace member",
          email: member.email || ""
        }))
      : [],
    linkedTasks: taskSummary.tasks.map(serializeLinkedTask),
    linkedTaskCount: taskSummary.totalTasks,
    totalTasks: taskSummary.totalTasks,
    completedTasks: taskSummary.completedTasks,
    overdueTasks: taskSummary.overdueTasks,
    progress,
    nextDueDate: taskSummary.nextDueDate,
    assignees: taskSummary.assignees,
    sourceLink:
      project.sourceConversationId || project.sourceThreadId || project.sourceMessageId
        ? {
            conversationId: project.sourceConversationId?._id?.toString?.() || project.sourceConversationId?.toString?.() || null,
            threadId: project.sourceThreadId || null,
            messageId: project.sourceMessageId || null,
            threadName: project.sourceThreadName || "",
            messageExcerpt: project.sourceMessageExcerpt || ""
          }
        : null,
    conversationLinks: conversationLinks.map((link) => ({
      id: link._id?.toString?.() || null,
      conversationId: link.conversationId?._id?.toString?.() || link.conversationId?.toString?.() || null,
      threadId: link.threadId || null,
      messageId: link.messageId || null,
      threadName: link.threadName || "",
      messageExcerpt: link.messageExcerpt || "",
      linkedAt: link.linkedAt || null
    })),
    linkedConversationCount: conversationLinks.length,
    createdBy: serializeProjectActor(project.createdByUserId),
    updatedBy: serializeProjectActor(project.updatedByUserId),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt
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
    return { error: "Project due date must be a valid date." };
  }

  return { provided: true, value: date };
}

async function resolveWorkspaceMembers(req) {
  const memberships = await WorkspaceMembership.find({
    workspaceId: req.workspaceId,
    status: { $ne: "suspended" }
  })
    .sort({ createdAt: 1 })
    .populate("userId", "name email");

  return memberships.filter((membership) => membership.userId?._id);
}

async function resolveTeamMembers(req, team = []) {
  if (!Array.isArray(team)) {
    return { error: "Project team must be an array." };
  }

  const normalizedTeam = [];
  for (const entry of team) {
    const name = String(entry?.name || "").trim();
    const userId = entry?.userId;

    if (!name && !userId) {
      continue;
    }

    if (!userId) {
      normalizedTeam.push({
        name: name || "Workspace member",
        email: String(entry?.email || "").trim()
      });
      continue;
    }

    if (!mongoose.isValidObjectId(userId)) {
      return { error: "Invalid project team member id." };
    }

    const membership = await WorkspaceMembership.findOne({
      workspaceId: req.workspaceId,
      userId,
      status: { $ne: "suspended" }
    }).populate("userId", "name email");

    if (!membership?.userId?._id) {
      return { error: "Project team members must be active workspace members." };
    }

    normalizedTeam.push({
      userId: membership.userId._id,
      name: membership.userId.name || name || "Workspace member",
      email: membership.userId.email || ""
    });
  }

  return { team: normalizedTeam };
}

function collectProjectTeamUserIds(project) {
  return [...new Set(
    (Array.isArray(project?.team) ? project.team : [])
      .map((entry) => entry?.userId?._id?.toString?.() || entry?.userId?.toString?.() || null)
      .filter(Boolean)
  )];
}

async function resolveLinkedTasks(req, taskIds = []) {
  if (taskIds === undefined) {
    return { provided: false, tasks: [] };
  }

  if (!Array.isArray(taskIds)) {
    return { error: "Linked tasks must be an array." };
  }

  const normalizedIds = [...new Set(taskIds.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!normalizedIds.length) {
    return { provided: true, tasks: [] };
  }

  if (normalizedIds.some((id) => !mongoose.isValidObjectId(id))) {
    return { error: "Linked task ids must be valid." };
  }

  const tasks = await WorkspaceTask.find(
    buildScopedWorkspaceFilter(req, { _id: { $in: normalizedIds } })
  );

  if (tasks.length !== normalizedIds.length) {
    return { error: "Some linked tasks were not found in this workspace." };
  }

  return { provided: true, tasks };
}

function buildProjectPatch(body = {}) {
  const patch = {};

  if (body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (!name) {
      return { error: "Project name is required." };
    }
    patch.name = name;
  }

  if (body.client !== undefined) {
    patch.client = String(body.client || "").trim() || "Internal";
  }

  if (body.type !== undefined) {
    patch.type = String(body.type || "").trim() || "General";
  }

  if (body.status !== undefined) {
    const rawStatus = String(body.status || "").trim();
    const status = normalizeProjectStatus(rawStatus);
    if (!PROJECT_STATUS_OPTIONS.has(rawStatus) && !PROJECT_STATUS_OPTIONS.has(status)) {
      return { error: "Invalid project status." };
    }
    patch.status = status;
  }

  if (body.summary !== undefined) {
    patch.summary = String(body.summary || "").trim();
  }

  if (body.milestones !== undefined) {
    patch.milestones = normalizeMilestones(body.milestones);
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

async function appendConversationLinkedWorkMessage(conversation, req, project, sourceLink) {
  if (!conversation) {
    return;
  }

  const action = sourceLink?.action === "attached" ? "attached" : "created";
  conversation.messages.push({
    senderUserId: req.user._id,
    senderKey: "workspace-system",
    senderName: req.user.name || req.user.email || "Workspace member",
    type: "system",
    content:
      action === "attached"
        ? `This conversation was attached to project "${project.name}".`
        : `Project "${project.name}" was created from this conversation.`,
    metadata: {
      linkedWork: {
        kind: "project",
        action,
        id: project._id.toString(),
        title: project.name,
        status: project.status || "planning",
        sourceMessageId: sourceLink?.sourceMessageId || null,
        sourceThreadId: sourceLink?.sourceThreadId || null
      }
    },
    createdAt: new Date()
  });

  await conversation.save();
}

function buildConversationLinkDocument(sourceLink, userId) {
  if (!sourceLink?.sourceConversationId) {
    return null;
  }

  return {
    conversationId: sourceLink.sourceConversationId,
    threadId: sourceLink.sourceThreadId || "",
    messageId: sourceLink.sourceMessageId || "",
    threadName: sourceLink.sourceThreadName || "",
    messageExcerpt: sourceLink.sourceMessageExcerpt || "",
    linkedByUserId: userId,
    linkedAt: new Date()
  };
}

function hasConversationLink(project, sourceLink) {
  const links = Array.isArray(project?.conversationLinks) ? project.conversationLinks : [];
  return links.some((link) => {
    const sameConversation =
      (link.conversationId?._id?.toString?.() || link.conversationId?.toString?.() || null) ===
      (sourceLink?.sourceConversationId || null);
    const sameMessage = String(link.messageId || "") === String(sourceLink?.sourceMessageId || "");
    const sameThread = String(link.threadId || "") === String(sourceLink?.sourceThreadId || "");
    return sameConversation && sameMessage && sameThread;
  });
}

async function attachProjectTaskLinks(req, projectId, nextTasks, previousTaskIds = []) {
  const nextTaskIds = new Set(nextTasks.map((task) => task._id.toString()));
  const previousIds = new Set(previousTaskIds.map((id) => String(id)));

  const toLink = nextTasks.filter((task) => !previousIds.has(task._id.toString())).map((task) => task._id);
  const toUnlink = [...previousIds].filter((id) => !nextTaskIds.has(id) && mongoose.isValidObjectId(id));

  const updates = [];

  if (toLink.length) {
    updates.push(
      WorkspaceTask.updateMany(
        buildScopedWorkspaceFilter(req, { _id: { $in: toLink } }),
        {
          $set: {
            projectId: String(projectId),
            updatedByUserId: req.user._id
          }
        }
      )
    );
  }

  if (toUnlink.length) {
    updates.push(
      WorkspaceTask.updateMany(
        buildScopedWorkspaceFilter(req, { _id: { $in: toUnlink }, projectId: String(projectId) }),
        {
          $set: {
            projectId: null,
            updatedByUserId: req.user._id
          }
        }
      )
    );
  }

  if (updates.length) {
    await Promise.all(updates);
  }
}

router.get("/summary", requireProjectViewer, async (req, res) => {
  try {
    const now = new Date();
    const [tasks, projects] = await Promise.all([
      WorkspaceTask.find(buildScopedWorkspaceFilter(req))
        .sort({ dueDate: 1, updatedAt: -1 })
        .populate("assignedTo", "name email")
        .populate("assigneeUserId", "name email"),
      WorkspaceProject.find(buildScopedWorkspaceFilter(req))
        .sort({ dueDate: 1, updatedAt: -1 })
        .populate("team.userId", "name email")
        .populate("createdByUserId", "name email")
        .populate("updatedByUserId", "name email")
    ]);

    const overdueTasks = tasks.filter((task) => {
      if (!task.dueDate || task.status === "done" || task.status === "completed") {
        return false;
      }

      return new Date(task.dueDate).getTime() < now.getTime();
    });
    const inProgressTasks = tasks.filter((task) => task.status === "doing");
    const activeProjects = projects.filter((project) => project.status === "active" || project.status === "planning");
    const tasksByProjectId = new Map();
    tasks.forEach((task) => {
      if (!task.projectId) {
        return;
      }

      const key = String(task.projectId);
      if (!tasksByProjectId.has(key)) {
        tasksByProjectId.set(key, []);
      }
      tasksByProjectId.get(key).push(task);
    });

    const projectAttention = activeProjects
      .map((project) => {
        const linkedTasks = tasksByProjectId.get(project._id.toString()) || [];
        const progress = linkedTasks.length
          ? calculateTaskProgress(linkedTasks)
          : calculateMilestoneProgress(Array.isArray(project.milestones) ? project.milestones : []);
        const dueDate = project.dueDate ? new Date(project.dueDate) : null;
        const daysUntilDue = dueDate ? Math.ceil((dueDate.getTime() - now.getTime()) / 86400000) : null;
        const nearDue = typeof daysUntilDue === "number" && daysUntilDue >= 0 && daysUntilDue <= 7;
        const overdue = typeof daysUntilDue === "number" && daysUntilDue < 0;
        const lowCompletion = progress < 50;

        return {
          project: serializeProject(project, linkedTasks),
          progress,
          daysUntilDue,
          nearDue,
          overdue,
          lowCompletion
        };
      })
      .filter((entry) => entry.nearDue || entry.overdue || entry.lowCompletion)
      .sort((left, right) => {
        const leftRank = left.overdue ? 3 : left.nearDue ? 2 : 1;
        const rightRank = right.overdue ? 3 : right.nearDue ? 2 : 1;
        if (leftRank !== rightRank) {
          return rightRank - leftRank;
        }

        return (left.daysUntilDue ?? 9999) - (right.daysUntilDue ?? 9999);
      });

    return res.json({
      trackedTasks: tasks.length,
      overdueTasks: overdueTasks.length,
      inProgressTasks: inProgressTasks.length,
      trackedProjects: projects.length,
      activeProjects: activeProjects.length,
      projectsNeedingAttention: projectAttention.length,
      executionAttention: overdueTasks.length + inProgressTasks.length + projectAttention.length,
      topOverdueTasks: overdueTasks.slice(0, 4).map(serializeLinkedTask),
      topInProgressTasks: inProgressTasks.slice(0, 4).map(serializeLinkedTask),
      topProjects: projectAttention.slice(0, 4).map((entry) => ({
        ...entry.project,
        progress: entry.progress,
        attentionReason: entry.overdue
          ? "overdue"
          : entry.nearDue && entry.lowCompletion
            ? "near_due_low_completion"
            : entry.nearDue
              ? "near_due"
              : "low_completion",
        daysUntilDue: entry.daysUntilDue
      }))
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load workspace execution summary." });
  }
});

router.get("/", requireProjectViewer, async (req, res) => {
  try {
    const [projects, members, tasks] = await Promise.all([
      WorkspaceProject.find(buildScopedWorkspaceFilter(req))
        .sort({ dueDate: 1, updatedAt: -1 })
        .populate("team.userId", "name email")
        .populate("createdByUserId", "name email")
        .populate("updatedByUserId", "name email"),
      resolveWorkspaceMembers(req),
      WorkspaceTask.find(buildScopedWorkspaceFilter(req))
        .sort({ dueDate: 1, updatedAt: -1 })
        .populate("assignedTo", "name email")
        .populate("assigneeUserId", "name email")
    ]);

    const tasksByProjectId = new Map();
    tasks.forEach((task) => {
      if (!task.projectId) {
        return;
      }

      const key = String(task.projectId);
      if (!tasksByProjectId.has(key)) {
        tasksByProjectId.set(key, []);
      }
      tasksByProjectId.get(key).push(task);
    });

    return res.json({
      workspace: serializeWorkspace(req.workspace),
      membership: serializeWorkspaceMembership(req.workspaceMembership),
      members: members.map(serializeAssignableMember),
      availableTasks: tasks.map(serializeLinkedTask),
      projects: projects.map((project) => serializeProject(project, tasksByProjectId.get(project._id.toString()) || []))
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load workspace projects." });
  }
});

router.get("/:id/tasks", requireProjectViewer, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid workspace project id." });
    }

    const project = await WorkspaceProject.findOne(buildScopedWorkspaceFilter(req, { _id: req.params.id })).select("_id");
    if (!project) {
      return res.status(404).json({ message: "Workspace project not found." });
    }

    const tasks = await WorkspaceTask.find(
      buildScopedWorkspaceFilter(req, { projectId: project._id.toString() })
    )
      .populate("assignedTo", "name email")
      .populate("assigneeUserId", "name email")
      .populate("createdByUserId", "name email")
      .populate("updatedByUserId", "name email");

    return res.json({
      tasks: sortLinkedTasks(tasks).map(serializeLinkedTask)
    });
  } catch (_error) {
    return res.status(500).json({ message: "Unable to load project tasks." });
  }
});

router.post("/", requireProjectViewer, async (req, res) => {
  try {
    const { patch, error: patchError } = buildProjectPatch(req.body);
    if (patchError) {
      return res.status(400).json({ message: patchError });
    }

    if (!patch.name) {
      return res.status(400).json({ message: "Project name is required." });
    }

    const dueDateResult = parseOptionalDueDate(req.body.dueDate);
    if (dueDateResult.error) {
      return res.status(400).json({ message: dueDateResult.error });
    }

    const teamResult = await resolveTeamMembers(req, req.body.team || []);
    if (teamResult.error) {
      return res.status(400).json({ message: teamResult.error });
    }

    const linkedTasksResult = await resolveLinkedTasks(req, req.body.linkedTaskIds || []);
    if (linkedTasksResult.error) {
      return res.status(400).json({ message: linkedTasksResult.error });
    }

    const sourceLinkResult = parseSourceLink(req.body);
    if (sourceLinkResult.error) {
      return res.status(400).json({ message: sourceLinkResult.error });
    }

    const sourceConversationResult = await resolveSourceConversation(req, sourceLinkResult.value);
    if (sourceConversationResult.error) {
      return res.status(400).json({ message: sourceConversationResult.error });
    }
    const initialConversationLink = buildConversationLinkDocument(sourceLinkResult.value, req.user._id);

    const project = await WorkspaceProject.create({
      workspaceId: req.workspaceId,
      name: patch.name,
      client: patch.client || "Internal",
      type: patch.type || "General",
      status: normalizeProjectStatus(patch.status || "planning"),
      completedAt: normalizeProjectStatus(patch.status || "planning") === "completed" ? new Date() : null,
      dueDate: dueDateResult.provided ? dueDateResult.value : null,
      summary: patch.summary || "",
      milestones: patch.milestones || [],
      team: teamResult.team || [],
      sourceConversationId: sourceLinkResult.value?.sourceConversationId || null,
      sourceThreadId: sourceLinkResult.value?.sourceThreadId || "",
      sourceMessageId: sourceLinkResult.value?.sourceMessageId || "",
      sourceThreadName: sourceLinkResult.value?.sourceThreadName || "",
      sourceMessageExcerpt: sourceLinkResult.value?.sourceMessageExcerpt || "",
      conversationLinks: initialConversationLink ? [initialConversationLink] : [],
      createdByUserId: req.user._id,
      updatedByUserId: req.user._id
    });

    await attachProjectTaskLinks(req, project._id.toString(), linkedTasksResult.tasks || [], []);
    await createProjectAssignmentNotifications(project, []);

    await project.populate("team.userId", "name email");
    await project.populate("createdByUserId", "name email");
    await project.populate("updatedByUserId", "name email");

    const refreshedTasks = await WorkspaceTask.find(
      buildScopedWorkspaceFilter(req, { projectId: project._id.toString() })
    )
      .populate("assignedTo", "name email")
      .populate("assigneeUserId", "name email");
    await appendConversationLinkedWorkMessage(
      sourceConversationResult.conversation,
      req,
      project,
      sourceLinkResult.value
    );

    await writeAuditLog({
      actor: req.user._id,
      action: "workspace.project.create",
      targetId: project._id.toString(),
      targetType: "WorkspaceProject",
      metadata: {
        workspaceId: req.workspaceId?.toString?.() || null,
        status: project.status,
        linkedTaskCount: refreshedTasks.length,
        sourceConversationId: project.sourceConversationId?.toString?.() || null
      }
    });

    return res.status(201).json(serializeProject(project, refreshedTasks));
  } catch (error) {
    return res.status(500).json({ message: "Unable to create the workspace project." });
  }
});

router.patch("/:id", requireProjectViewer, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid workspace project id." });
    }

    const project = await WorkspaceProject.findOne(
      buildScopedWorkspaceFilter(req, { _id: req.params.id })
    )
      .populate("team.userId", "name email")
      .populate("createdByUserId", "name email")
      .populate("updatedByUserId", "name email");

    if (!project) {
      return res.status(404).json({ message: "Workspace project not found." });
    }

    const previousTeamUserIds = collectProjectTeamUserIds(project);
    const { patch, error: patchError } = buildProjectPatch(req.body);
    if (patchError) {
      return res.status(400).json({ message: patchError });
    }

    const dueDateResult = parseOptionalDueDate(req.body.dueDate);
    if (dueDateResult.error) {
      return res.status(400).json({ message: dueDateResult.error });
    }

    const teamResult = await resolveTeamMembers(req, req.body.team);
    if (teamResult.error) {
      return res.status(400).json({ message: teamResult.error });
    }

    const previousLinkedTasks = await WorkspaceTask.find(
      buildScopedWorkspaceFilter(req, { projectId: project._id.toString() })
    ).select("_id");
    const previousTaskIds = previousLinkedTasks.map((task) => task._id.toString());

    const linkedTasksResult = await resolveLinkedTasks(req, req.body.linkedTaskIds);
    if (linkedTasksResult.error) {
      return res.status(400).json({ message: linkedTasksResult.error });
    }

    Object.assign(project, patch);
    if (patch.status !== undefined) {
      project.status = normalizeProjectStatus(patch.status);
      project.completedAt = project.status === "completed" ? project.completedAt || new Date() : null;
    }

    if (dueDateResult.provided) {
      project.dueDate = dueDateResult.value;
    }

    if (req.body.team !== undefined) {
      project.team = teamResult.team || [];
    }

    project.updatedByUserId = req.user._id;
    await project.save();
    await createProjectAssignmentNotifications(project, previousTeamUserIds);

    if (linkedTasksResult.provided) {
      await attachProjectTaskLinks(req, project._id.toString(), linkedTasksResult.tasks || [], previousTaskIds);
    }

    await project.populate("team.userId", "name email");
    await project.populate("createdByUserId", "name email");
    await project.populate("updatedByUserId", "name email");

    const refreshedTasks = await WorkspaceTask.find(
      buildScopedWorkspaceFilter(req, { projectId: project._id.toString() })
    )
      .populate("assignedTo", "name email")
      .populate("assigneeUserId", "name email");

    await writeAuditLog({
      actor: req.user._id,
      action: "workspace.project.update",
      targetId: project._id.toString(),
      targetType: "WorkspaceProject",
      metadata: {
        workspaceId: req.workspaceId?.toString?.() || null,
        status: project.status,
        linkedTaskCount: refreshedTasks.length
      }
    });

    return res.json(serializeProject(project, refreshedTasks));
  } catch (error) {
    return res.status(500).json({ message: "Unable to update the workspace project." });
  }
});

router.patch("/:id/status", requireProjectViewer, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid workspace project id." });
    }

    const nextStatus = normalizeProjectStatus(req.body.status || "");
    if (!PROJECT_STATUS_OPTIONS.has(nextStatus)) {
      return res.status(400).json({ message: "Invalid project status." });
    }

    const project = await WorkspaceProject.findOne(
      buildScopedWorkspaceFilter(req, { _id: req.params.id })
    )
      .populate("team.userId", "name email")
      .populate("createdByUserId", "name email")
      .populate("updatedByUserId", "name email");

    if (!project) {
      return res.status(404).json({ message: "Workspace project not found." });
    }

    try {
      assertValidProjectTransition(project.status || "planning", nextStatus);
    } catch (error) {
      return res.status(error.statusCode || 409).json({ message: error.message });
    }

    project.status = nextStatus;
    project.completedAt = nextStatus === "completed" ? project.completedAt || new Date() : null;
    project.updatedByUserId = req.user._id;
    await project.save();

    const refreshedTasks = await WorkspaceTask.find(
      buildScopedWorkspaceFilter(req, { projectId: project._id.toString() })
    )
      .populate("assignedTo", "name email")
      .populate("assigneeUserId", "name email");

    await writeAuditLog({
      actor: req.user._id,
      action: "workspace.project.status",
      targetId: project._id.toString(),
      targetType: "WorkspaceProject",
      metadata: {
        workspaceId: req.workspaceId?.toString?.() || null,
        status: project.status
      }
    });

    return res.json(serializeProject(project, refreshedTasks));
  } catch (_error) {
    return res.status(500).json({ message: "Unable to update the workspace project status." });
  }
});

router.post("/:id/conversation-link", requireProjectViewer, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid workspace project id." });
    }

    const sourceLinkResult = parseSourceLink(req.body);
    if (sourceLinkResult.error) {
      return res.status(400).json({ message: sourceLinkResult.error });
    }

    if (!sourceLinkResult.value?.sourceConversationId) {
      return res.status(400).json({ message: "A source conversation is required." });
    }

    const sourceConversationResult = await resolveSourceConversation(req, sourceLinkResult.value);
    if (sourceConversationResult.error) {
      return res.status(400).json({ message: sourceConversationResult.error });
    }

    const project = await WorkspaceProject.findOne(
      buildScopedWorkspaceFilter(req, { _id: req.params.id })
    )
      .populate("team.userId", "name email")
      .populate("createdByUserId", "name email")
      .populate("updatedByUserId", "name email");

    if (!project) {
      return res.status(404).json({ message: "Workspace project not found." });
    }

    const nextConversationLink = buildConversationLinkDocument(sourceLinkResult.value, req.user._id);
    const alreadyLinked = hasConversationLink(project, sourceLinkResult.value);

    if (!alreadyLinked && nextConversationLink) {
      project.conversationLinks = [...(Array.isArray(project.conversationLinks) ? project.conversationLinks : []), nextConversationLink];
      project.updatedByUserId = req.user._id;
      await project.save();
    }

    await project.populate("team.userId", "name email");
    await project.populate("createdByUserId", "name email");
    await project.populate("updatedByUserId", "name email");

    const refreshedTasks = await WorkspaceTask.find(
      buildScopedWorkspaceFilter(req, { projectId: project._id.toString() })
    )
      .populate("assignedTo", "name email")
      .populate("assigneeUserId", "name email");

    if (!alreadyLinked) {
      await appendConversationLinkedWorkMessage(
        sourceConversationResult.conversation,
        req,
        project,
        { ...sourceLinkResult.value, action: "attached" }
      );

      await writeAuditLog({
        actor: req.user._id,
        action: "workspace.project.conversation_link",
        targetId: project._id.toString(),
        targetType: "WorkspaceProject",
        metadata: {
          workspaceId: req.workspaceId?.toString?.() || null,
          sourceConversationId: sourceLinkResult.value.sourceConversationId,
          sourceThreadId: sourceLinkResult.value.sourceThreadId || null,
          sourceMessageId: sourceLinkResult.value.sourceMessageId || null
        }
      });
    }

    return res.json({
      alreadyLinked,
      project: serializeProject(project, refreshedTasks)
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to attach this conversation to the project." });
  }
});

router.delete("/:id", requireProjectViewer, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid workspace project id." });
    }

    const project = await WorkspaceProject.findOneAndDelete(
      buildScopedWorkspaceFilter(req, { _id: req.params.id })
    );

    if (!project) {
      return res.status(404).json({ message: "Workspace project not found." });
    }

    await WorkspaceTask.updateMany(
      buildScopedWorkspaceFilter(req, { projectId: project._id.toString() }),
      {
        $set: {
          projectId: null,
          updatedByUserId: req.user._id
        }
      }
    );

    await writeAuditLog({
      actor: req.user._id,
      action: "workspace.project.delete",
      targetId: project._id.toString(),
      targetType: "WorkspaceProject",
      metadata: {
        workspaceId: req.workspaceId?.toString?.() || null,
        status: project.status
      }
    });

    return res.json({
      success: true,
      id: project._id.toString()
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to delete the workspace project." });
  }
});

export default router;
