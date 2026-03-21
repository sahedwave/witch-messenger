import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import request from "supertest";

import { createServerEnvironment } from "../src/app.js";
import { connectDB } from "../src/config/db.js";
import { InvoiceRecord } from "../src/models/InvoiceRecord.js";
import { Workspace } from "../src/models/Workspace.js";
import { WorkspaceMembership } from "../src/models/WorkspaceMembership.js";
import { WorkspaceProject } from "../src/models/WorkspaceProject.js";
import { WorkspaceTask } from "../src/models/WorkspaceTask.js";

let mongoServer;
let serverEnvironment;

async function registerUser(user) {
  const response = await request(serverEnvironment.app).post("/api/auth/register").send(user);
  assert.equal(response.statusCode, 201);
  return response.body;
}

async function createWorkspaceActor({
  workspace = null,
  workspaceRole = workspace ? "member" : "owner",
  financeRoles = ["viewer", "approver", "finance_staff"],
  modules = ["finance"]
} = {}) {
  const registered = await registerUser({
    name: `Overview Tasks ${workspaceRole}`,
    email: `overview-tasks-${crypto.randomUUID()}@example.com`,
    password: "password1"
  });

  const activeWorkspace =
    workspace ||
    (await Workspace.create({
      name: `Overview Tasks ${crypto.randomUUID().slice(0, 8)}`,
      slug: `overview-tasks-${crypto.randomUUID().slice(0, 8)}`,
      ownerUserId: registered.user.id,
      status: "active"
    }));

  await WorkspaceMembership.create({
    workspaceId: activeWorkspace._id,
    userId: registered.user.id,
    email: registered.user.email,
    workspaceRole,
    financeRoles,
    modules,
    status: "active"
  });

  return {
    token: registered.token,
    user: registered.user,
    workspace: activeWorkspace
  };
}

function buildWorkspaceHeaders(context) {
  return {
    Authorization: `Bearer ${context.token}`,
    "x-workspace-id": context.workspace._id.toString()
  };
}

