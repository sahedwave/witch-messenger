import mongoose from "mongoose";

import { WorkspaceNotification } from "../models/WorkspaceNotification.js";

function normalizeObjectId(value) {
  if (!value || !mongoose.isValidObjectId(value)) {
    return null;
  }

  return value;
}

function startOfUtcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export async function createWorkspaceNotification(
  workspaceId,
  recipientId,
  type,
  referenceType,
  referenceId,
  message,
  options = {}
) {
  const normalizedWorkspaceId = normalizeObjectId(workspaceId);
  const normalizedRecipientId = normalizeObjectId(recipientId);
  const normalizedReferenceId = normalizeObjectId(referenceId);

  if (!normalizedWorkspaceId || !normalizedRecipientId || !normalizedReferenceId || !message) {
    return null;
  }

  if (options.skipIfExists) {
    const existing = await WorkspaceNotification.findOne({
      workspaceId: normalizedWorkspaceId,
      recipientId: normalizedRecipientId,
      type,
      referenceType,
      referenceId: normalizedReferenceId,
      ...(options.createdAfter ? { createdAt: { $gte: options.createdAfter } } : {})
    }).select("_id");

    if (existing?._id) {
      return existing;
    }
  }

  return WorkspaceNotification.create({
    workspaceId: normalizedWorkspaceId,
    recipientId: normalizedRecipientId,
    type,
    referenceType,
    referenceId: normalizedReferenceId,
    message: String(message || "").trim().slice(0, 280)
  });
}

function collectTaskAssigneeIds(task) {
  const ids = new Set();
  (Array.isArray(task?.assignedTo) ? task.assignedTo : []).forEach((entry) => {
    const normalized = normalizeObjectId(entry?._id || entry?.id || entry);
    if (normalized) {
      ids.add(String(normalized));
    }
  });

  const legacyAssigneeId = normalizeObjectId(task?.assigneeUserId?._id || task?.assigneeUserId);
  if (legacyAssigneeId) {
    ids.add(String(legacyAssigneeId));
  }

  return [...ids];
}

export async function createTaskAssignmentNotifications(task, previousAssigneeIds = []) {
  const workspaceId = normalizeObjectId(task?.workspaceId);
  const taskId = normalizeObjectId(task?._id);
  if (!workspaceId || !taskId) {
    return;
  }

  const previous = new Set(previousAssigneeIds.map((entry) => String(entry)));
  const nextAssigneeIds = collectTaskAssigneeIds(task).filter((entry) => !previous.has(String(entry)));

  if (!nextAssigneeIds.length) {
    return;
  }

  await Promise.all(
    nextAssigneeIds.map((recipientId) =>
      createWorkspaceNotification(
        workspaceId,
        recipientId,
        "task_assigned",
        "task",
        taskId,
        `You were assigned to "${task.title || "a task"}".`
      )
    )
  );
}

export async function createProjectAssignmentNotifications(project, previousMemberIds = []) {
  const workspaceId = normalizeObjectId(project?.workspaceId);
  const projectId = normalizeObjectId(project?._id);
  if (!workspaceId || !projectId) {
    return;
  }

  const previous = new Set(previousMemberIds.map((entry) => String(entry)));
  const nextTeamIds = [...new Set(
    (Array.isArray(project?.team) ? project.team : [])
      .map((member) => normalizeObjectId(member?.userId?._id || member?.userId))
      .filter(Boolean)
      .map((entry) => String(entry))
  )].filter((entry) => !previous.has(entry));

  if (!nextTeamIds.length) {
    return;
  }

  await Promise.all(
    nextTeamIds.map((recipientId) =>
      createWorkspaceNotification(
        workspaceId,
        recipientId,
        "project_assigned",
        "project",
        projectId,
        `You were added to project "${project.name || "Untitled project"}".`
      )
    )
  );
}

export async function ensureTaskScheduleNotifications(tasks = []) {
  if (!Array.isArray(tasks) || !tasks.length) {
    return;
  }

  const now = new Date();
  const startToday = startOfUtcDay(now);

  await Promise.all(
    tasks.map(async (task) => {
      const taskId = normalizeObjectId(task?._id);
      const workspaceId = normalizeObjectId(task?.workspaceId);
      if (!taskId || !workspaceId || !task?.dueDate) {
        return;
      }

      const taskStatus = String(task.status || "").trim().toLowerCase();
      if (taskStatus === "done" || taskStatus === "completed") {
        return;
      }

      const dueDate = new Date(task.dueDate);
      if (Number.isNaN(dueDate.getTime())) {
        return;
      }

      const dueDay = startOfUtcDay(dueDate);
      const isDueSoon = dueDay.getTime() === startToday.getTime();
      const isOverdue = dueDay.getTime() < startToday.getTime();

      if (!isDueSoon && !isOverdue) {
        return;
      }

      const recipientIds = collectTaskAssigneeIds(task);
      if (!recipientIds.length) {
        return;
      }

      const type = isOverdue ? "task_overdue" : "task_due_soon";
      const message = isOverdue
        ? `Task "${task.title || "Untitled task"}" is overdue.`
        : `Task "${task.title || "Untitled task"}" is due today.`;

      await Promise.all(
        recipientIds.map((recipientId) =>
          createWorkspaceNotification(
            workspaceId,
            recipientId,
            type,
            "task",
            taskId,
            message,
            {
              skipIfExists: true,
              createdAfter: startToday
            }
          )
        )
      );
    })
  );
}

export function serializeWorkspaceNotification(notification) {
  return {
    id: notification._id.toString(),
    workspaceId: notification.workspaceId?.toString?.() || null,
    recipientId: notification.recipientId?._id?.toString?.() || notification.recipientId?.toString?.() || null,
    type: notification.type,
    referenceType: notification.referenceType,
    referenceId: notification.referenceId?.toString?.() || null,
    message: notification.message,
    read: Boolean(notification.read),
    readAt: notification.readAt || null,
    createdAt: notification.createdAt
  };
}
