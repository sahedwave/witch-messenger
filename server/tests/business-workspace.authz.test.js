import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";

import { connectDB } from "../src/config/db.js";
import { User } from "../src/models/User.js";
import { createSessionId, signToken } from "../src/utils/token.js";

const WORKSPACE_A = "workspace-a";
const WORKSPACE_B = "workspace-b";

let mongoServer;
let app;
let prismaBackups;
let invoiceStubs;
let expenseStubs;
let prisma;

async function loadRouteRouter(routeRelativePath) {
  const routePath = path.resolve(process.cwd(), routeRelativePath);
  const tempPath = path.join(
    path.dirname(routePath),
    `.__authz-${path.basename(routePath, ".js")}-${process.pid}.mjs`
  );

  const source = await fs.readFile(routePath, "utf8");
  const rewritten = source
    .replace(
      'import { prisma } from "../lib/prisma.js";',
      "const prisma = globalThis.__businessWorkspaceTestPrisma;"
    );

  await fs.writeFile(tempPath, rewritten, "utf8");
  const module = await import(`${pathToFileURL(tempPath).href}?t=${Date.now()}`);
  await fs.unlink(tempPath).catch(() => null);
  return module.default;
}

function createAsyncStub(impl = async () => null) {
  const stub = async (...args) => {
    stub.calls.push(args);
    return impl(...args);
  };

  stub.calls = [];
  stub.setImpl = (nextImpl) => {
    impl = nextImpl;
  };

  return stub;
}

function installPrismaStubs() {
  prisma = globalThis.__businessWorkspaceTestPrisma;
  prismaBackups = {
    invoice: {
      findMany: prisma.invoice.findMany,
      create: prisma.invoice.create,
      aggregate: prisma.invoice.aggregate,
      count: prisma.invoice.count,
      findUnique: prisma.invoice.findUnique,
      update: prisma.invoice.update,
      delete: prisma.invoice.delete
    },
    expense: {
      findMany: prisma.expense.findMany,
      create: prisma.expense.create,
      aggregate: prisma.expense.aggregate,
      count: prisma.expense.count,
      findUnique: prisma.expense.findUnique,
      update: prisma.expense.update,
      delete: prisma.expense.delete
    }
  };

  invoiceStubs = {
    findMany: createAsyncStub(async () => []),
    create: createAsyncStub(async ({ data }) => ({ id: crypto.randomUUID(), ...data })),
    aggregate: createAsyncStub(async () => ({ _count: { _all: 0 }, _sum: { amount: 0 } })),
    count: createAsyncStub(async () => 0),
    findUnique: createAsyncStub(async ({ where }) => (where?.id ? { id: where.id, workspaceId: WORKSPACE_A, status: "draft" } : null)),
    update: createAsyncStub(async ({ where, data }) => ({ id: where.id, workspaceId: WORKSPACE_A, ...data })),
    delete: createAsyncStub(async ({ where }) => ({ id: where.id, workspaceId: WORKSPACE_A }))
  };

  expenseStubs = {
    findMany: createAsyncStub(async () => []),
    create: createAsyncStub(async ({ data }) => ({ id: crypto.randomUUID(), ...data })),
    aggregate: createAsyncStub(async () => ({ _sum: { amount: 0 } })),
    count: createAsyncStub(async () => 0),
    findUnique: createAsyncStub(async ({ where }) => (where?.id ? { id: where.id, workspaceId: WORKSPACE_A } : null)),
    update: createAsyncStub(async ({ where, data }) => ({ id: where.id, workspaceId: WORKSPACE_A, ...data })),
    delete: createAsyncStub(async ({ where }) => ({ id: where.id, workspaceId: WORKSPACE_A }))
  };

  Object.assign(prisma.invoice, invoiceStubs);
  Object.assign(prisma.expense, expenseStubs);
}

function restorePrismaStubs() {
  if (!prismaBackups) {
    return;
  }

  Object.assign(prisma.invoice, prismaBackups.invoice);
  Object.assign(prisma.expense, prismaBackups.expense);
}

async function createAuthContext({
  emailPrefix = "business-authz",
  workspaceId = WORKSPACE_A,
  workspaceModules = ["finance"],
  workspaceRoles = ["approver", "finance_staff"],
  isAdmin = false
} = {}) {
  const user = await User.create({
    name: "Business Workspace QA",
    email: `${emailPrefix}-${crypto.randomUUID()}@example.com`,
    password: "password123",
    isAdmin,
    workspaceModules,
    workspaceRoles
  });

  const sessionId = createSessionId();
  user.registerSession({
    sessionId,
    createdAt: new Date(),
    lastSeenAt: new Date(),
    userAgent: "node-test",
    ipAddress: "127.0.0.1"
  });
  await user.save();

  return {
    user,
    workspaceId,
    token: signToken(user, sessionId)
  };
}

