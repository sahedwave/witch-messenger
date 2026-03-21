import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import request from "supertest";
import { io as ioClient } from "socket.io-client";

import { createServerEnvironment } from "../src/app.js";
import { connectDB } from "../src/config/db.js";
import { FinancePeriodLock } from "../src/models/FinancePeriodLock.js";
import { InvoiceRecord } from "../src/models/InvoiceRecord.js";
import { JournalEntry } from "../src/models/JournalEntry.js";
import { Workspace } from "../src/models/Workspace.js";
import { WorkspaceMembership } from "../src/models/WorkspaceMembership.js";

let mongoServer;
let serverEnvironment;
let address;
const socketsToCleanup = new Set();

async function registerUser(user) {
  const response = await request(serverEnvironment.app).post("/api/auth/register").send(user);
  assert.equal(response.statusCode, 201);
  return response.body;
}

function buildPeriodKey(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function periodRangeFromDate(date = new Date()) {
  const year = date.getUTCFullYear();
  const monthIndex = date.getUTCMonth();
  return {
    periodKey: buildPeriodKey(date),
    periodStart: new Date(Date.UTC(year, monthIndex, 1)),
    periodEnd: new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999))
  };
}

async function createFinanceWorkspaceActor({ accountingEnabled = false } = {}) {
  const registered = await registerUser({
    name: "Finance Paid Tester",
    email: `finance-paid-${crypto.randomUUID()}@example.com`,
    password: "password1"
  });

  const workspace = await Workspace.create({
    name: `Finance QA ${crypto.randomUUID().slice(0, 8)}`,
    slug: `finance-qa-${crypto.randomUUID().slice(0, 8)}`,
    ownerUserId: registered.user.id,
    accountingEnabled,
    accountingEnabledAt: accountingEnabled ? new Date(Date.now() - 60_000) : null,
    status: "active"
  });

  await WorkspaceMembership.create({
    workspaceId: workspace._id,
    userId: registered.user.id,
    email: registered.user.email,
    workspaceRole: "owner",
    financeRoles: ["viewer", "approver", "finance_staff"],
    modules: ["finance"],
    status: "active"
  });

  return {
    token: registered.token,
    user: registered.user,
    workspace
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
    paidAt: overrides.paidAt ?? null,
    payments: overrides.payments || [],
    createdBy: context.user.id,
    paidBy: overrides.paidBy ?? null,
    createdAt: overrides.createdAt || new Date(Date.now() - 24 * 60 * 60 * 1000)
  });
}

function buildFinanceHeaders(context) {
  return {
    Authorization: `Bearer ${context.token}`,
    "x-workspace-id": context.workspace._id.toString()
  };
}

async function markInvoicePaid(context, invoiceId, payload) {
  return request(serverEnvironment.app)
    .patch(`/api/finance/invoices/${invoiceId}/paid`)
    .set(buildFinanceHeaders(context))
    .send(payload);
}

async function createInvoiceViaApi(context, payload) {
  return request(serverEnvironment.app)
    .post("/api/finance/invoices")
    .set(buildFinanceHeaders(context))
    .send(payload);
}

async function getFinanceSummary(context, query = "") {
  return request(serverEnvironment.app)
    .get(`/api/finance/summary${query}`)
    .set(buildFinanceHeaders(context));
}

async function getJournalExport(context, query = "") {
  return request(serverEnvironment.app)
    .get(`/api/finance/accounting/exports/journals${query}`)
    .set(buildFinanceHeaders(context));
}

async function findInvoice(invoiceId) {
  return InvoiceRecord.findById(invoiceId).lean();
}

async function findInvoiceJournals(workspaceId, invoiceId) {
  return JournalEntry.find({
    workspaceId,
    sourceType: "invoice",
    sourceId: invoiceId
  }).sort({ createdAt: 1 }).lean();
}

async function findInvoicePaymentJournals(workspaceId, invoiceId) {
  return JournalEntry.find({
    workspaceId,
    sourceType: "invoice",
    sourceId: invoiceId,
    entryType: "invoice_payment",
    status: "posted"
  }).sort({ createdAt: 1 }).lean();
}

function sumPaymentAmounts(invoice) {
  return (invoice?.payments || []).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
}

function sumInvoiceAmounts(invoices = [], predicate = () => true) {
  return invoices.filter(predicate).reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
}

function assertBalancedPaymentJournal(entry, expectedAmount) {
  assert.ok(entry, "expected an invoice payment journal entry");
  assert.equal(entry.totalDebit, expectedAmount);
  assert.equal(entry.totalCredit, expectedAmount);
  assert.equal(entry.totalDebit - entry.totalCredit, 0);
}

function connectSocket(token) {
  const socket = ioClient(address, {
    auth: { token },
    transports: ["websocket"],
    autoConnect: false
  });
  socketsToCleanup.add(socket);
  return socket;
}

