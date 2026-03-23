import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import request from "supertest";

import { createServerEnvironment } from "../src/app.js";
import { connectDB } from "../src/config/db.js";
import { AuditLog } from "../src/models/AuditLog.js";
import { ExpenseRecord } from "../src/models/ExpenseRecord.js";
import { FinanceActionLog } from "../src/models/FinanceActionLog.js";
import { JournalEntry } from "../src/models/JournalEntry.js";
import { Workspace } from "../src/models/Workspace.js";
import { WorkspaceMembership } from "../src/models/WorkspaceMembership.js";

let mongoServer;
let serverEnvironment;

async function registerUser(user) {
  const response = await request(serverEnvironment.app).post("/api/auth/register").send(user);
  assert.equal(response.statusCode, 201);
  return response.body;
}

async function createFinanceWorkspaceActor({
  accountingEnabled = false,
  workspace = null,
  workspaceRole = workspace ? "member" : "owner",
  financeRoles = ["viewer", "approver", "finance_staff"],
  modules = ["finance"]
} = {}) {
  const registered = await registerUser({
    name: `Expense Workflow ${workspaceRole}`,
    email: `expense-workflow-${crypto.randomUUID()}@example.com`,
    password: "password1"
  });

  const activeWorkspace =
    workspace ||
    (await Workspace.create({
      name: `Expense Workflow ${crypto.randomUUID().slice(0, 8)}`,
      slug: `expense-workflow-${crypto.randomUUID().slice(0, 8)}`,
      ownerUserId: registered.user.id,
      accountingEnabled,
      accountingEnabledAt: accountingEnabled ? new Date(Date.now() - 60_000) : null,
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

function buildFinanceHeaders(context) {
  return {
    Authorization: `Bearer ${context.token}`,
    "x-workspace-id": context.workspace._id.toString()
  };
}

async function createExpense(context, overrides = {}) {
  return ExpenseRecord.create({
    workspaceId: context.workspace._id,
    amount: overrides.amount ?? 125,
    currency: overrides.currency || "USD",
    category: overrides.category || "travel",
    vendorName: overrides.vendorName || "QA Vendor",
    vendorEmail: overrides.vendorEmail || "qa-vendor@example.com",
    expenseDate: overrides.expenseDate || new Date(Date.now() - 24 * 60 * 60 * 1000),
    note: overrides.note || "Expense workflow test record",
    status: overrides.status || "pending_review",
    createdBy: context.user.id,
    approvedBy: overrides.approvedBy ?? null,
    approvedAt: overrides.approvedAt ?? null,
    rejectedBy: overrides.rejectedBy ?? null,
    rejectedAt: overrides.rejectedAt ?? null,
    rejectionReason: overrides.rejectionReason ?? "",
    reimbursedBy: overrides.reimbursedBy ?? null,
    reimbursedAt: overrides.reimbursedAt ?? null,
    reimbursement: overrides.reimbursement || { method: "", reference: "", note: "" },
    reconciledBy: overrides.reconciledBy ?? null,
    createdAt: overrides.createdAt || new Date(Date.now() - 24 * 60 * 60 * 1000),
    updatedAt: overrides.updatedAt || new Date(Date.now() - 12 * 60 * 60 * 1000)
  });
}

async function approveExpense(context, expenseId) {
  return request(serverEnvironment.app)
    .patch(`/api/finance/expenses/${expenseId}/approve`)
    .set(buildFinanceHeaders(context))
    .send({});
}

async function rejectExpense(context, expenseId, payload = {}) {
  return request(serverEnvironment.app)
    .patch(`/api/finance/expenses/${expenseId}/reject`)
    .set(buildFinanceHeaders(context))
    .send(payload);
}

async function reimburseExpense(context, expenseId, payload = {}) {
  return request(serverEnvironment.app)
    .patch(`/api/finance/expenses/${expenseId}/reimburse`)
    .set(buildFinanceHeaders(context))
    .send(payload);
}

async function reconcileExpense(context, expenseId) {
  return request(serverEnvironment.app)
    .patch(`/api/finance/expenses/${expenseId}/reconcile`)
    .set(buildFinanceHeaders(context))
    .send({});
}

async function findExpense(expenseId) {
  return ExpenseRecord.findById(expenseId).lean();
}

async function findExpenseJournals(workspaceId, expenseId) {
  return JournalEntry.find({
    workspaceId,
    sourceType: "expense",
    sourceId: expenseId
  })
    .sort({ createdAt: 1 })
    .lean();
}

async function findExpenseActionLogs(workspaceId, expenseId) {
  return FinanceActionLog.find({
    workspaceId,
    itemType: "expense",
    itemId: expenseId
  })
    .sort({ createdAt: 1 })
    .lean();
}

async function findExpenseAuditLogs(expenseId) {
  return AuditLog.find({
    targetType: "ExpenseRecord",
    targetId: expenseId.toString()
  })
    .sort({ createdAt: 1 })
    .lean();
}

function assertBalancedJournal(entry, amount) {
  assert.ok(entry, "expected a journal entry");
  assert.equal(entry.status, "posted");
  assert.equal(Number(entry.totalDebit || 0), amount);
  assert.equal(Number(entry.totalCredit || 0), amount);

  const debitTotal = (entry.lines || []).reduce((sum, line) => sum + Number(line.debit || 0), 0);
  const creditTotal = (entry.lines || []).reduce((sum, line) => sum + Number(line.credit || 0), 0);
  assert.equal(debitTotal, amount);
  assert.equal(creditTotal, amount);
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

test("expense approve: valid approval from pending_review sets status and approval actor fields", async () => {
  const manager = await createFinanceWorkspaceActor();
  const expense = await createExpense(manager, { status: "pending_review" });

  const response = await approveExpense(manager, expense._id.toString());

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, "approved");
  assert.equal(response.body.approvedBy?.id, manager.user.id);
  assert.ok(response.body.approvedAt);

  const savedExpense = await findExpense(expense._id);
  assert.equal(savedExpense.status, "approved");
  assert.equal(savedExpense.approvedBy?.toString(), manager.user.id);
  assert.ok(savedExpense.approvedAt);
});

test("expense approve: staff without manager access receives 403", async () => {
  const owner = await createFinanceWorkspaceActor();
  const staff = await createFinanceWorkspaceActor({
    workspace: owner.workspace,
    workspaceRole: "member",
    financeRoles: ["viewer", "finance_staff"]
  });
  const expense = await createExpense(owner, { status: "pending_review" });

  const response = await approveExpense(staff, expense._id.toString());

  assert.equal(response.statusCode, 403);
});

test("expense approve: already approved expense returns 409 transition error", async () => {
  const manager = await createFinanceWorkspaceActor();
  const expense = await createExpense(manager, {
    status: "approved",
    approvedBy: new mongoose.Types.ObjectId(manager.user.id),
    approvedAt: new Date()
  });

  const response = await approveExpense(manager, expense._id.toString());

  assert.equal(response.statusCode, 409);
  assert.match(response.body.message, /transition/i);
});

test("expense approve: reconciled expense returns 409", async () => {
  const manager = await createFinanceWorkspaceActor();
  const expense = await createExpense(manager, {
    status: "reconciled",
    approvedBy: new mongoose.Types.ObjectId(manager.user.id),
    approvedAt: new Date(),
    reimbursedBy: new mongoose.Types.ObjectId(manager.user.id),
    reimbursedAt: new Date(),
    reconciledBy: new mongoose.Types.ObjectId(manager.user.id)
  });

  const response = await approveExpense(manager, expense._id.toString());

  assert.equal(response.statusCode, 409);
  assert.match(response.body.message, /transition/i);
});

test("expense approve: missing expense returns 404", async () => {
  const manager = await createFinanceWorkspaceActor();

  const response = await approveExpense(manager, new mongoose.Types.ObjectId().toString());

  assert.equal(response.statusCode, 404);
  assert.equal(response.body.message, "Expense not found.");
});

test("expense approve: expense from another workspace returns 404", async () => {
  const workspaceA = await createFinanceWorkspaceActor();
  const workspaceB = await createFinanceWorkspaceActor();
  const expense = await createExpense(workspaceA, { status: "pending_review" });

  const response = await approveExpense(workspaceB, expense._id.toString());

  assert.equal(response.statusCode, 404);
  assert.equal(response.body.message, "Expense not found.");
});

test("expense reject: valid rejection from pending_review stores actor, timestamp, and reason", async () => {
  const manager = await createFinanceWorkspaceActor();
  const expense = await createExpense(manager, { status: "pending_review" });

  const response = await rejectExpense(manager, expense._id.toString(), {
    rejectionReason: "Missing receipt support"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, "rejected");
  assert.equal(response.body.rejectedBy?.id, manager.user.id);
  assert.ok(response.body.rejectedAt);
  assert.equal(response.body.rejectionReason, "Missing receipt support");

  const savedExpense = await findExpense(expense._id);
  assert.equal(savedExpense.status, "rejected");
  assert.equal(savedExpense.rejectedBy?.toString(), manager.user.id);
  assert.equal(savedExpense.rejectionReason, "Missing receipt support");
  assert.ok(savedExpense.rejectedAt);
});

test("expense reject: valid rejection from approved succeeds", async () => {
  const manager = await createFinanceWorkspaceActor();
  const expense = await createExpense(manager, {
    status: "approved",
    approvedBy: new mongoose.Types.ObjectId(manager.user.id),
    approvedAt: new Date()
  });

  const response = await rejectExpense(manager, expense._id.toString(), {
    rejectionReason: "Vendor information is incomplete"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, "rejected");
  assert.equal(response.body.rejectionReason, "Vendor information is incomplete");
});

test("expense reject: missing rejection reason returns 400", async () => {
  const manager = await createFinanceWorkspaceActor();
  const expense = await createExpense(manager, { status: "pending_review" });

  const response = await rejectExpense(manager, expense._id.toString(), {});

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.message, "Rejection reason is required.");

  const savedExpense = await findExpense(expense._id);
  assert.equal(savedExpense.status, "pending_review");
});

test("expense reject: staff without manager access receives 403", async () => {
  const owner = await createFinanceWorkspaceActor();
  const staff = await createFinanceWorkspaceActor({
    workspace: owner.workspace,
    workspaceRole: "member",
    financeRoles: ["viewer", "finance_staff"]
  });
  const expense = await createExpense(owner, { status: "pending_review" });

  const response = await rejectExpense(staff, expense._id.toString(), {
    rejectionReason: "Not allowed"
  });

  assert.equal(response.statusCode, 403);
});

test("expense reject: reconciled expense returns 409", async () => {
  const manager = await createFinanceWorkspaceActor();
  const expense = await createExpense(manager, {
    status: "reconciled",
    approvedBy: new mongoose.Types.ObjectId(manager.user.id),
    approvedAt: new Date(),
    reimbursedBy: new mongoose.Types.ObjectId(manager.user.id),
    reimbursedAt: new Date(),
    reconciledBy: new mongoose.Types.ObjectId(manager.user.id)
  });

  const response = await rejectExpense(manager, expense._id.toString(), {
    rejectionReason: "Too late"
  });

  assert.equal(response.statusCode, 409);
  assert.match(response.body.message, /transition/i);
});

test("expense reject: reimbursed expense returns 409", async () => {
  const manager = await createFinanceWorkspaceActor();
  const expense = await createExpense(manager, {
    status: "reimbursed",
    approvedBy: new mongoose.Types.ObjectId(manager.user.id),
    approvedAt: new Date(),
    reimbursedBy: new mongoose.Types.ObjectId(manager.user.id),
    reimbursedAt: new Date(),
    reimbursement: {
      method: "bank_transfer",
      reference: "RB-100",
      note: ""
    }
  });

  const response = await rejectExpense(manager, expense._id.toString(), {
    rejectionReason: "Already reimbursed"
  });

  assert.equal(response.statusCode, 409);
  assert.match(response.body.message, /transition/i);
});

test("expense reimburse: valid reimbursement from approved stores actor and payment metadata", async () => {
  const owner = await createFinanceWorkspaceActor();
  const staff = await createFinanceWorkspaceActor({
    workspace: owner.workspace,
    workspaceRole: "member",
    financeRoles: ["viewer", "finance_staff"]
  });
  const expense = await createExpense(owner, {
    status: "approved",
    approvedBy: new mongoose.Types.ObjectId(owner.user.id),
    approvedAt: new Date()
  });

  const response = await reimburseExpense(staff, expense._id.toString(), {
    method: "bank_transfer",
    reference: "SETTLE-001",
    note: "Settled through bank"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, "reimbursed");
  assert.equal(response.body.reimbursedBy?.id, staff.user.id);
  assert.ok(response.body.reimbursedAt);
  assert.equal(response.body.reimbursement?.method, "bank_transfer");
  assert.equal(response.body.reimbursement?.reference, "SETTLE-001");

  const savedExpense = await findExpense(expense._id);
  assert.equal(savedExpense.status, "reimbursed");
  assert.equal(savedExpense.reimbursedBy?.toString(), staff.user.id);
  assert.equal(savedExpense.reimbursement?.method, "bank_transfer");
  assert.equal(savedExpense.reimbursement?.reference, "SETTLE-001");
  assert.equal(savedExpense.reimbursement?.note, "Settled through bank");
});

test("expense reimburse: valid reimbursement without optional fields succeeds", async () => {
  const owner = await createFinanceWorkspaceActor();
  const staff = await createFinanceWorkspaceActor({
    workspace: owner.workspace,
    workspaceRole: "member",
    financeRoles: ["viewer", "finance_staff"]
  });
  const expense = await createExpense(owner, {
    status: "approved",
    approvedBy: new mongoose.Types.ObjectId(owner.user.id),
    approvedAt: new Date()
  });

  const response = await reimburseExpense(staff, expense._id.toString());

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, "reimbursed");
  assert.equal(response.body.reimbursement?.method, "");
  assert.equal(response.body.reimbursement?.reference, "");
  assert.equal(response.body.reimbursement?.note, "");
});

test("expense reimburse: viewer without finance staff access receives 403", async () => {
  const owner = await createFinanceWorkspaceActor();
  const viewer = await createFinanceWorkspaceActor({
    workspace: owner.workspace,
    workspaceRole: "member",
    financeRoles: ["viewer"]
  });
  const expense = await createExpense(owner, {
    status: "approved",
    approvedBy: new mongoose.Types.ObjectId(owner.user.id),
    approvedAt: new Date()
  });

  const response = await reimburseExpense(viewer, expense._id.toString(), {
    method: "cash"
  });

  assert.equal(response.statusCode, 403);
});

test("expense reimburse: pending_review expense returns 409", async () => {
  const owner = await createFinanceWorkspaceActor();
  const staff = await createFinanceWorkspaceActor({
    workspace: owner.workspace,
    workspaceRole: "member",
    financeRoles: ["viewer", "finance_staff"]
  });
  const expense = await createExpense(owner, { status: "pending_review" });

  const response = await reimburseExpense(staff, expense._id.toString(), {
    method: "cash"
  });

  assert.equal(response.statusCode, 409);
  assert.match(response.body.message, /transition/i);
});

test("expense reimburse: reconciled expense returns 409", async () => {
  const owner = await createFinanceWorkspaceActor();
  const staff = await createFinanceWorkspaceActor({
    workspace: owner.workspace,
    workspaceRole: "member",
    financeRoles: ["viewer", "finance_staff"]
  });
  const expense = await createExpense(owner, {
    status: "reconciled",
    approvedBy: new mongoose.Types.ObjectId(owner.user.id),
    approvedAt: new Date(),
    reimbursedBy: new mongoose.Types.ObjectId(staff.user.id),
    reimbursedAt: new Date(),
    reconciledBy: new mongoose.Types.ObjectId(staff.user.id)
  });

  const response = await reimburseExpense(staff, expense._id.toString(), {
    method: "cash"
  });

  assert.equal(response.statusCode, 409);
  assert.match(response.body.message, /transition/i);
});

test("expense reimburse: missing expense returns 404", async () => {
  const owner = await createFinanceWorkspaceActor();
  const staff = await createFinanceWorkspaceActor({
    workspace: owner.workspace,
    workspaceRole: "member",
    financeRoles: ["viewer", "finance_staff"]
  });

  const response = await reimburseExpense(staff, new mongoose.Types.ObjectId().toString(), {
    method: "cash"
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.body.message, "Expense not found.");
});

test("expense accounting sync: approve creates accrual journal when accounting is enabled", async () => {
  const manager = await createFinanceWorkspaceActor({ accountingEnabled: true });
  const expense = await createExpense(manager, {
    status: "pending_review",
    amount: 275,
    category: "travel"
  });

  const response = await approveExpense(manager, expense._id.toString());

  assert.equal(response.statusCode, 200);

  const journals = await findExpenseJournals(manager.workspace._id, expense._id);
  assert.equal(journals.length, 1);
  assert.equal(journals[0].entryType, "expense_accrual");
  assertBalancedJournal(journals[0], 275);
  assert.equal(journals[0].lines[0].accountCode, "5100");
  assert.equal(journals[0].lines[0].debit, 275);
  assert.equal(journals[0].lines[1].accountCode, "2000");
  assert.equal(journals[0].lines[1].credit, 275);
});

test("expense accounting sync: reimburse creates settlement journal when accounting is enabled", async () => {
  const owner = await createFinanceWorkspaceActor({ accountingEnabled: true });
  const staff = await createFinanceWorkspaceActor({
    workspace: owner.workspace,
    workspaceRole: "member",
    financeRoles: ["viewer", "finance_staff"]
  });
  const expense = await createExpense(owner, {
    status: "approved",
    amount: 310,
    category: "travel",
    approvedBy: new mongoose.Types.ObjectId(owner.user.id),
    approvedAt: new Date()
  });

  const response = await reimburseExpense(staff, expense._id.toString(), {
    method: "bank_transfer",
    reference: "RB-310"
  });

  assert.equal(response.statusCode, 200);

  const journals = await findExpenseJournals(owner.workspace._id, expense._id);
  const settlementEntry = journals.find((entry) => entry.entryType === "expense_payment");

  assert.ok(settlementEntry, "expected a settlement journal entry");
  assertBalancedJournal(settlementEntry, 310);
  assert.equal(settlementEntry.lines[0].accountCode, "2000");
  assert.equal(settlementEntry.lines[0].debit, 310);
  assert.equal(settlementEntry.lines[1].accountCode, "1000");
  assert.equal(settlementEntry.lines[1].credit, 310);
});

test("expense accounting sync: reject does not create journals when accounting is enabled", async () => {
  const manager = await createFinanceWorkspaceActor({ accountingEnabled: true });
  const expense = await createExpense(manager, {
    status: "pending_review",
    amount: 180
  });

  const response = await rejectExpense(manager, expense._id.toString(), {
    rejectionReason: "Need a corrected amount"
  });

  assert.equal(response.statusCode, 200);

  const journals = await findExpenseJournals(manager.workspace._id, expense._id);
  assert.equal(journals.length, 0);
});

test("expense lifecycle: pending_review -> approved -> reimbursed -> reconciled stores actors and logs", async () => {
  const owner = await createFinanceWorkspaceActor({ accountingEnabled: true });
  const staff = await createFinanceWorkspaceActor({
    workspace: owner.workspace,
    workspaceRole: "member",
    financeRoles: ["viewer", "finance_staff"]
  });
  const expense = await createExpense(owner, {
    status: "pending_review",
    amount: 420
  });

  const approveResponse = await approveExpense(owner, expense._id.toString());
  assert.equal(approveResponse.statusCode, 200);
  assert.equal(approveResponse.body.status, "approved");

  const reimburseResponse = await reimburseExpense(staff, expense._id.toString(), {
    method: "bank_transfer",
    reference: "LIFE-420"
  });
  assert.equal(reimburseResponse.statusCode, 200);
  assert.equal(reimburseResponse.body.status, "reimbursed");

  const reconcileResponse = await reconcileExpense(staff, expense._id.toString());
  assert.equal(reconcileResponse.statusCode, 200);
  assert.equal(reconcileResponse.body.status, "reconciled");

  const savedExpense = await findExpense(expense._id);
  assert.equal(savedExpense.status, "reconciled");
  assert.equal(savedExpense.approvedBy?.toString(), owner.user.id);
  assert.equal(savedExpense.reimbursedBy?.toString(), staff.user.id);
  assert.equal(savedExpense.reconciledBy?.toString(), staff.user.id);

  const actions = await findExpenseActionLogs(owner.workspace._id, expense._id);
  assert.deepEqual(
    actions.map((action) => action.action),
    ["approved", "reimbursed", "reconciled"]
  );

  const audits = await findExpenseAuditLogs(expense._id);
  assert.deepEqual(
    audits.map((entry) => entry.action),
    ["finance.expense.approve", "finance.expense.reimburse", "finance.expense.reconcile"]
  );
});

test("expense reject after approve: approved expense can still be rejected with reason", async () => {
  const manager = await createFinanceWorkspaceActor();
  const expense = await createExpense(manager, { status: "pending_review" });

  const approveResponse = await approveExpense(manager, expense._id.toString());
  assert.equal(approveResponse.statusCode, 200);

  const rejectResponse = await rejectExpense(manager, expense._id.toString(), {
    rejectionReason: "Budget was withdrawn"
  });

  assert.equal(rejectResponse.statusCode, 200);
  assert.equal(rejectResponse.body.status, "rejected");
  assert.equal(rejectResponse.body.rejectionReason, "Budget was withdrawn");

  const savedExpense = await findExpense(expense._id);
  assert.equal(savedExpense.status, "rejected");
  assert.equal(savedExpense.rejectionReason, "Budget was withdrawn");
});