async function createInvoice(context, overrides = {}) {
  return InvoiceRecord.create({
    workspaceId: context.workspace._id,
    invoiceNumber: overrides.invoiceNumber || `INV-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    vendorName: overrides.vendorName || "QA Vendor",
    customerName: overrides.customerName || "QA Customer",
    amount: overrides.amount ?? 100,
    currency: overrides.currency || "USD",
    dueDate: overrides.dueDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    status: overrides.status || "approved",
    paidAmount: overrides.paidAmount ?? 0,
    createdBy: context.user.id,
    createdAt: overrides.createdAt || new Date(Date.now() - 24 * 60 * 60 * 1000)
  });
}

async function createTask(context, overrides = {}) {
  const assignedUsers = Array.isArray(overrides.assignedTo) ? overrides.assignedTo : [];
  const primaryAssignee = assignedUsers[0] || null;

  return WorkspaceTask.create({
    workspaceId: context.workspace._id,
    title: overrides.title || "Workspace task",
    note: overrides.note || "",
    status: overrides.status || "todo",
    priority: overrides.priority || "medium",
    dueDate: overrides.dueDate ?? null,
    completedAt: overrides.completedAt ?? null,
    mode: overrides.mode || "professional",
    assignedTo: assignedUsers.map((user) => new mongoose.Types.ObjectId(user.id || user._id || user)),
    assigneeNames: assignedUsers.map((user) => user.name || "Workspace member"),
    assigneeUserId: primaryAssignee ? new mongoose.Types.ObjectId(primaryAssignee.id || primaryAssignee._id || primaryAssignee) : null,
    assigneeName: primaryAssignee?.name || "",
    projectId: overrides.projectId || null,
    createdByUserId: new mongoose.Types.ObjectId(overrides.createdByUserId || context.user.id),
    updatedByUserId: new mongoose.Types.ObjectId(overrides.updatedByUserId || context.user.id),
    createdAt: overrides.createdAt || new Date(Date.now() - 60 * 60 * 1000),
    updatedAt: overrides.updatedAt || new Date(Date.now() - 30 * 60 * 1000)
  });
}

async function createProject(context, overrides = {}) {
  return WorkspaceProject.create({
    workspaceId: context.workspace._id,
    name: overrides.name || "Execution project",
    client: overrides.client || "Internal",
    type: overrides.type || "General",
    status: overrides.status || "active",
    completedAt: overrides.completedAt ?? null,
    dueDate: overrides.dueDate ?? null,
    summary: overrides.summary || "Project summary",
    milestones: overrides.milestones || [],
    team: overrides.team || [],
    createdByUserId: new mongoose.Types.ObjectId(overrides.createdByUserId || context.user.id),
    updatedByUserId: new mongoose.Types.ObjectId(overrides.updatedByUserId || context.user.id),
    createdAt: overrides.createdAt || new Date(Date.now() - 24 * 60 * 60 * 1000),
    updatedAt: overrides.updatedAt || new Date(Date.now() - 12 * 60 * 60 * 1000)
  });
}

function dueDaysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

before(async () => {
  process.env.JWT_SECRET = "test-secret";
  process.env.NODE_ENV = "test";
  mongoServer = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      storageEngine: "wiredTiger"
    },
    instance: {
      ip: "127.0.0.1"
    }
  });
  await connectDB(mongoServer.getUri());
  serverEnvironment = createServerEnvironment({
    clientUrls: ["http://localhost:3000"],
    jwtSecret: "test-secret"
  });

  await new Promise((resolve) => {
    serverEnvironment.server.listen(0, "127.0.0.1", resolve);
  });
});

after(async () => {
  if (serverEnvironment?.io) {
    await new Promise((resolve) => serverEnvironment.io.close(resolve));
  }
  if (serverEnvironment?.server?.listening) {
    await new Promise((resolve) => serverEnvironment.server.close(resolve));
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
});

test("workspace overview: returns finance pressure when Finance is enabled", async () => {
  const owner = await createWorkspaceActor();

  await Promise.all([
    createInvoice(owner, { status: "pending_review", dueDate: dueDaysFromNow(3) }),
    createInvoice(owner, { status: "overdue", dueDate: dueDaysFromNow(-3) })
  ]);

  const response = await request(serverEnvironment.app)
    .get("/api/workspaces/overview")
    .set(buildWorkspaceHeaders(owner));

  assert.equal(response.statusCode, 200);
  assert.ok(response.body.finance);
  assert.ok(response.body.finance.pendingApprovals > 0);
  assert.ok(response.body.finance.overdueInvoices > 0);
});

test("workspace overview: returns task pressure correctly", async () => {
  const owner = await createWorkspaceActor();
  const teammate = await createWorkspaceActor({
    workspace: owner.workspace,
    workspaceRole: "member",
    modules: ["finance"]
  });

  await Promise.all([
    createTask(owner, {
      title: "Overdue assigned task",
      assignedTo: [teammate.user],
      dueDate: dueDaysFromNow(-2),
      status: "todo"
    }),
    createTask(owner, {
      title: "Due today assigned task",
      assignedTo: [teammate.user],
      dueDate: new Date(),
      status: "doing"
    }),
    createTask(owner, {
      title: "Unassigned task",
      dueDate: dueDaysFromNow(2),
      status: "todo"
    })
  ]);

  const response = await request(serverEnvironment.app)
    .get("/api/workspaces/overview")
    .set(buildWorkspaceHeaders(owner));

  assert.equal(response.statusCode, 200);
  assert.ok(response.body.tasks);
  assert.ok(response.body.tasks.overdue >= 1);
  assert.ok(response.body.tasks.dueToday >= 1);
  assert.ok(response.body.tasks.unassigned >= 1);
});

test("workspace overview: returns project pressure correctly", async () => {
  const owner = await createWorkspaceActor();
  const project = await createProject(owner, { status: "active" });

  await createTask(owner, {
    title: "Project overdue task",
    projectId: project._id.toString(),
    dueDate: dueDaysFromNow(-1),
    status: "doing"
  });

  const response = await request(serverEnvironment.app)
    .get("/api/workspaces/overview")
    .set(buildWorkspaceHeaders(owner));

  assert.equal(response.statusCode, 200);
  assert.ok(response.body.projects);
  assert.ok(response.body.projects.withOverdueTasks >= 1);
  assert.ok(response.body.projects.active >= 1);
});

test("workspace overview: returns empty pressure for a clean workspace", async () => {
  const owner = await createWorkspaceActor({ modules: ["finance", "warehouse"] });

  const response = await request(serverEnvironment.app)
    .get("/api/workspaces/overview")
    .set(buildWorkspaceHeaders(owner));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.finance, {
    pendingApprovals: 0,
    overdueInvoices: 0,
    pendingExpenses: 0,
    outstandingAmount: {},
    reconcileQueue: 0
  });
  assert.deepEqual(response.body.warehouse, {
    lowStock: 0,
    pendingShipments: 0,
    pendingPOCount: 0,
    needsAttention: 0
  });
  assert.deepEqual(response.body.tasks, {
    overdue: 0,
    dueToday: 0,
    unassigned: 0,
    myTasks: 0
  });
  assert.deepEqual(response.body.projects, {
    withOverdueTasks: 0,
    active: 0
  });
});

test("workspace overview: requires authentication", async () => {
  const response = await request(serverEnvironment.app)
    .get("/api/workspaces/overview");

  assert.equal(response.statusCode, 401);
});

test("workspace overview: requires workspace membership", async () => {
  const workspaceA = await createWorkspaceActor();
  const workspaceB = await createWorkspaceActor();

  const response = await request(serverEnvironment.app)
    .get("/api/workspaces/overview")
    .set({
      Authorization: `Bearer ${workspaceA.token}`,
      "x-workspace-id": workspaceB.workspace._id.toString()
    });

  assert.ok([403, 404].includes(response.statusCode));
});

test("my-tasks: returns only tasks assigned to the current user", async () => {
  const owner = await createWorkspaceActor();
  const teammate = await createWorkspaceActor({
    workspace: owner.workspace,
    workspaceRole: "member",
    modules: ["finance"]
  });

  await Promise.all([
    createTask(owner, { title: "Mine one", assignedTo: [owner.user], dueDate: dueDaysFromNow(3) }),
    createTask(owner, { title: "Mine two", assignedTo: [owner.user], dueDate: dueDaysFromNow(5) }),
    createTask(owner, { title: "Other task", assignedTo: [teammate.user], dueDate: dueDaysFromNow(1) })
  ]);

  const response = await request(serverEnvironment.app)
    .get("/api/tasks/my-tasks")
    .set(buildWorkspaceHeaders(owner));

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.tasks.length, 2);
  response.body.tasks.forEach((task) => {
    assert.ok(task.assignedTo.some((assignee) => assignee.id === owner.user.id));
  });
});

test("my-tasks: returns tasks sorted by dueDate ascending", async () => {
  const owner = await createWorkspaceActor();

  await Promise.all([
    createTask(owner, { title: "Later task", assignedTo: [owner.user], dueDate: dueDaysFromNow(5), priority: "low" }),
    createTask(owner, { title: "Sooner task", assignedTo: [owner.user], dueDate: dueDaysFromNow(1), priority: "urgent" }),
    createTask(owner, { title: "Middle task", assignedTo: [owner.user], dueDate: dueDaysFromNow(3), priority: "high" })
  ]);

  const response = await request(serverEnvironment.app)
    .get("/api/tasks/my-tasks")
    .set(buildWorkspaceHeaders(owner));

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.tasks.length, 3);
  const dueDates = response.body.tasks.map((task) => new Date(task.dueDate).getTime());
  assert.ok(dueDates[0] <= dueDates[1]);
  assert.ok(dueDates[1] <= dueDates[2]);
  assert.equal(response.body.tasks[0].title, "Sooner task");
});

test("my-tasks: returns empty array when no tasks are assigned", async () => {
  const owner = await createWorkspaceActor();
  await createTask(owner, { title: "Someone else owns this", dueDate: dueDaysFromNow(2) });

  const response = await request(serverEnvironment.app)
    .get("/api/tasks/my-tasks")
    .set(buildWorkspaceHeaders(owner));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.tasks, []);
});

test("my-tasks: requires authentication", async () => {
  const response = await request(serverEnvironment.app)
    .get("/api/tasks/my-tasks");

  assert.equal(response.statusCode, 401);
});

test("overdue tasks: returns only overdue incomplete tasks", async () => {
  const owner = await createWorkspaceActor();

  await Promise.all([
    createTask(owner, { title: "Overdue active", dueDate: dueDaysFromNow(-2), status: "doing" }),
    createTask(owner, { title: "Overdue completed", dueDate: dueDaysFromNow(-3), status: "done", completedAt: new Date() }),
    createTask(owner, { title: "Future task", dueDate: dueDaysFromNow(2), status: "todo" })
  ]);

  const response = await request(serverEnvironment.app)
    .get("/api/tasks/overdue")
    .set(buildWorkspaceHeaders(owner));

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.tasks.length, 1);
  assert.equal(response.body.tasks[0].title, "Overdue active");
});

test("overdue tasks: does not return completed overdue tasks", async () => {
  const owner = await createWorkspaceActor();
  await createTask(owner, {
    title: "Completed overdue task",
    dueDate: dueDaysFromNow(-4),
    status: "done",
    completedAt: new Date()
  });

  const response = await request(serverEnvironment.app)
    .get("/api/tasks/overdue")
    .set(buildWorkspaceHeaders(owner));

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.tasks.some((task) => task.title === "Completed overdue task"), false);
});

test("overdue tasks: returns empty array when no overdue tasks exist", async () => {
  const owner = await createWorkspaceActor();
  await createTask(owner, {
    title: "Future task only",
    dueDate: dueDaysFromNow(4),
    status: "todo"
  });

  const response = await request(serverEnvironment.app)
    .get("/api/tasks/overdue")
    .set(buildWorkspaceHeaders(owner));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.tasks, []);
});

test("overdue tasks: requires authentication", async () => {
  const response = await request(serverEnvironment.app)
    .get("/api/tasks/overdue");

  assert.equal(response.statusCode, 401);
});