function waitForEvent(socket, eventName, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, timeoutMs);

    socket.once(eventName, (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
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
    serverEnvironment.server.listen(0, "127.0.0.1", () => {
      const serverAddress = serverEnvironment.server.address();
      address = `http://127.0.0.1:${serverAddress.port}`;
      resolve();
    });
  });
});

async function disconnectSocket(socket) {
  if (!socket) {
    return;
  }

  if (!socket.connected && socket.disconnected) {
    socketsToCleanup.delete(socket);
    socket.removeAllListeners();
    return;
  }

  await new Promise((resolve) => {
    socket.once("disconnect", resolve);
    socket.disconnect();
  });

  socketsToCleanup.delete(socket);
  socket.removeAllListeners();
}

async function cleanupSockets() {
  await Promise.all([...socketsToCleanup].map((socket) => disconnectSocket(socket).catch(() => null)));
}

after(async () => {
  await cleanupSockets();
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

test("register, login, and restore session", async () => {
  const email = `auth-${Date.now()}@example.com`;
  const registered = await registerUser({
    name: "Auth User",
    email,
    password: "password1"
  });

  assert.ok(registered.token);
  assert.equal(registered.user.email, email);

  const loggedIn = await request(serverEnvironment.app)
    .post("/api/auth/login")
    .send({ email, password: "password1" });

  assert.equal(loggedIn.statusCode, 200);

  const me = await request(serverEnvironment.app)
    .get("/api/auth/me")
    .set("Authorization", `Bearer ${loggedIn.body.token}`);

  assert.equal(me.statusCode, 200);
  assert.equal(me.body.user.email, email);
});

test("request password reset and log in with the new password", async () => {
  const email = `reset-${Date.now()}@example.com`;
  await registerUser({
    name: "Reset User",
    email,
    password: "password1"
  });

  const forgot = await request(serverEnvironment.app)
    .post("/api/auth/forgot-password")
    .send({ email });

  assert.equal(forgot.statusCode, 200);
  assert.ok(forgot.body.devResetCode);

  const reset = await request(serverEnvironment.app)
    .post("/api/auth/reset-password")
    .send({
      email,
      resetCode: forgot.body.devResetCode,
      newPassword: "newpass12"
    });

  assert.equal(reset.statusCode, 200);

  const loggedIn = await request(serverEnvironment.app)
    .post("/api/auth/login")
    .send({ email, password: "newpass12" });

  assert.equal(loggedIn.statusCode, 200);
});

test("enable 2fa and complete login with a security code", async () => {
  const email = `2fa-${Date.now()}@example.com`;
  const registered = await registerUser({
    name: "Two Factor User",
    email,
    password: "password1"
  });

  const setup = await request(serverEnvironment.app)
    .post("/api/auth/2fa/request-setup")
    .set("Authorization", `Bearer ${registered.token}`)
    .send();

  assert.equal(setup.statusCode, 200);
  assert.ok(setup.body.devTwoFactorCode);

  const enabled = await request(serverEnvironment.app)
    .post("/api/auth/2fa/enable")
    .set("Authorization", `Bearer ${registered.token}`)
    .send({ code: setup.body.devTwoFactorCode });

  assert.equal(enabled.statusCode, 200);
  assert.equal(enabled.body.user.twoFactorEnabled, true);

  const login = await request(serverEnvironment.app)
    .post("/api/auth/login")
    .send({ email, password: "password1" });

  assert.equal(login.statusCode, 200);
  assert.equal(login.body.requiresTwoFactor, true);
  assert.ok(login.body.challengeToken);
  assert.ok(login.body.devTwoFactorCode);

  const verified = await request(serverEnvironment.app)
    .post("/api/auth/verify-2fa")
    .send({
      email,
      challengeToken: login.body.challengeToken,
      code: login.body.devTwoFactorCode
    });

  assert.equal(verified.statusCode, 200);
  assert.ok(verified.body.token);
  assert.equal(verified.body.user.twoFactorEnabled, true);
});

test("logout revokes the current session token", async () => {
  const registered = await registerUser({
    name: "Logout User",
    email: `logout-${Date.now()}@example.com`,
    password: "password1"
  });

  const logout = await request(serverEnvironment.app)
    .post("/api/auth/logout")
    .set("Authorization", `Bearer ${registered.token}`)
    .send();

  assert.equal(logout.statusCode, 200);

  const me = await request(serverEnvironment.app)
    .get("/api/auth/me")
    .set("Authorization", `Bearer ${registered.token}`);

  assert.equal(me.statusCode, 401);
});

test("send, edit, react to, and delete a message", async () => {
  const alice = await registerUser({
    name: "Alice Route",
    email: `alice-${Date.now()}@example.com`,
    password: "password1"
  });
  const bob = await registerUser({
    name: "Bob Route",
    email: `bob-${Date.now()}@example.com`,
    password: "password1"
  });

  const sent = await request(serverEnvironment.app)
    .post(`/api/messages/${bob.user.id}`)
    .set("Authorization", `Bearer ${alice.token}`)
    .send({ text: "hello" });

  assert.equal(sent.statusCode, 201);

  const edited = await request(serverEnvironment.app)
    .patch(`/api/messages/${sent.body.id}`)
    .set("Authorization", `Bearer ${alice.token}`)
    .send({ text: "hello updated" });

  assert.equal(edited.statusCode, 200);
  assert.equal(edited.body.text, "hello updated");

  const reacted = await request(serverEnvironment.app)
    .post(`/api/messages/${sent.body.id}/reactions`)
    .set("Authorization", `Bearer ${bob.token}`)
    .send({ emoji: "👍" });

  assert.equal(reacted.statusCode, 200);
  assert.equal(reacted.body.reactions[0].emoji, "👍");

  const deleted = await request(serverEnvironment.app)
    .delete(`/api/messages/${sent.body.id}`)
    .set("Authorization", `Bearer ${alice.token}`);

  assert.equal(deleted.statusCode, 200);
  assert.ok(deleted.body.deletedAt);
});

test("socket emits typing and message events", async () => {
  const alice = await registerUser({
    name: "Alice Socket",
    email: `socket-a-${Date.now()}@example.com`,
    password: "password1"
  });
  const bob = await registerUser({
    name: "Bob Socket",
    email: `socket-b-${Date.now()}@example.com`,
    password: "password1"
  });

  const aliceSocket = connectSocket(alice.token);
  const bobSocket = connectSocket(bob.token);
  const aliceConnect = waitForEvent(aliceSocket, "connect");
  const bobConnect = waitForEvent(bobSocket, "connect");
  const aliceReady = waitForEvent(aliceSocket, "presence:snapshot");
  const bobReady = waitForEvent(bobSocket, "presence:snapshot");

  aliceSocket.connect();
  bobSocket.connect();

  await Promise.all([aliceConnect, bobConnect, aliceReady, bobReady]);

  const typingEvent = waitForEvent(bobSocket, "typing:start");
  aliceSocket.emit("typing:start", { toUserId: bob.user.id });
  const typingPayload = await typingEvent;
  assert.equal(typingPayload.fromUserId, alice.user.id);

  const messageEvent = waitForEvent(bobSocket, "message:new");
  await request(serverEnvironment.app)
    .post(`/api/messages/${bob.user.id}`)
    .set("Authorization", `Bearer ${alice.token}`)
    .send({ text: "from socket flow" });

  const receivedMessage = await messageEvent;
  assert.equal(receivedMessage.text, "from socket flow");

  await Promise.all([disconnectSocket(aliceSocket), disconnectSocket(bobSocket)]);
});

test("invoice payment: paidAmount exactly equals remaining balance -> 200, fully paid, balanced journal", async () => {
  // Setup: accounting-enabled finance workspace with an approved invoice and no prior payments.
  // Input: paidAmount 100 for a 100 outstanding balance.
  // Expected HTTP status: 200.
  // Expected DB state after: invoice marked paid, paidAmount = 100, one payment recorded.
  // Expected journal state after: one invoice_payment entry posted for 100 debit / 100 credit, balanced.
  const context = await createFinanceWorkspaceActor({ accountingEnabled: true });
  const invoice = await createInvoice(context, { amount: 100, status: "approved" });

  const response = await markInvoicePaid(context, invoice._id, { paidAmount: 100, method: "bank" });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, "paid");
  assert.equal(response.body.paidAmount, 100);

  const storedInvoice = await findInvoice(invoice._id);
  assert.equal(storedInvoice.status, "paid");
  assert.equal(storedInvoice.paidAmount, 100);
  assert.equal(storedInvoice.payments.length, 1);
  assert.equal(storedInvoice.payments[0].amount, 100);

  const paymentJournals = await findInvoicePaymentJournals(context.workspace._id, invoice._id);
  assert.equal(paymentJournals.length, 1);
  assertBalancedPaymentJournal(paymentJournals[0], 100);
});

test("invoice payment: paidAmount less than remaining balance -> 200, partial, balanced journal", async () => {
  // Setup: accounting-enabled finance workspace with an approved invoice and full balance still open.
  // Input: paidAmount 40 against a 100 invoice.
  // Expected HTTP status: 200.
  // Expected DB state after: invoice marked partial, paidAmount = 40, one payment recorded.
  // Expected journal state after: one invoice_payment entry posted for 40 debit / 40 credit, balanced.
  const context = await createFinanceWorkspaceActor({ accountingEnabled: true });
  const invoice = await createInvoice(context, { amount: 100, status: "approved" });

  const response = await markInvoicePaid(context, invoice._id, { paidAmount: 40, method: "cash" });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, "partial");
  assert.equal(response.body.paidAmount, 40);

  const storedInvoice = await findInvoice(invoice._id);
  assert.equal(storedInvoice.status, "partial");
  assert.equal(storedInvoice.paidAmount, 40);
  assert.equal(storedInvoice.payments.length, 1);
  assert.equal(storedInvoice.payments[0].remainingBalance, 60);

  const paymentJournals = await findInvoicePaymentJournals(context.workspace._id, invoice._id);
  assert.equal(paymentJournals.length, 1);
  assertBalancedPaymentJournal(paymentJournals[0], 40);
});

