import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import request from "supertest";

import { createServerEnvironment } from "../src/app.js";
import { connectDB } from "../src/config/db.js";
import { Workspace } from "../src/models/Workspace.js";
import { WorkspaceMembership } from "../src/models/WorkspaceMembership.js";
import { WarehouseProduct } from "../src/models/WarehouseProduct.js";

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
  modules = ["finance"],
  accountingEnabled = false,
  defaultCurrency = "USD"
} = {}) {
  const registered = await registerUser({
    name: `ERP Foundation ${workspaceRole}`,
    email: `erp-foundation-${crypto.randomUUID()}@example.com`,
    password: "password1"
  });

  const activeWorkspace =
    workspace ||
    (await Workspace.create({
      name: `ERP Foundation ${crypto.randomUUID().slice(0, 8)}`,
      slug: `erp-foundation-${crypto.randomUUID().slice(0, 8)}`,
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
      customerName: "Foundation Customer",
      amount: 100,
      currency: "USD",
      dueDate: addDays(7).toISOString(),
      status: "approved",
      ...payload
    });
}

async function markInvoicePaid(context, invoiceId, payload = {}) {
  return request(serverEnvironment.app)
    .patch(`/api/finance/invoices/${invoiceId}/paid`)
    .set(buildHeaders(context))
    .send(payload);
}

async function createExpenseViaApi(context, payload = {}) {
  return request(serverEnvironment.app)
    .post("/api/finance/expenses")
    .set(buildHeaders(context))
    .send({
      vendorName: "Foundation Vendor",
      amount: 100,
      currency: "USD",
      category: "supplies",
      expenseDate: new Date().toISOString(),
      status: "approved",
      ...payload
    });
}

async function reimburseExpense(context, expenseId, payload = {}) {
  return request(serverEnvironment.app)
    .patch(`/api/finance/expenses/${expenseId}/reimburse`)
    .set(buildHeaders(context))
    .send(payload);
}

async function createBankAccount(context, payload = {}) {
  return request(serverEnvironment.app)
    .post("/api/finance/bank-accounts")
    .set(buildHeaders(context))
    .send({
      accountName: "Main Checking",
      accountType: "checking",
      currency: "USD",
      currentBalance: 1000,
      ...payload
    });
}

async function createBankTransaction(context, accountId, payload = {}) {
  return request(serverEnvironment.app)
    .post(`/api/finance/bank-accounts/${accountId}/transactions`)
    .set(buildHeaders(context))
    .send({
      description: "Manual transaction",
      amount: -25,
      currency: "USD",
      transactionDate: new Date().toISOString(),
      category: "operations",
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

test("erp foundation: tax amount computed correctly on invoice", async () => {
  const actor = await createWorkspaceActor();

  const response = await createInvoiceViaApi(actor, {
    amount: 100,
    taxRate: 15,
    taxLabel: "VAT"
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.subtotal, 100);
  assert.equal(response.body.taxRate, 15);
  assert.equal(response.body.taxAmount, 15);
  assert.equal(response.body.totalWithTax, 115);
  assert.equal(response.body.amount, 115);
  assert.equal(response.body.taxLabel, "VAT");
});

test("erp foundation: tax amount computed correctly on expense", async () => {
  const actor = await createWorkspaceActor();

  const response = await createExpenseViaApi(actor, {
    amount: 200,
    taxRate: 10,
    taxLabel: "GST"
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.taxRate, 10);
  assert.equal(response.body.taxAmount, 20);
  assert.equal(response.body.totalWithTax, 220);
  assert.equal(response.body.amount, 220);
  assert.equal(response.body.taxLabel, "GST");
});

test("erp foundation: tax summary route returns correct totals", async () => {
  const actor = await createWorkspaceActor();

  const invoice = await createInvoiceViaApi(actor, {
    amount: 100,
    taxRate: 20,
    taxLabel: "VAT"
  });
  assert.equal(invoice.statusCode, 201);

  const paid = await markInvoicePaid(actor, invoice.body.id, {
    paidAmount: invoice.body.totalWithTax,
    method: "bank_transfer"
  });
  assert.equal(paid.statusCode, 200);
  assert.equal(paid.body.status, "paid");

  const expense = await createExpenseViaApi(actor, {
    amount: 150,
    taxRate: 10,
    taxLabel: "VAT",
    status: "approved"
  });
  assert.equal(expense.statusCode, 201);

  const response = await request(serverEnvironment.app)
    .get("/api/finance/tax-summary")
    .set(buildHeaders(actor));

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.collected.USD, 20);
  assert.equal(response.body.paid.USD, 15);
  assert.equal(response.body.net.USD, 5);
  assert.equal(response.body.normalizedApproximate.baseCurrency, "USD");
});

test("erp foundation: profit and loss report returns correct figures", async () => {
  const actor = await createWorkspaceActor();

  const invoice = await createInvoiceViaApi(actor, {
    amount: 100,
    taxRate: 20,
    status: "approved"
  });
  assert.equal(invoice.statusCode, 201);
  const paid = await markInvoicePaid(actor, invoice.body.id, {
    paidAmount: invoice.body.totalWithTax
  });
  assert.equal(paid.statusCode, 200);

  const expense = await createExpenseViaApi(actor, {
    amount: 50,
    taxRate: 10,
    status: "approved"
  });
  assert.equal(expense.statusCode, 201);

  const response = await request(serverEnvironment.app)
    .get("/api/finance/reports/profit-loss?period=month&baseCurrency=USD")
    .set(buildHeaders(actor));

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.period, "month");
  assert.equal(response.body.totals.revenue.USD, 120);
  assert.equal(response.body.totals.expenses.USD, 55);
  assert.equal(response.body.totals.grossProfit.USD, 65);
  assert.equal(response.body.normalizedTotals.baseCurrency, "USD");
  assert.equal(response.body.normalizedTotals.grossProfit, 65);
});

test("erp foundation: cash flow report returns correct figures", async () => {
  const actor = await createWorkspaceActor();

  const invoice = await createInvoiceViaApi(actor, {
    amount: 100,
    taxRate: 20,
    status: "approved"
  });
  assert.equal(invoice.statusCode, 201);
  const paid = await markInvoicePaid(actor, invoice.body.id, {
    paidAmount: invoice.body.totalWithTax,
    method: "card"
  });
  assert.equal(paid.statusCode, 200);

  const expense = await createExpenseViaApi(actor, {
    amount: 50,
    taxRate: 10,
    status: "approved"
  });
  assert.equal(expense.statusCode, 201);
  const reimbursed = await reimburseExpense(actor, expense.body.id, {
    method: "bank_transfer",
    reference: "EXP-SETTLE-1"
  });
  assert.equal(reimbursed.statusCode, 200);
  assert.equal(reimbursed.body.status, "reimbursed");

  const response = await request(serverEnvironment.app)
    .get("/api/finance/reports/cash-flow?period=month&baseCurrency=USD")
    .set(buildHeaders(actor));

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.totals.cashIn.USD, 120);
  assert.equal(response.body.totals.cashOut.USD, 55);
  assert.equal(response.body.totals.netCashFlow.USD, 65);
  assert.equal(response.body.normalizedTotals.netCashFlow, 65);
});

test("erp foundation: aged receivables buckets correctly", async () => {
  const actor = await createWorkspaceActor();

  const invoices = [
    { amount: 100, dueDate: addDays(-10), customerName: "Customer A", invoiceNumber: uniqueInvoiceNumber() },
    { amount: 200, dueDate: addDays(-45), customerName: "Customer B", invoiceNumber: uniqueInvoiceNumber() },
    { amount: 300, dueDate: addDays(-75), customerName: "Customer C", invoiceNumber: uniqueInvoiceNumber() },
    { amount: 400, dueDate: addDays(-120), customerName: "Customer D", invoiceNumber: uniqueInvoiceNumber() }
  ];

  for (const invoice of invoices) {
    const response = await createInvoiceViaApi(actor, {
      ...invoice,
      status: "approved",
      taxRate: 0
    });
    assert.equal(response.statusCode, 201);
  }

  const response = await request(serverEnvironment.app)
    .get("/api/finance/reports/aged-receivables?baseCurrency=USD")
    .set(buildHeaders(actor));

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.buckets["0_30"].USD, 100);
  assert.equal(response.body.buckets["31_60"].USD, 200);
  assert.equal(response.body.buckets["61_90"].USD, 300);
  assert.equal(response.body.buckets["90_plus"].USD, 400);
  assert.equal(response.body.totals.USD, 1000);
});

test("erp foundation: bank account create and list", async () => {
  const actor = await createWorkspaceActor();

  const created = await createBankAccount(actor, {
    accountName: "Operations Checking",
    currentBalance: 2500
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.accountName, "Operations Checking");
  assert.equal(created.body.currentBalance, 2500);

  const listed = await request(serverEnvironment.app)
    .get("/api/finance/bank-accounts")
    .set(buildHeaders(actor));

  assert.equal(listed.statusCode, 200);
  assert.equal(listed.body.length, 1);
  assert.equal(listed.body[0].accountName, "Operations Checking");
});

test("erp foundation: bank transaction manual entry", async () => {
  const actor = await createWorkspaceActor();
  const account = await createBankAccount(actor, {
    accountName: "Treasury",
    currentBalance: 1000
  });
  assert.equal(account.statusCode, 201);

  const created = await createBankTransaction(actor, account.body.id, {
    description: "Office rent",
    amount: -120,
    category: "rent"
  });

  assert.equal(created.statusCode, 201);
  assert.equal(created.body.amount, -120);
  assert.equal(created.body.category, "rent");

  const listed = await request(serverEnvironment.app)
    .get(`/api/finance/bank-accounts/${account.body.id}/transactions`)
    .set(buildHeaders(actor));

  assert.equal(listed.statusCode, 200);
  assert.equal(listed.body.length, 1);
  assert.equal(listed.body[0].description, "Office rent");

  const accounts = await request(serverEnvironment.app)
    .get("/api/finance/bank-accounts")
    .set(buildHeaders(actor));

  assert.equal(accounts.statusCode, 200);
  assert.equal(accounts.body[0].currentBalance, 880);
});

test("erp foundation: transaction match to expense", async () => {
  const actor = await createWorkspaceActor();
  const account = await createBankAccount(actor);
  assert.equal(account.statusCode, 201);

  const transaction = await createBankTransaction(actor, account.body.id, {
    description: "Vendor payment",
    amount: -220
  });
  assert.equal(transaction.statusCode, 201);

  const expense = await createExpenseViaApi(actor, {
    amount: 200,
    taxRate: 10,
    status: "approved"
  });
  assert.equal(expense.statusCode, 201);

  const matched = await request(serverEnvironment.app)
    .patch(`/api/finance/bank-transactions/${transaction.body.id}/match-expense`)
    .set(buildHeaders(actor))
    .send({ expenseId: expense.body.id });

  assert.equal(matched.statusCode, 200);
  assert.equal(matched.body.matchedExpenseId, expense.body.id);
});

test("erp foundation: inventory value report returns correct total", async () => {
  const actor = await createWorkspaceActor({ modules: ["warehouse"] });

  await Promise.all([
    createWarehouseProduct(actor, {
      name: "Boxes",
      itemType: "inventory",
      currentStock: 10,
      unitCost: 5,
      currency: "USD",
      reorderThreshold: 4
    }),
    createWarehouseProduct(actor, {
      name: "Labels",
      itemType: "supplies",
      currentStock: 20,
      unitCost: 2,
      currency: "USD",
      reorderThreshold: 25
    })
  ]);

  const response = await request(serverEnvironment.app)
    .get("/api/warehouse/reports/inventory-value")
    .set(buildHeaders(actor));

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.totals.USD, 90);
  assert.ok(Array.isArray(response.body.categories));
  assert.ok(response.body.categories.some((entry) => entry.category === "inventory" && entry.totals.USD === 50));
  assert.ok(response.body.lowStockItems.some((entry) => entry.name === "Labels"));
});
