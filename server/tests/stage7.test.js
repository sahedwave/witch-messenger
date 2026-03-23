import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import request from "supertest";

import { createServerEnvironment } from "../src/app.js";
import { connectDB } from "../src/config/db.js";
import { ExpenseRecord } from "../src/models/ExpenseRecord.js";
import { Workspace } from "../src/models/Workspace.js";
import { WorkspaceMembership } from "../src/models/WorkspaceMembership.js";
import { STATIC_EXCHANGE_RATES, clearLiveRates } from "../src/utils/currency.js";
import { fetchLiveRates, getCachedRates } from "../src/services/fxRateService.js";

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
  modules = ["finance", "warehouse"],
  accountingEnabled = false,
  defaultCurrency = "USD"
} = {}) {
  const registered = await registerUser({
    name: `Stage7 ${workspaceRole}`,
    email: `stage7-${crypto.randomUUID()}@example.com`,
    password: "password1"
  });

  const activeWorkspace =
    workspace ||
    (await Workspace.create({
      name: `Stage 7 ${crypto.randomUUID().slice(0, 8)}`,
      slug: `stage-7-${crypto.randomUUID().slice(0, 8)}`,
      ownerUserId: registered.user.id,
      accountingEnabled,
      accountingEnabledAt: accountingEnabled ? new Date(Date.now() - 60_000) : null,
      defaultCurrency,
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

function buildHeaders(context) {
  return {
    Authorization: `Bearer ${context.token}`,
    "x-workspace-id": context.workspace._id.toString()
  };
}

function uniqueInvoiceNumber() {
  return `INV-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function addDays(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function createInvoiceViaApi(context, payload = {}) {
  return request(serverEnvironment.app)
    .post("/api/finance/invoices")
    .set(buildHeaders(context))
    .send({
      invoiceNumber: uniqueInvoiceNumber(),
      customerName: "Stage 7 Customer",
      customerEmail: "customer@example.com",
      amount: 100,
      currency: "USD",
      dueDate: addDays(7).toISOString(),
      ...payload
    });
}

async function createBankAccountViaApi(context, payload = {}) {
  return request(serverEnvironment.app)
    .post("/api/finance/bank-accounts")
    .set(buildHeaders(context))
    .send({
      accountName: "Stage 7 Checking",
      accountType: "checking",
      currency: context.workspace.defaultCurrency || "USD",
      currentBalance: 0,
      ...payload
    });
}

async function createPayrollViaApi(context, payload = {}) {
  return request(serverEnvironment.app)
    .post("/api/finance/payroll")
    .set(buildHeaders(context))
    .send({
      employeeName: "Ava Stone",
      employeeId: `EMP-${crypto.randomUUID().slice(0, 8)}`,
      payPeriodStart: new Date("2026-03-01T00:00:00.000Z").toISOString(),
      payPeriodEnd: new Date("2026-03-15T00:00:00.000Z").toISOString(),
      grossAmount: 1200,
      deductions: [
        { label: "Tax", amount: 120 },
        { label: "Insurance", amount: 30 }
      ],
      currency: context.workspace.defaultCurrency || "USD",
      ...payload
    });
}

function mockFetchOnce(implementation) {
  const originalFetch = global.fetch;
  global.fetch = implementation;
  return () => {
    global.fetch = originalFetch;
    clearLiveRates();
  };
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
  clearLiveRates();
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

test("stage 7: FX rate service returns rates correctly", async () => {
  const restoreFetch = mockFetchOnce(async () => ({
    ok: true,
    async json() {
      return {
        base: "USD",
        rates: {
          EUR: 0.91,
          GBP: 0.78,
          USD: 1
        }
      };
    }
  }));

  try {
    const payload = await fetchLiveRates("USD");
    assert.equal(payload.base, "USD");
    assert.equal(payload.source, "live");
    assert.equal(payload.rates.EUR, 0.91);
    assert.equal(payload.rates.GBP, 0.78);
  } finally {
    restoreFetch();
  }
});

test("stage 7: FX rate falls back to static on fetch failure", async () => {
  const restoreFetch = mockFetchOnce(async () => {
    throw new Error("provider unavailable");
  });

  try {
    const payload = await getCachedRates("AUD", { forceRefresh: true });
    assert.equal(payload.base, "AUD");
    assert.equal(payload.source, "static");
    assert.equal(payload.rates.USD, STATIC_EXCHANGE_RATES.USD);
    assert.equal(payload.rates.EUR, STATIC_EXCHANGE_RATES.EUR);
  } finally {
    restoreFetch();
  }
});

test("stage 7: Plaid link token creation returns token", async () => {
  const actor = await createWorkspaceActor();
  const previousClientId = process.env.PLAID_CLIENT_ID;
  const previousSecret = process.env.PLAID_SECRET;

  process.env.PLAID_CLIENT_ID = "plaid-client-test";
  process.env.PLAID_SECRET = "plaid-secret-test";

  try {
    const response = await request(serverEnvironment.app)
      .post("/api/finance/bank-accounts/plaid/create-link-token")
      .set(buildHeaders(actor))
      .send({});

    assert.equal(response.statusCode, 200);
    assert.match(response.body.linkToken, /^link-sandbox-/);
  } finally {
    process.env.PLAID_CLIENT_ID = previousClientId;
    process.env.PLAID_SECRET = previousSecret;
  }
});

test("stage 7: payroll record creates with correct netAmount", async () => {
  const actor = await createWorkspaceActor({ defaultCurrency: "USD" });
  const response = await createPayrollViaApi(actor, {
    grossAmount: 1500,
    deductions: [
      { label: "Tax", amount: 150 },
      { label: "Insurance", amount: 50 }
    ]
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.grossAmount, 1500);
  assert.equal(response.body.netAmount, 1300);
  assert.equal(response.body.status, "draft");
});

test("stage 7: payroll approve transitions correctly", async () => {
  const actor = await createWorkspaceActor();
  const createResponse = await createPayrollViaApi(actor);
  assert.equal(createResponse.statusCode, 201);

  const approveResponse = await request(serverEnvironment.app)
    .patch(`/api/finance/payroll/${createResponse.body.id}/approve`)
    .set(buildHeaders(actor))
    .send({});

  assert.equal(approveResponse.statusCode, 200);
  assert.equal(approveResponse.body.status, "approved");
  assert.ok(approveResponse.body.approvedAt);
});

test("stage 7: payroll pay creates linked expense", async () => {
  const actor = await createWorkspaceActor();
  const createResponse = await createPayrollViaApi(actor, {
    grossAmount: 1000,
    deductions: [{ label: "Tax", amount: 100 }]
  });
  assert.equal(createResponse.statusCode, 201);

  const approveResponse = await request(serverEnvironment.app)
    .patch(`/api/finance/payroll/${createResponse.body.id}/approve`)
    .set(buildHeaders(actor))
    .send({});
  assert.equal(approveResponse.statusCode, 200);

  const payResponse = await request(serverEnvironment.app)
    .patch(`/api/finance/payroll/${createResponse.body.id}/pay`)
    .set(buildHeaders(actor))
    .send({
      paymentMethod: "bank_transfer",
      paymentReference: "PAY-STAGE7"
    });

  assert.equal(payResponse.statusCode, 200);
  assert.equal(payResponse.body.status, "paid");
  assert.ok(payResponse.body.paidAt);
  assert.equal(payResponse.body.paymentMethod, "bank_transfer");
  assert.ok(payResponse.body.linkedExpenseId);

  const expense = await ExpenseRecord.findById(payResponse.body.linkedExpenseId);
  assert.ok(expense);
  assert.equal(expense.category, "salary");
  assert.equal(Number(expense.amount), 900);
  assert.equal(expense.status, "approved");
  assert.equal(String(expense.source || ""), "payroll");
});

test("stage 7: payroll cancel works from draft and approved", async () => {
  const actor = await createWorkspaceActor();

  const draftResponse = await createPayrollViaApi(actor, {
    employeeName: "Draft Employee"
  });
  assert.equal(draftResponse.statusCode, 201);

  const cancelDraftResponse = await request(serverEnvironment.app)
    .patch(`/api/finance/payroll/${draftResponse.body.id}/cancel`)
    .set(buildHeaders(actor))
    .send({});

  assert.equal(cancelDraftResponse.statusCode, 200);
  assert.equal(cancelDraftResponse.body.status, "cancelled");

  const approvedResponse = await createPayrollViaApi(actor, {
    employeeName: "Approved Employee"
  });
  assert.equal(approvedResponse.statusCode, 201);

  const approveResponse = await request(serverEnvironment.app)
    .patch(`/api/finance/payroll/${approvedResponse.body.id}/approve`)
    .set(buildHeaders(actor))
    .send({});
  assert.equal(approveResponse.statusCode, 200);

  const cancelApprovedResponse = await request(serverEnvironment.app)
    .patch(`/api/finance/payroll/${approvedResponse.body.id}/cancel`)
    .set(buildHeaders(actor))
    .send({});

  assert.equal(cancelApprovedResponse.statusCode, 200);
  assert.equal(cancelApprovedResponse.body.status, "cancelled");
});

test("stage 7: accountant role can read finance data", async () => {
  const owner = await createWorkspaceActor();
  const accountant = await createWorkspaceActor({
    workspace: owner.workspace,
    workspaceRole: "member",
    financeRoles: ["accountant"],
    modules: ["finance"]
  });

  const response = await request(serverEnvironment.app)
    .get("/api/finance/summary")
    .set(buildHeaders(accountant));

  assert.equal(response.statusCode, 200);
  assert.ok(response.body);
  assert.ok(Object.prototype.hasOwnProperty.call(response.body, "outstandingAmount"));
});

test("stage 7: accountant role cannot approve invoices", async () => {
  const owner = await createWorkspaceActor();
  const accountant = await createWorkspaceActor({
    workspace: owner.workspace,
    workspaceRole: "member",
    financeRoles: ["accountant"],
    modules: ["finance"]
  });

  const createResponse = await createInvoiceViaApi(owner);
  assert.equal(createResponse.statusCode, 201);

  const approveResponse = await request(serverEnvironment.app)
    .patch(`/api/finance/invoices/${createResponse.body.id}/approve`)
    .set(buildHeaders(accountant))
    .send({});

  assert.equal(approveResponse.statusCode, 403);
});

test("stage 7: accountant invite creates membership correctly", async () => {
  const owner = await createWorkspaceActor();
  const invitedEmail = `accountant-${crypto.randomUUID()}@example.com`;

  const response = await request(serverEnvironment.app)
    .post(`/api/workspaces/${owner.workspace._id.toString()}/invite-accountant`)
    .set(buildHeaders(owner))
    .send({
      email: invitedEmail,
      name: "Ada Accountant"
    });

  assert.equal(response.statusCode, 201);
  assert.ok(response.body.id);
  assert.ok(response.body.membershipId);
  assert.deepEqual(response.body.workspaceRoles, ["accountant"]);

  const membership = await WorkspaceMembership.findOne({
    workspaceId: owner.workspace._id,
    email: invitedEmail
  });
  assert.ok(membership);
  assert.deepEqual(membership.financeRoles, ["accountant"]);
  assert.equal(membership.status, "invited");
});

test("stage 7: GET /finance/accountant-summary returns correct shape", async () => {
  const owner = await createWorkspaceActor({ accountingEnabled: true });
  const accountant = await createWorkspaceActor({
    workspace: owner.workspace,
    workspaceRole: "member",
    financeRoles: ["accountant"],
    modules: ["finance"]
  });

  const response = await request(serverEnvironment.app)
    .get("/api/finance/accountant-summary")
    .set(buildHeaders(accountant));

  assert.equal(response.statusCode, 200);
  assert.ok(Array.isArray(response.body.journals));
  assert.ok(Array.isArray(response.body.closeReviewPeriods));
  assert.ok(response.body.taxSummary);
  assert.ok(response.body.balanceSheet);
  assert.ok(response.body.agedReceivables);
});

test("stage 7: balance sheet uses live rates when available", async () => {
  const actor = await createWorkspaceActor({ defaultCurrency: "USD" });
  const restoreFetch = mockFetchOnce(async () => ({
    ok: true,
    async json() {
      return {
        base: "USD",
        rates: {
          USD: 1,
          EUR: 0.5
        }
      };
    }
  }));

  try {
    const accountResponse = await createBankAccountViaApi(actor, {
      accountName: "Euro Account",
      currentBalance: 100,
      currency: "EUR"
    });
    assert.equal(accountResponse.statusCode, 201);

    const rateResponse = await request(serverEnvironment.app)
      .get("/api/finance/fx-rates?refresh=true")
      .set(buildHeaders(actor));
    assert.equal(rateResponse.statusCode, 200);
    assert.equal(rateResponse.body.live, true);

    const response = await request(serverEnvironment.app)
      .get("/api/finance/reports/balance-sheet?baseCurrency=USD")
      .set(buildHeaders(actor));

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.normalizedTotals.liveRate, true);
    assert.equal(response.body.normalizedTotals.rateSource, "live");
    assert.equal(response.body.normalizedTotals.assets, 200);
    assert.equal(response.body.balanceCheck.liveRate, true);
  } finally {
    restoreFetch();
  }
});