test("invoice payment: paidAmount greater than remaining balance -> 400 and no journals", async () => {
  // Setup: accounting-enabled finance workspace with an approved invoice and 100 outstanding.
  // Input: paidAmount 150.
  // Expected HTTP status: 400.
  // Expected DB state after: invoice unchanged, no payment recorded.
  // Expected journal state after: no journal entries created.
  const context = await createFinanceWorkspaceActor({ accountingEnabled: true });
  const invoice = await createInvoice(context, { amount: 100, status: "approved" });

  const response = await markInvoicePaid(context, invoice._id, { paidAmount: 150 });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.message, "Payment exceeds outstanding balance");

  const storedInvoice = await findInvoice(invoice._id);
  assert.equal(storedInvoice.status, "approved");
  assert.equal(storedInvoice.paidAmount, 0);
  assert.equal(storedInvoice.payments.length, 0);

  const journals = await findInvoiceJournals(context.workspace._id, invoice._id);
  assert.equal(journals.length, 0);
});

test("invoice payment: paidAmount zero -> 400 and no journals", async () => {
  // Setup: accounting-enabled finance workspace with an approved invoice and 100 outstanding.
  // Input: paidAmount 0.
  // Expected HTTP status: 400.
  // Expected DB state after: invoice unchanged.
  // Expected journal state after: no journal entries created.
  const context = await createFinanceWorkspaceActor({ accountingEnabled: true });
  const invoice = await createInvoice(context, { amount: 100, status: "approved" });

  const response = await markInvoicePaid(context, invoice._id, { paidAmount: 0 });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.message, "Amount must be greater than zero");

  const storedInvoice = await findInvoice(invoice._id);
  assert.equal(storedInvoice.status, "approved");
  assert.equal(storedInvoice.paidAmount, 0);
  assert.equal(storedInvoice.payments.length, 0);

  const journals = await findInvoiceJournals(context.workspace._id, invoice._id);
  assert.equal(journals.length, 0);
});

