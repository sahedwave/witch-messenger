import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import request from "supertest";

import { createServerEnvironment } from "../src/app.js";
import { connectDB } from "../src/config/db.js";
import { BankAccount } from "../src/models/BankAccount.js";
import { BankTransaction } from "../src/models/BankTransaction.js";
import { ExpenseRecord } from "../src/models/ExpenseRecord.js";
import { InvoiceRecord } from "../src/models/InvoiceRecord.js";
import { WarehouseProduct } from "../src/models/WarehouseProduct.js";
import { Workspace } from "../src/models/Workspace.js";
import { WorkspaceMembership } from "../src/models/WorkspaceMembership.js";
import { matchTransactions, syncBankAccount } from "../src/services/bankSyncService.js";

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
    name: `Stage6 ${workspaceRole}`,
    email: `stage6-${crypto.randomUUID()}@example.com`,
    password: "password1"
  });

  const activeWorkspace =
    workspace ||
    (await Workspace.create({
      name: `Stage 6 ${crypto.randomUUID().slice(0, 8)}`,
      slug: `stage-6-${crypto.randomUUID().slice(0, 8)}`,
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
      customerName: "Stage 6 Customer",
      customerEmail: "customer@example.com",
      amount: 100,
      currency: "USD",
      dueDate: addDays(7).toISOString(),
      ...payload
    });
}

async function createExpenseViaApi(context, payload = {}) {
  return request(serverEnvironment.app)
    .post("/api/finance/expenses")
    .set(buildHeaders(context))
    .send({
      vendorName: "Stage 6 Vendor",
      amount: 100,
      currency: "USD",
      category: "supplies",
      expenseDate: new Date().toISOString(),
      ...payload
    });
}

async function createBankAccountViaApi(context, payload = {}) {
  return request(serverEnvironment.app)
    .post("/api/finance/bank-accounts")
    .set(buildHeaders(context))
    .send({
      accountName: "Main Checking",
      accountType: "checking",
      currency: "USD",
      currentBalance: 0,
      ...payload
    });
}

async function markInvoicePaid(context, invoiceId, payload = {}) {
  return request(serverEnvironment.app)
    .patch(`/api/finance/invoices/${invoiceId}/paid`)
    .set(buildHeaders(context))
    .send({
      paidAmount: 100,
      method: "bank_transfer",
      reference: `PAY-${crypto.randomUUID().slice(0, 8)}`,
      ...payload
    });
}