function buildHeaders(context, overrides = {}) {
  const headers = {
    Authorization: `Bearer ${context.token}`,
    "x-workspace-id": context.workspaceId
  };

  return { ...headers, ...overrides };
}

before(async () => {
  process.env.JWT_SECRET = "test-secret";
  process.env.NODE_ENV = "test";

  mongoServer = await MongoMemoryServer.create({
    instance: {
      ip: "127.0.0.1"
    }
  });

  await connectDB(mongoServer.getUri());

  globalThis.__businessWorkspaceTestPrisma = {
    invoice: {},
    expense: {}
  };

  const [invoiceRouter, expenseRouter] = await Promise.all([
    loadRouteRouter("src/business-workspace/routes/invoiceRoutes.js"),
    loadRouteRouter("src/business-workspace/routes/expenseRoutes.js")
  ]);

  app = express();
  app.use(express.json());
  app.use("/invoices", invoiceRouter);
  app.use("/expenses", expenseRouter);
});

beforeEach(async () => {
  await User.deleteMany({});
  installPrismaStubs();
});

after(async () => {
  restorePrismaStubs();
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
});

describe("business-workspace invoice and expense authz", () => {
  test("no token -> all invoice and expense routes return 401", async () => {
    const responses = await Promise.all([
      request(app).get("/invoices"),
      request(app).post("/invoices").send({}),
      request(app).patch("/invoices/invoice-1").send({ title: "Updated" }),
      request(app).delete("/invoices/invoice-1"),
      request(app).get("/expenses"),
      request(app).post("/expenses").send({}),
      request(app).patch("/expenses/expense-1").send({ title: "Updated" }),
      request(app).delete("/expenses/expense-1")
    ]);

    for (const response of responses) {
      assert.equal(response.statusCode, 401);
      assert.equal(response.body.message, "Authentication required.");
    }
  });

  test("[EXPECTED TO FAIL ON UNPATCHED CODEBASE] expired token returns 401 with token expired message", async () => {
    const context = await createAuthContext();
    const expiredToken = jwt.sign(
      {
        userId: context.user._id.toString(),
        sessionVersion: context.user.sessionVersion || 0,
        sessionId: createSessionId()
      },
      process.env.JWT_SECRET,
      { expiresIn: -1 }
    );

    const response = await request(app)
      .get("/invoices")
      .set(buildHeaders(context, { Authorization: `Bearer ${expiredToken}` }));

    assert.equal(response.statusCode, 401);
    assert.equal(response.body.message, "Token expired.");
  });

  test("[EXPECTED TO FAIL ON UNPATCHED CODEBASE] valid token, wrong workspace invoice resource returns 403", async () => {
    const context = await createAuthContext({ workspaceId: WORKSPACE_A });
    invoiceStubs.findUnique.setImpl(async ({ where }) => ({
      id: where.id,
      workspaceId: WORKSPACE_B,
      status: "draft"
    }));

    const response = await request(app)
      .get("/invoices/invoice-b")
      .set(buildHeaders(context));

    assert.equal(response.statusCode, 403);
    assert.equal(response.body.message, "Forbidden.");
    assert.equal(invoiceStubs.update.calls.length, 0);
    assert.equal(invoiceStubs.delete.calls.length, 0);
  });

  test("[EXPECTED TO FAIL ON UNPATCHED CODEBASE] valid token, wrong workspace expense resource returns 403", async () => {
    const context = await createAuthContext({ workspaceId: WORKSPACE_A });
    expenseStubs.findUnique.setImpl(async ({ where }) => ({
      id: where.id,
      workspaceId: WORKSPACE_B
    }));

    const response = await request(app)
      .patch("/expenses/expense-b")
      .set(buildHeaders(context))
      .send({ title: "Nope" });

    assert.equal(response.statusCode, 403);
    assert.equal(response.body.message, "Forbidden.");
    assert.equal(expenseStubs.update.calls.length, 0);
  });

  test("[EXPECTED TO FAIL ON UNPATCHED CODEBASE] finance viewer cannot POST/PATCH/DELETE invoices", async () => {
    const context = await createAuthContext({
      workspaceRoles: ["viewer"]
    });

    const responses = await Promise.all([
      request(app)
        .post("/invoices")
        .set(buildHeaders(context))
        .send({
          title: "Viewer invoice",
          customerId: "customer-1",
          amount: 100,
          currency: "USD",
          dueDate: "2026-04-01"
        }),
      request(app)
        .patch("/invoices/invoice-1")
        .set(buildHeaders(context))
        .send({ title: "Viewer patch" }),
      request(app)
        .delete("/invoices/invoice-1")
        .set(buildHeaders(context))
    ]);

    for (const response of responses) {
      assert.equal(response.statusCode, 403);
      assert.equal(response.body.message, "Finance workspace access is required.");
    }
  });

  test("[EXPECTED TO FAIL ON UNPATCHED CODEBASE] finance viewer cannot POST/PATCH/DELETE expenses", async () => {
    const context = await createAuthContext({
      workspaceRoles: ["viewer"]
    });

    const responses = await Promise.all([
      request(app)
        .post("/expenses")
        .set(buildHeaders(context))
        .send({
          title: "Viewer expense",
          vendorId: "vendor-1",
          amount: 100,
          currency: "USD",
          category: "supplies",
          date: "2026-04-01"
        }),
      request(app)
        .patch("/expenses/expense-1")
        .set(buildHeaders(context))
        .send({ title: "Viewer patch" }),
      request(app)
        .delete("/expenses/expense-1")
        .set(buildHeaders(context))
    ]);

    for (const response of responses) {
      assert.equal(response.statusCode, 403);
      assert.equal(response.body.message, "Finance workspace access is required.");
    }
  });

  test("[EXPECTED TO FAIL ON UNPATCHED CODEBASE] invoice POST ignores extra fields and uses auth workspace", async () => {
    const context = await createAuthContext();

    const response = await request(app)
      .post("/invoices")
      .set(buildHeaders(context))
      .send({
        title: "Invoice Alpha",
        customerId: "customer-1",
        amount: 100,
        currency: "USD",
        dueDate: "2026-04-01",
        lineItems: [{ description: "Consulting", amount: 100 }],
        notes: "Important",
        status: "paid",
        _id: "injected-id",
        workspaceId: "other-workspace",
        createdAt: "2020-01-01T00:00:00.000Z"
      });

    assert.equal(response.statusCode, 201);
    assert.equal(invoiceStubs.create.calls.length, 1);

    const createArg = invoiceStubs.create.calls[0][0];
    assert.deepEqual(Object.keys(createArg.data).sort(), [
      "amount",
      "createdById",
      "currency",
      "dueDate",
      "lineItems",
      "notes",
      "status",
      "title",
      "workspaceId",
      "customerId"
    ].sort());
    assert.equal(createArg.data.status, "draft");
    assert.equal(createArg.data.workspaceId, context.workspaceId);
    assert.notEqual(response.body.id, "injected-id");
    assert.equal(createArg.data._id, undefined);
    assert.equal(createArg.data.createdAt, undefined);
  });

  test("[EXPECTED TO FAIL ON UNPATCHED CODEBASE] invoice PATCH ignores privilege escalation fields", async () => {
    const context = await createAuthContext();

    invoiceStubs.findUnique.setImpl(async ({ where }) => ({
      id: where.id,
      workspaceId: context.workspaceId,
      status: "draft"
    }));

    const response = await request(app)
      .patch("/invoices/invoice-1")
      .set(buildHeaders(context))
      .send({
        title: "Updated title",
        role: "admin",
        accountingEnabled: true
      });

    assert.equal(response.statusCode, 200);
    assert.equal(invoiceStubs.update.calls.length, 1);
    const updateArg = invoiceStubs.update.calls[0][0];
    assert.equal(updateArg.data.title, "Updated title");
    assert.equal(updateArg.data.role, undefined);
    assert.equal(updateArg.data.accountingEnabled, undefined);
  });

  test("[EXPECTED TO FAIL ON UNPATCHED CODEBASE] invoice POST rejects object injection payloads", async () => {
    const context = await createAuthContext();

    const response = await request(app)
      .post("/invoices")
      .set(buildHeaders(context))
      .send({
        title: "Injected",
        customerId: "customer-1",
        amount: { $gt: 0 },
        currency: "USD",
        dueDate: "2026-04-01",
        status: { $ne: "draft" }
      });

    assert.equal(response.statusCode, 400);
    assert.equal(invoiceStubs.create.calls.length, 0);
  });

  test("[EXPECTED TO FAIL ON UNPATCHED CODEBASE] invoice DTO whitelist accepts only allowed fields", async () => {
    const context = await createAuthContext();

    await request(app)
      .post("/invoices")
      .set(buildHeaders(context))
      .send({
        title: "Whitelist invoice",
        customerId: "customer-1",
        amount: 120,
        currency: "USD",
        dueDate: "2026-04-02",
        lineItems: [{ description: "Line", amount: 120 }],
        notes: "Allowed",
        unexpected: "remove me"
      });

    const createArg = invoiceStubs.create.calls[0][0];
    assert.deepEqual(Object.keys(createArg.data).sort(), [
      "amount",
      "createdById",
      "currency",
      "dueDate",
      "lineItems",
      "notes",
      "status",
      "title",
      "workspaceId",
      "customerId"
    ].sort());
    assert.equal(createArg.data.unexpected, undefined);
  });

  test("[EXPECTED TO FAIL ON UNPATCHED CODEBASE] expense POST ignores extra fields and uses auth workspace", async () => {
    const context = await createAuthContext();

    const response = await request(app)
      .post("/expenses")
      .set(buildHeaders(context))
      .send({
        title: "Expense Alpha",
        vendorId: "vendor-1",
        amount: 55,
        currency: "USD",
        category: "supplies",
        date: "2026-04-01",
        notes: "Office supplies",
        workspaceId: "other-workspace",
        createdAt: "2020-01-01T00:00:00.000Z",
        accountingEnabled: true
      });

    assert.equal(response.statusCode, 201);
    assert.equal(expenseStubs.create.calls.length, 1);
    const createArg = expenseStubs.create.calls[0][0];
    assert.deepEqual(Object.keys(createArg.data).sort(), [
      "amount",
      "category",
      "currency",
      "date",
      "loggedById",
      "notes",
      "title",
      "vendorId",
      "workspaceId"
    ].sort());
    assert.equal(createArg.data.workspaceId, context.workspaceId);
    assert.equal(createArg.data.accountingEnabled, undefined);
    assert.equal(createArg.data.createdAt, undefined);
  });

  test("[EXPECTED TO FAIL ON UNPATCHED CODEBASE] expense PATCH ignores privilege escalation fields", async () => {
    const context = await createAuthContext();

    expenseStubs.findUnique.setImpl(async ({ where }) => ({
      id: where.id,
      workspaceId: context.workspaceId
    }));

    const response = await request(app)
      .patch("/expenses/expense-1")
      .set(buildHeaders(context))
      .send({
        title: "Updated expense",
        role: "admin",
        accountingEnabled: true
      });

    assert.equal(response.statusCode, 200);
    assert.equal(expenseStubs.update.calls.length, 1);
    const updateArg = expenseStubs.update.calls[0][0];
    assert.equal(updateArg.data.title, "Updated expense");
    assert.equal(updateArg.data.role, undefined);
    assert.equal(updateArg.data.accountingEnabled, undefined);
  });

  test("[EXPECTED TO FAIL ON UNPATCHED CODEBASE] expense POST rejects object injection payloads", async () => {
    const context = await createAuthContext();

    const response = await request(app)
      .post("/expenses")
      .set(buildHeaders(context))
      .send({
        title: "Injected expense",
        vendorId: "vendor-1",
        amount: { $gt: 0 },
        currency: "USD",
        category: { $ne: "other" },
        date: "2026-04-01"
      });

    assert.equal(response.statusCode, 400);
    assert.equal(expenseStubs.create.calls.length, 0);
  });

  test("[EXPECTED TO FAIL ON UNPATCHED CODEBASE] expense DTO whitelist accepts only allowed fields", async () => {
    const context = await createAuthContext();

    await request(app)
      .post("/expenses")
      .set(buildHeaders(context))
      .send({
        title: "Whitelist expense",
        vendorId: "vendor-1",
        amount: 75,
        currency: "USD",
        category: "travel",
        date: "2026-04-02",
        notes: "Allowed",
        unexpected: "remove me"
      });

    const createArg = expenseStubs.create.calls[0][0];
    assert.deepEqual(Object.keys(createArg.data).sort(), [
      "amount",
      "category",
      "currency",
      "date",
      "loggedById",
      "notes",
      "title",
      "vendorId",
      "workspaceId"
    ].sort());
    assert.equal(createArg.data.unexpected, undefined);
  });
});