test("invoice payment: paidAmount negative -> 400 and no journals", async () => {
  // Setup: accounting-enabled finance workspace with an approved invoice and 100 outstanding.
  // Input: paidAmount -25.
  // Expected HTTP status: 400.
  // Expected DB state after: invoice unchanged.
  // Expected journal state after: no journal entries created.
  const context = await createFinanceWorkspaceActor({ accountingEnabled: true });
  const invoice = await createInvoice(context, { amount: 100, status: "approved" });

  const response = await markInvoicePaid(context, invoice._id, { paidAmount: -25 });

  assert.equal(response.statusCode, 400);

  const storedInvoice = await findInvoice(invoice._id);
  assert.equal(storedInvoice.status, "approved");
  assert.equal(storedInvoice.paidAmount, 0);
  assert.equal(storedInvoice.payments.length, 0);

  const journals = await findInvoiceJournals(context.workspace._id, invoice._id);
  assert.equal(journals.length, 0);
});

test("invoice payment: already fully paid invoice -> 409 and no journals", async () => {
  // Setup: accounting-enabled finance workspace with a fully paid invoice already settled.
  // Input: any paidAmount, here 10.
  // Expected HTTP status: 409.
  // Expected DB state after: invoice unchanged as fully paid.
  // Expected journal state after: no new journal entries created.
  const context = await createFinanceWorkspaceActor({ accountingEnabled: true });
  const invoice = await createInvoice(context, {
    amount: 100,
    status: "paid",
    paidAmount: 100,
    paidAt: new Date(),
    payments: [
      {
        amount: 100,
        recordedAt: new Date(Date.now() - 60_000),
        remainingBalance: 0,
        method: "cash",
        recordedBy: context.user.id
      }
    ],
    paidBy: context.user.id
  });

  const response = await markInvoicePaid(context, invoice._id, { paidAmount: 10 });

  assert.equal(response.statusCode, 409);
  assert.equal(response.body.message, "Invoice already settled");

  const storedInvoice = await findInvoice(invoice._id);
  assert.equal(storedInvoice.status, "paid");
  assert.equal(storedInvoice.paidAmount, 100);
  assert.equal(storedInvoice.payments.length, 1);

  const journals = await findInvoiceJournals(context.workspace._id, invoice._id);
  assert.equal(journals.length, 0);
});