async function createWarehouseProduct(context, overrides = {}) {
  return WarehouseProduct.create({
    workspaceId: context.workspace._id,
    name: overrides.name || "Inventory Item",
    sku: overrides.sku || `SKU-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
    itemType: overrides.itemType || "inventory",
    unit: overrides.unit || "units",
    unitCost: overrides.unitCost ?? 10,
    currency: overrides.currency || "USD",
    currentStock: overrides.currentStock ?? 10,
    minimumStock: overrides.minimumStock ?? 2,
    reorderThreshold: overrides.reorderThreshold ?? 2,
    reorderQuantity: overrides.reorderQuantity ?? 10,
    alertStatus: overrides.alertStatus || "active",
    productStatus: overrides.productStatus || "active",
    createdBy: context.user.id,
    updatedBy: context.user.id
  });
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

test("stage 6: bank sync service imports transactions correctly", async () => {
  const actor = await createWorkspaceActor();
  const bankResponse = await createBankAccountViaApi(actor, {
    currentBalance: 500
  });
  assert.equal(bankResponse.statusCode, 201);

  const result = await syncBankAccount(bankResponse.body.id, [
    {
      providerTransactionId: `provider-${crypto.randomUUID()}`,
      transactionDate: new Date().toISOString(),
      description: "Imported supplier payment",
      amount: -125,
      currency: "USD",
      category: "supplies",
      source: "bank_sync"
    }
  ]);

  assert.equal(result.imported, 1);
  assert.equal(result.duplicates, 0);

  const transactions = await BankTransaction.find({ workspaceId: actor.workspace._id });
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].source, "bank_sync");
});

test("stage 6: duplicate transactions are not re-imported", async () => {
  const actor = await createWorkspaceActor();
  const bankResponse = await createBankAccountViaApi(actor);
  assert.equal(bankResponse.statusCode, 201);

  const providerTransactionId = `provider-${crypto.randomUUID()}`;
  const payload = [
    {
      providerTransactionId,
      transactionDate: new Date().toISOString(),
      description: "Duplicate test",
      amount: -90,
      currency: "USD"
    }
  ];

  const first = await syncBankAccount(bankResponse.body.id, payload);
  const second = await syncBankAccount(bankResponse.body.id, payload);

  assert.equal(first.imported, 1);
  assert.equal(second.imported, 0);
  assert.equal(second.duplicates, 1);

  const transactions = await BankTransaction.find({
    workspaceId: actor.workspace._id,
    providerTransactionId
  });
  assert.equal(transactions.length, 1);
});

test("stage 6: auto-match finds correct expense match", async () => {
  const actor = await createWorkspaceActor();
  const expenseResponse = await createExpenseViaApi(actor, {
    amount: 250,
    currency: "USD",
    vendorName: "Matching Vendor"
  });
  assert.equal(expenseResponse.statusCode, 201);

  await ExpenseRecord.findByIdAndUpdate(expenseResponse.body.id, {
    $set: {
      status: "approved",
      expenseDate: new Date().toISOString()
    }
  });

  const bankResponse = await createBankAccountViaApi(actor);
  assert.equal(bankResponse.statusCode, 201);

  await syncBankAccount(bankResponse.body.id, [
    {
      providerTransactionId: `provider-${crypto.randomUUID()}`,
      transactionDate: new Date().toISOString(),
      description: "Matching Vendor payment",
      amount: -250,
      currency: "USD",
      source: "bank_sync"
    }
  ]);

  const suggestions = await matchTransactions(actor.workspace._id, bankResponse.body.id);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].suggestions[0].referenceType, "expense");
  assert.equal(String(suggestions[0].suggestions[0].referenceId), expenseResponse.body.id);
  assert.ok(Number(suggestions[0].suggestions[0].confidence || 0) >= 70);
});

test("stage 6: balance sheet assets calculated correctly", async () => {
  const actor = await createWorkspaceActor();

  const bankResponse = await createBankAccountViaApi(actor, {
    currentBalance: 400
  });
  assert.equal(bankResponse.statusCode, 201);

  const invoiceResponse = await createInvoiceViaApi(actor, {
    amount: 150,
    currency: "USD"
  });
  assert.equal(invoiceResponse.statusCode, 201);
  await InvoiceRecord.findByIdAndUpdate(invoiceResponse.body.id, {
    $set: {
      status: "approved",
      paidAmount: 50
    }
  });

  await createWarehouseProduct(actor, {
    unitCost: 20,
    currentStock: 5,
    currency: "USD"
  });

  const response = await request(serverEnvironment.app)
    .get("/api/finance/reports/balance-sheet")
    .set(buildHeaders(actor));

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.assets.cash.USD, 400);
  assert.equal(response.body.assets.accountsReceivable.USD, 100);
  assert.equal(response.body.assets.inventory.USD, 100);
  assert.equal(response.body.assets.total.USD, 600);
});

test("stage 6: balance sheet liabilities calculated correctly", async () => {
  const actor = await createWorkspaceActor();

  const approvedExpense = await createExpenseViaApi(actor, {
    amount: 80,
    currency: "USD"
  });
  assert.equal(approvedExpense.statusCode, 201);
  await ExpenseRecord.findByIdAndUpdate(approvedExpense.body.id, {
    $set: { status: "approved" }
  });

  const pendingExpense = await createExpenseViaApi(actor, {
    amount: 20,
    currency: "USD",
    vendorName: "Pending Vendor"
  });
  assert.equal(pendingExpense.statusCode, 201);

  const response = await request(serverEnvironment.app)
    .get("/api/finance/reports/balance-sheet")
    .set(buildHeaders(actor));

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.liabilities.accountsPayable.USD, 100);
  assert.equal(response.body.liabilities.total.USD, 100);
});

test("stage 6: balance sheet totals balance correctly", async () => {
  const actor = await createWorkspaceActor();

  const bankResponse = await createBankAccountViaApi(actor, { currentBalance: 400 });
  assert.equal(bankResponse.statusCode, 201);

  const paidInvoice = await createInvoiceViaApi(actor, {
    amount: 500,
    currency: "USD"
  });
  assert.equal(paidInvoice.statusCode, 201);
  await InvoiceRecord.findByIdAndUpdate(paidInvoice.body.id, {
    $set: {
      status: "paid",
      paidAmount: 500,
      paidAt: new Date()
    }
  });

  const openInvoice = await createInvoiceViaApi(actor, {
    amount: 100,
    currency: "USD"
  });
  assert.equal(openInvoice.statusCode, 201);
  await InvoiceRecord.findByIdAndUpdate(openInvoice.body.id, {
    $set: {
      status: "approved",
      paidAmount: 0
    }
  });

  const approvedExpense = await createExpenseViaApi(actor, {
    amount: 200,
    currency: "USD"
  });
  assert.equal(approvedExpense.statusCode, 201);
  await ExpenseRecord.findByIdAndUpdate(approvedExpense.body.id, {
    $set: { status: "approved" }
  });

  const response = await request(serverEnvironment.app)
    .get("/api/finance/reports/balance-sheet")
    .set(buildHeaders(actor));

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.assets.total.USD, 500);
  assert.equal(response.body.liabilities.total.USD, 200);
  assert.equal(response.body.equity.total.USD, 300);
  assert.equal(response.body.balanceCheck.difference, 0);
  assert.equal(response.body.balanceCheck.isBalanced, true);
});

test("stage 6: GET /invoices/:id returns full invoice detail", async () => {
  const actor = await createWorkspaceActor();
  const invoiceResponse = await createInvoiceViaApi(actor, {
    amount: 240,
    taxRate: 15,
    taxLabel: "VAT",
    note: "Full detail invoice"
  });
  assert.equal(invoiceResponse.statusCode, 201);

  const response = await request(serverEnvironment.app)
    .get(`/api/finance/invoices/${invoiceResponse.body.id}`)
    .set(buildHeaders(actor));

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.id, invoiceResponse.body.id);
  assert.equal(response.body.note, "Full detail invoice");
  assert.equal(response.body.taxLabel, "VAT");
  assert.ok(Array.isArray(response.body.actionLog));
});

test("stage 6: GET /expenses/:id returns full expense detail", async () => {
  const actor = await createWorkspaceActor();
  const expenseResponse = await createExpenseViaApi(actor, {
    amount: 180,
    taxRate: 10,
    taxLabel: "GST",
    note: "Full detail expense"
  });
  assert.equal(expenseResponse.statusCode, 201);

  const response = await request(serverEnvironment.app)
    .get(`/api/finance/expenses/${expenseResponse.body.id}`)
    .set(buildHeaders(actor));

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.id, expenseResponse.body.id);
  assert.equal(response.body.note, "Full detail expense");
  assert.equal(response.body.taxLabel, "GST");
  assert.ok(Array.isArray(response.body.actionLog));
});

test("stage 6: invoice detail includes payment history", async () => {
  const actor = await createWorkspaceActor();
  const invoiceResponse = await createInvoiceViaApi(actor, {
    amount: 220,
    currency: "USD"
  });
  assert.equal(invoiceResponse.statusCode, 201);
  await InvoiceRecord.findByIdAndUpdate(invoiceResponse.body.id, {
    $set: {
      status: "approved",
      paidAmount: 0
    }
  });

  const paymentResponse = await markInvoicePaid(actor, invoiceResponse.body.id, {
    paidAmount: 120,
    reference: "BANK-120"
  });
  assert.equal(paymentResponse.statusCode, 200);

  const response = await request(serverEnvironment.app)
    .get(`/api/finance/invoices/${invoiceResponse.body.id}`)
    .set(buildHeaders(actor));

  assert.equal(response.statusCode, 200);
  assert.ok(Array.isArray(response.body.payments));
  assert.equal(response.body.payments.length, 1);
  assert.equal(response.body.payments[0].reference, "BANK-120");
});

test("stage 6: expense detail includes action log", async () => {
  const actor = await createWorkspaceActor();
  const expenseResponse = await createExpenseViaApi(actor, {
    amount: 95,
    currency: "USD",
    note: "Action log expense"
  });
  assert.equal(expenseResponse.statusCode, 201);

  const response = await request(serverEnvironment.app)
    .get(`/api/finance/expenses/${expenseResponse.body.id}`)
    .set(buildHeaders(actor));

  assert.equal(response.statusCode, 200);
  assert.ok(Array.isArray(response.body.actionLog));
  assert.ok(response.body.actionLog.length >= 1);
  assert.ok(String(response.body.actionLog[0].action || "").length > 0);
});