test("invoice payment edge: paidAmount as string parses correctly and posts a balanced journal", async () => {
  // Setup: accounting-enabled finance workspace with an approved invoice and 100 outstanding.
  // Input: paidAmount \"100\" as a string.
  // Expected HTTP status: 200.
  // Expected DB state after: invoice marked paid, paidAmount = 100.
  // Expected journal state after: one invoice_payment entry posted for 100 debit / 100 credit, balanced.
  const context = await createFinanceWorkspaceActor({ accountingEnabled: true });
  const invoice = await createInvoice(context, { amount: 100, status: "approved" });

  const response = await markInvoicePaid(context, invoice._id, { paidAmount: "100" });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, "paid");
  assert.equal(response.body.paidAmount, 100);

  const storedInvoice = await findInvoice(invoice._id);
  assert.equal(storedInvoice.status, "paid");
  assert.equal(storedInvoice.paidAmount, 100);

  const paymentJournals = await findInvoicePaymentJournals(context.workspace._id, invoice._id);
  assert.equal(paymentJournals.length, 1);
  assertBalancedPaymentJournal(paymentJournals[0], 100);
});

test("invoice payment edge: paidAmount with extra precision rounds to the currency minor unit", async () => {
  // Setup: accounting-enabled finance workspace with an approved invoice and 150 outstanding.
  // Input: paidAmount 100.999.
  // Expected HTTP status: 200.
  // Expected DB state after: invoice remains partial with paidAmount rounded to 101.
  // Expected journal state after: one invoice_payment entry posted for 101 debit / 101 credit, balanced.
  const context = await createFinanceWorkspaceActor({ accountingEnabled: true });
  const invoice = await createInvoice(context, { amount: 150, status: "approved" });

  const response = await markInvoicePaid(context, invoice._id, { paidAmount: 100.999 });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, "partial");
  assert.equal(response.body.paidAmount, 101);

  const storedInvoice = await findInvoice(invoice._id);
  assert.equal(storedInvoice.status, "partial");
  assert.equal(storedInvoice.paidAmount, 101);
  assert.equal(storedInvoice.payments[0].amount, 101);

  const paymentJournals = await findInvoicePaymentJournals(context.workspace._id, invoice._id);
  assert.equal(paymentJournals.length, 1);
  assertBalancedPaymentJournal(paymentJournals[0], 101);
});

test("invoice payment edge: locked period -> 423 and no journal entry", async () => {
  // Setup: accounting-enabled finance workspace with an approved invoice and a lock for the current finance period.
  // Input: paidAmount 25.
  // Expected HTTP status: 423.
  // Expected DB state after: invoice payment not recorded; control status marked blocked.
  // Expected journal state after: no journal entries created.
  const context = await createFinanceWorkspaceActor({ accountingEnabled: true });
  const invoice = await createInvoice(context, { amount: 100, status: "approved" });
  const { periodKey, periodStart, periodEnd } = periodRangeFromDate(new Date());

  await FinancePeriodLock.create({
    workspaceId: context.workspace._id,
    periodKey,
    periodStart,
    periodEnd,
    note: "QA lock",
    lockedBy: context.user.id
  });

  const response = await markInvoicePaid(context, invoice._id, { paidAmount: 25 });

  assert.equal(response.statusCode, 423);

  const storedInvoice = await findInvoice(invoice._id);
  assert.equal(storedInvoice.status, "approved");
  assert.equal(storedInvoice.paidAmount, 0);
  assert.equal(storedInvoice.payments.length, 0);
  assert.equal(storedInvoice.accounting.controlStatus, "blocked");

  const journals = await findInvoiceJournals(context.workspace._id, invoice._id);
  assert.equal(journals.length, 0);
});

test("invoice payment concurrency: simultaneous identical full-balance payments only record one success", async () => {
  // Setup: invoice balance 1000 with accounting enabled and no prior payments.
  // Input: 5 concurrent requests each sending paidAmount 1000 with Promise.all.
  // Expected HTTP status: exactly 1 returns 200; the others fail cleanly with 400/409.
  // Expected DB state after: paidAmount = 1000 and exactly 1 payment row exists.
  // Expected journal state after: exactly 1 posted invoice_payment journal exists.
  const context = await createFinanceWorkspaceActor({ accountingEnabled: true });
  const invoice = await createInvoice(context, { amount: 1000, status: "approved" });

  const responses = await Promise.all(
    Array.from({ length: 5 }, () => markInvoicePaid(context, invoice._id, { paidAmount: 1000 }))
  );

  const successResponses = responses.filter((response) => response.statusCode === 200);
  const failureResponses = responses.filter((response) => response.statusCode !== 200);

  assert.equal(successResponses.length, 1);
  assert.equal(failureResponses.length, 4);
  failureResponses.forEach((response) => {
    assert.ok([400, 409].includes(response.statusCode));
  });

  const storedInvoice = await findInvoice(invoice._id);
  const sumOfPayments = sumPaymentAmounts(storedInvoice);
  assert.equal(storedInvoice.paidAmount, 1000);
  assert.equal(storedInvoice.payments.length, 1);
  assert.equal(sumOfPayments, storedInvoice.paidAmount);
  assert.ok(storedInvoice.payments.every((payment) => payment.amount <= storedInvoice.amount));

  const paymentJournals = await findInvoicePaymentJournals(context.workspace._id, invoice._id);
  assert.equal(paymentJournals.length, 1);
  assertBalancedPaymentJournal(paymentJournals[0], 1000);
});

test("invoice payment concurrency: simultaneous partial payments never exceed the invoice balance", async () => {
  // Setup: invoice balance 500 with accounting enabled and no prior payments.
  // Input: 3 concurrent requests each sending paidAmount 300 with Promise.all.
  // Expected: successful recorded payments never sum above 500, and no remaining balance goes negative.
  // Expected DB state after: paidAmount <= 500 and matches payment row sum.
  // Expected journal state after: one posted payment journal per successful payment.
  const context = await createFinanceWorkspaceActor({ accountingEnabled: true });
  const invoice = await createInvoice(context, { amount: 500, status: "approved" });

  const responses = await Promise.all([
    markInvoicePaid(context, invoice._id, { paidAmount: 300 }),
    markInvoicePaid(context, invoice._id, { paidAmount: 300 }),
    markInvoicePaid(context, invoice._id, { paidAmount: 300 })
  ]);

  const successResponses = responses.filter((response) => response.statusCode === 200);
  const failureResponses = responses.filter((response) => response.statusCode !== 200);

  assert.ok(successResponses.length >= 1);
  failureResponses.forEach((response) => {
    assert.ok([400, 409].includes(response.statusCode));
  });

  const storedInvoice = await findInvoice(invoice._id);
  const sumOfPayments = sumPaymentAmounts(storedInvoice);
  assert.ok(storedInvoice.paidAmount <= 500);
  assert.equal(storedInvoice.paidAmount, sumOfPayments);
  assert.ok(storedInvoice.payments.every((payment) => payment.amount <= storedInvoice.amount));
  assert.ok(storedInvoice.payments.every((payment) => Number(payment.remainingBalance || 0) >= 0));

  const paymentJournals = await findInvoicePaymentJournals(context.workspace._id, invoice._id);
  assert.equal(paymentJournals.length, successResponses.length);
  paymentJournals.forEach((entry) => {
    assertBalancedPaymentJournal(entry, entry.totalDebit);
  });
});

test("invoice payment concurrency: read-modify-write integrity allows only four 50 payments on a 200 balance", async () => {
  // Setup: invoice balance 200 with accounting enabled and no prior payments.
  // Input: 10 concurrent requests each sending paidAmount 50 with Promise.all.
  // Expected HTTP status: exactly 4 succeed and the rest fail cleanly.
  // Expected DB state after: paidAmount = 200, payment rows sum to 200, no negative balance.
  // Expected journal state after: exactly 4 posted invoice_payment journals.
  const context = await createFinanceWorkspaceActor({ accountingEnabled: true });
  const invoice = await createInvoice(context, { amount: 200, status: "approved" });

  const responses = await Promise.all(
    Array.from({ length: 10 }, () => markInvoicePaid(context, invoice._id, { paidAmount: 50 }))
  );

  const successResponses = responses.filter((response) => response.statusCode === 200);
  const failureResponses = responses.filter((response) => response.statusCode !== 200);

  assert.equal(successResponses.length, 4);
  assert.equal(failureResponses.length, 6);
  failureResponses.forEach((response) => {
    assert.ok([400, 409].includes(response.statusCode));
  });

  const storedInvoice = await findInvoice(invoice._id);
  const sumOfPayments = sumPaymentAmounts(storedInvoice);
  assert.equal(storedInvoice.paidAmount, 200);
  assert.equal(storedInvoice.payments.length, 4);
  assert.equal(sumOfPayments, 200);
  assert.ok(storedInvoice.payments.every((payment) => payment.amount <= storedInvoice.amount));
  assert.ok(storedInvoice.payments.every((payment) => Number(payment.remainingBalance || 0) >= 0));

  const paymentJournals = await findInvoicePaymentJournals(context.workspace._id, invoice._id);
  assert.equal(paymentJournals.length, 4);
  paymentJournals.forEach((entry) => {
    assertBalancedPaymentJournal(entry, 50);
  });
});

test("invoice payment concurrency: idempotency-key retry is pending because the API does not support idempotent payment keys yet", { todo: true }, async () => {
  // Intended future test:
  // - send the same payment twice with the same Idempotency-Key header
  // - expect the second response to replay the first 200 without creating a duplicate payment row
  // This remains pending until the API adds request-level idempotency support.
});

test("finance summary: single currency workspace returns totals partitioned by USD", async () => {
  // Setup: 3 USD invoices (100, 200, 300).
  // Input: GET /finance/summary.
  // Expected HTTP status: 200.
  // Expected DB state after: unchanged invoice set.
  // Expected summary state after: response.totals.USD.totalInvoiced = 600 and no mixed top-level total field.
  const context = await createFinanceWorkspaceActor();
  await Promise.all([
    createInvoice(context, { amount: 100, currency: "USD", status: "approved" }),
    createInvoice(context, { amount: 200, currency: "USD", status: "approved" }),
    createInvoice(context, { amount: 300, currency: "USD", status: "approved" })
  ]);

  const response = await getFinanceSummary(context);

  assert.equal(response.statusCode, 200);
  assert.ok(response.body.totals && typeof response.body.totals === "object");
  assert.equal(response.body.totals.USD.totalInvoiced, 600);
  assert.ok(!Object.prototype.hasOwnProperty.call(response.body, "totalInvoiced"));
});

test("finance summary: mixed currency workspace does not aggregate invoice totals across currencies", async () => {
  // Setup: USD invoices 100, 200 and EUR invoices 150, 250.
  // Input: GET /finance/summary.
  // Expected HTTP status: 200.
  // Expected summary state after: totals are keyed by currency, never a single numeric aggregate.
  const context = await createFinanceWorkspaceActor();
  await Promise.all([
    createInvoice(context, { amount: 100, currency: "USD", status: "approved" }),
    createInvoice(context, { amount: 200, currency: "USD", status: "approved" }),
    createInvoice(context, { amount: 150, currency: "EUR", status: "approved" }),
    createInvoice(context, { amount: 250, currency: "EUR", status: "approved" })
  ]);

  const response = await getFinanceSummary(context);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.totals, {
    USD: {
      totalInvoiced: 300,
      outstandingAmount: 300,
      paidAmount: 0,
      overdueAmount: 0
    },
    EUR: {
      totalInvoiced: 400,
      outstandingAmount: 400,
      paidAmount: 0,
      overdueAmount: 0
    }
  });
  assert.ok(!Object.prototype.hasOwnProperty.call(response.body.totals, "totalInvoiced"));
});

test("finance journal export: mixed currency accounting totals stay partitioned by currency", async () => {
  // Setup: posted journal entries in USD and EUR.
  // Input: GET /finance/accounting/exports/journals.
  // Expected HTTP status: 200.
  // Expected journal state after: separate debit/credit totals per currency, never one mixed total.
  const context = await createFinanceWorkspaceActor({ accountingEnabled: true });
  const now = new Date();
  await JournalEntry.create([
    {
      workspaceId: context.workspace._id,
      entryNumber: `JE-USD-${Date.now()}-A`,
      entryType: "invoice_payment",
      postingDate: now,
      status: "posted",
      description: "USD payment",
      sourceType: "invoice",
      sourceId: new mongoose.Types.ObjectId(),
      lines: [
        { accountId: new mongoose.Types.ObjectId(), accountCode: "1000", accountName: "Cash", accountType: "asset", debit: 125, credit: 0, memo: "USD Dr" },
        { accountId: new mongoose.Types.ObjectId(), accountCode: "1100", accountName: "Accounts Receivable", accountType: "asset", debit: 0, credit: 125, memo: "USD Cr" }
      ],
      totalDebit: 125,
      totalCredit: 125,
      metadata: { currency: "USD" },
      createdBy: context.user.id
    },
    {
      workspaceId: context.workspace._id,
      entryNumber: `JE-EUR-${Date.now()}-B`,
      entryType: "invoice_payment",
      postingDate: now,
      status: "posted",
      description: "EUR payment",
      sourceType: "invoice",
      sourceId: new mongoose.Types.ObjectId(),
      lines: [
        { accountId: new mongoose.Types.ObjectId(), accountCode: "1000", accountName: "Cash", accountType: "asset", debit: 80, credit: 0, memo: "EUR Dr" },
        { accountId: new mongoose.Types.ObjectId(), accountCode: "1100", accountName: "Accounts Receivable", accountType: "asset", debit: 0, credit: 80, memo: "EUR Cr" }
      ],
      totalDebit: 80,
      totalCredit: 80,
      metadata: { currency: "EUR" },
      createdBy: context.user.id
    }
  ]);

  const response = await getJournalExport(context);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.totals.USD.totalDebits, 125);
  assert.deepEqual(response.body.totals.EUR.totalDebits, 80);
  assert.ok(!Object.prototype.hasOwnProperty.call(response.body.totals, "totalDebits"));
});

test("finance invoice creation: missing currency is rejected before summary ingestion", async () => {
  // Setup: finance-enabled workspace with no invoices.
  // Input: POST /finance/invoices without currency.
  // Expected HTTP status: 400.
  // Expected DB state after: no invoice is created.
  const context = await createFinanceWorkspaceActor();

  const response = await createInvoiceViaApi(context, {
    invoiceNumber: `INV-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    vendorName: "No Currency Vendor",
    amount: 100,
    dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    status: "approved"
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.message, "Invoice currency is required.");

  const invoiceCount = await InvoiceRecord.countDocuments({ workspaceId: context.workspace._id });
  assert.equal(invoiceCount, 0);
});

test("finance summary: totals match manual record sums for total, paid, and unpaid subsets", async () => {
  // Setup: 10 known USD invoices, 5 fully paid and 5 unpaid approved.
  // Input: GET /finance/summary.
  // Expected HTTP status: 200.
  // Expected summary state after: totalInvoiced, paidAmount, and outstandingAmount match manual sums.
  const context = await createFinanceWorkspaceActor();
  const paidInvoices = [50, 75, 100, 125, 150];
  const unpaidInvoices = [20, 30, 40, 60, 80];

  await Promise.all([
    ...paidInvoices.map((amount, index) =>
      createInvoice(context, {
        invoiceNumber: `INV-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        amount,
        currency: "USD",
        status: "paid",
        paidAmount: amount,
        paidAt: new Date(),
        payments: [
          {
            amount,
            recordedAt: new Date(),
            remainingBalance: 0,
            method: "cash",
            recordedBy: context.user.id
          }
        ],
        paidBy: context.user.id
      })
    ),
    ...unpaidInvoices.map((amount, index) =>
      createInvoice(context, {
        invoiceNumber: `INV-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        amount,
        currency: "USD",
        status: "approved",
        paidAmount: 0
      })
    )
  ]);

  const response = await getFinanceSummary(context);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.totals.USD.totalInvoiced, sumInvoiceAmounts([
    ...paidInvoices.map((amount) => ({ amount })),
    ...unpaidInvoices.map((amount) => ({ amount }))
  ]));
  assert.equal(response.body.totals.USD.paidAmount, paidInvoices.reduce((sum, amount) => sum + amount, 0));
  assert.equal(response.body.totals.USD.outstandingAmount, unpaidInvoices.reduce((sum, amount) => sum + amount, 0));
});

test("finance summary snapshot shape: totals are keyed by currency and monetary values are currency-associated", async () => {
  // Setup: mixed USD and EUR invoices.
  // Input: GET /finance/summary.
  // Expected shape: response.totals is keyed by currency code and there is no currency-less top-level monetary total.
  const context = await createFinanceWorkspaceActor();
  await Promise.all([
    createInvoice(context, { amount: 90, currency: "USD", status: "approved" }),
    createInvoice(context, { amount: 110, currency: "EUR", status: "approved" })
  ]);

  const response = await getFinanceSummary(context);

  assert.equal(response.statusCode, 200);
  assert.ok(response.body.totals && typeof response.body.totals === "object");
  for (const [currency, bucket] of Object.entries(response.body.totals)) {
    assert.match(currency, /^[A-Z]{3}$/);
    assert.equal(typeof bucket.totalInvoiced, "number");
    assert.equal(typeof bucket.outstandingAmount, "number");
    assert.equal(typeof bucket.paidAmount, "number");
    assert.equal(typeof bucket.overdueAmount, "number");
  }
  assert.ok(!Object.prototype.hasOwnProperty.call(response.body, "totalDebits"));
  assert.ok(!Object.prototype.hasOwnProperty.call(response.body, "totalCredits"));
});

test("finance journal export snapshot shape: totals object is keyed by currency code", async () => {
  // Setup: accounting-enabled workspace with one USD posted journal.
  // Input: GET /finance/accounting/exports/journals.
  // Expected shape: response.totals is keyed by currency and has no top-level mixed debit/credit totals.
  const context = await createFinanceWorkspaceActor({ accountingEnabled: true });
  await JournalEntry.create({
    workspaceId: context.workspace._id,
    entryNumber: `JE-SHAPE-${Date.now()}`,
    entryType: "invoice_payment",
    postingDate: new Date(),
    status: "posted",
    description: "USD shape journal",
    sourceType: "invoice",
    sourceId: new mongoose.Types.ObjectId(),
    lines: [
      { accountId: new mongoose.Types.ObjectId(), accountCode: "1000", accountName: "Cash", accountType: "asset", debit: 50, credit: 0, memo: "shape dr" },
      { accountId: new mongoose.Types.ObjectId(), accountCode: "1100", accountName: "Accounts Receivable", accountType: "asset", debit: 0, credit: 50, memo: "shape cr" }
    ],
    totalDebit: 50,
    totalCredit: 50,
    metadata: { currency: "USD" },
    createdBy: context.user.id
  });

  const response = await getJournalExport(context);

  assert.equal(response.statusCode, 200);
  assert.ok(response.body.totals && typeof response.body.totals === "object");
  for (const [currency, bucket] of Object.entries(response.body.totals)) {
    assert.match(currency, /^[A-Z]{3}$/);
    assert.equal(typeof bucket.totalDebits, "number");
    assert.equal(typeof bucket.totalCredits, "number");
  }
  assert.ok(!Object.prototype.hasOwnProperty.call(response.body.totals, "totalDebits"));
  assert.ok(!Object.prototype.hasOwnProperty.call(response.body.totals, "totalCredits"));
});
