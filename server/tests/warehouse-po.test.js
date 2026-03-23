import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import request from "supertest";

import { createServerEnvironment } from "../src/app.js";
import { connectDB } from "../src/config/db.js";
import { ExpenseRecord } from "../src/models/ExpenseRecord.js";
import { PurchaseOrder } from "../src/models/PurchaseOrder.js";
import { WarehouseProduct } from "../src/models/WarehouseProduct.js";
import { Workspace } from "../src/models/Workspace.js";
import { WorkspaceMembership } from "../src/models/WorkspaceMembership.js";

let mongoServer;
let serverEnvironment;

async function registerUser(user) {
  const response = await request(serverEnvironment.app).post("/api/auth/register").send(user);
  assert.equal(response.statusCode, 201);
  return response.body;
}

async function createWarehouseWorkspaceActor({
  workspace = null,
  workspaceRole = workspace ? "member" : "owner",
  financeRoles = ["viewer", "finance_staff"],
  modules = ["warehouse"],
  accountingEnabled = false
} = {}) {
  const registered = await registerUser({
    name: `Warehouse PO ${workspaceRole}`,
    email: `warehouse-po-${crypto.randomUUID()}@example.com`,
    password: "password1"
  });

  const activeWorkspace =
    workspace ||
    (await Workspace.create({
      name: `Warehouse PO ${crypto.randomUUID().slice(0, 8)}`,
      slug: `warehouse-po-${crypto.randomUUID().slice(0, 8)}`,
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

function buildHeaders(context) {
  return {
    Authorization: `Bearer ${context.token}`,
    "x-workspace-id": context.workspace._id.toString()
  };
}

async function createWarehouseProduct(context, overrides = {}) {
  return WarehouseProduct.create({
    workspaceId: context.workspace._id,
    name: overrides.name || "Cardboard Boxes",
    sku: overrides.sku || `SKU-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
    itemType: overrides.itemType || "inventory",
    unit: overrides.unit || "units",
    currentStock: overrides.currentStock ?? 10,
    minimumStock: overrides.minimumStock ?? 20,
    reorderThreshold: overrides.reorderThreshold ?? overrides.minimumStock ?? 20,
    reorderQuantity: overrides.reorderQuantity ?? 50,
    alertStatus: overrides.alertStatus || "active",
    productStatus: overrides.productStatus || "active",
    createdBy: context.user.id,
    updatedBy: context.user.id
  });
}

async function createPurchaseOrder(context, payload) {
  return request(serverEnvironment.app)
    .post("/api/purchase-orders")
    .set(buildHeaders(context))
    .send(payload);
}

async function sendPurchaseOrder(context, orderId) {
  return request(serverEnvironment.app)
    .patch(`/api/purchase-orders/${orderId}/send`)
    .set(buildHeaders(context))
    .send({});
}

async function receivePurchaseOrder(context, orderId, payload) {
  return request(serverEnvironment.app)
    .patch(`/api/purchase-orders/${orderId}/receive`)
    .set(buildHeaders(context))
    .send(payload);
}

async function cancelPurchaseOrder(context, orderId) {
  return request(serverEnvironment.app)
    .patch(`/api/purchase-orders/${orderId}/cancel`)
    .set(buildHeaders(context))
    .send({});
}

async function getWarehouseAlerts(context) {
  return request(serverEnvironment.app)
    .get("/api/warehouse/alerts")
    .set(buildHeaders(context));
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

test("purchase order create: returns 201 with computed totals and draft status", async () => {
  const actor = await createWarehouseWorkspaceActor();
  const product = await createWarehouseProduct(actor);

  const response = await createPurchaseOrder(actor, {
    vendorName: "Supply Co",
    currency: "USD",
    lineItems: [
      {
        itemId: product._id.toString(),
        itemName: product.name,
        sku: product.sku,
        quantity: 5,
        unitCost: 12
      }
    ],
    notes: "Restock core packaging"
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.status, "draft");
  assert.match(response.body.orderNumber, /^PO-\d{6}-\d{4}$/);
  assert.equal(response.body.totalAmount, 60);
  assert.equal(response.body.lineItems.length, 1);
  assert.equal(response.body.lineItems[0].receivedQuantity, 0);
});

test("purchase order send: draft transitions to sent", async () => {
  const actor = await createWarehouseWorkspaceActor();
  const product = await createWarehouseProduct(actor);
  const created = await createPurchaseOrder(actor, {
    vendorName: "Supply Co",
    lineItems: [
      {
        itemId: product._id.toString(),
        itemName: product.name,
        sku: product.sku,
        quantity: 4,
        unitCost: 10
      }
    ]
  });

  const response = await sendPurchaseOrder(actor, created.body.id);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, "sent");
  assert.ok(response.body.sentAt);
});

test("purchase order receive: full receipt sets received and updates inventory", async () => {
  const actor = await createWarehouseWorkspaceActor();
  const product = await createWarehouseProduct(actor, { currentStock: 10 });
  const created = await createPurchaseOrder(actor, {
    vendorName: "Supply Co",
    lineItems: [
      {
        itemId: product._id.toString(),
        itemName: product.name,
        sku: product.sku,
        quantity: 6,
        unitCost: 8
      }
    ]
  });
  await sendPurchaseOrder(actor, created.body.id);

  const response = await receivePurchaseOrder(actor, created.body.id, {
    lineItems: [
      {
        lineItemId: created.body.lineItems[0].id,
        receivedQuantity: 6
      }
    ]
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, "received");
  assert.ok(response.body.receivedAt);
  assert.equal(response.body.lineItems[0].receivedQuantity, 6);

  const savedProduct = await WarehouseProduct.findById(product._id).lean();
  assert.equal(savedProduct.currentStock, 16);
});

test("purchase order receive: partial receipt sets partially_received", async () => {
  const actor = await createWarehouseWorkspaceActor();
  const product = await createWarehouseProduct(actor, { currentStock: 15 });
  const created = await createPurchaseOrder(actor, {
    vendorName: "Supply Co",
    lineItems: [
      {
        itemId: product._id.toString(),
        itemName: product.name,
        sku: product.sku,
        quantity: 10,
        unitCost: 5
      }
    ]
  });
  await sendPurchaseOrder(actor, created.body.id);

  const response = await receivePurchaseOrder(actor, created.body.id, {
    lineItems: [
      {
        lineItemId: created.body.lineItems[0].id,
        receivedQuantity: 4
      }
    ]
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, "partially_received");
  assert.equal(response.body.lineItems[0].receivedQuantity, 4);
  assert.equal(response.body.receivedAt, null);
});

test("purchase order cancel: sent order becomes cancelled", async () => {
  const actor = await createWarehouseWorkspaceActor();
  const product = await createWarehouseProduct(actor);
  const created = await createPurchaseOrder(actor, {
    vendorName: "Supply Co",
    lineItems: [
      {
        itemId: product._id.toString(),
        itemName: product.name,
        sku: product.sku,
        quantity: 3,
        unitCost: 9
      }
    ]
  });
  await sendPurchaseOrder(actor, created.body.id);

  const response = await cancelPurchaseOrder(actor, created.body.id);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, "cancelled");
});

test("purchase order cancel: received order returns 409", async () => {
  const actor = await createWarehouseWorkspaceActor();
  const product = await createWarehouseProduct(actor);
  const created = await createPurchaseOrder(actor, {
    vendorName: "Supply Co",
    lineItems: [
      {
        itemId: product._id.toString(),
        itemName: product.name,
        sku: product.sku,
        quantity: 2,
        unitCost: 11
      }
    ]
  });
  await sendPurchaseOrder(actor, created.body.id);
  await receivePurchaseOrder(actor, created.body.id, {
    lineItems: [
      {
        lineItemId: created.body.lineItems[0].id,
        receivedQuantity: 2
      }
    ]
  });

  const response = await cancelPurchaseOrder(actor, created.body.id);

  assert.equal(response.statusCode, 409);
  assert.match(response.body.message, /transition/i);
});

test("purchase order receive: creates finance expense when finance is enabled", async () => {
  const actor = await createWarehouseWorkspaceActor({
    modules: ["warehouse", "finance"],
    financeRoles: ["viewer", "finance_staff"]
  });
  const product = await createWarehouseProduct(actor, { currentStock: 5 });
  const created = await createPurchaseOrder(actor, {
    vendorName: "Supply Co",
    currency: "USD",
    lineItems: [
      {
        itemId: product._id.toString(),
        itemName: product.name,
        sku: product.sku,
        quantity: 5,
        unitCost: 20
      }
    ]
  });
  await sendPurchaseOrder(actor, created.body.id);

  const response = await receivePurchaseOrder(actor, created.body.id, {
    lineItems: [
      {
        lineItemId: created.body.lineItems[0].id,
        receivedQuantity: 5
      }
    ]
  });

  assert.equal(response.statusCode, 200);
  assert.ok(response.body.financeExpenseId);
  assert.equal(response.body.financeExpense?.status, "pending_review");
  assert.equal(response.body.financeExpense?.amount, 100);

  const expense = await ExpenseRecord.findById(response.body.financeExpenseId).lean();
  assert.ok(expense);
  assert.equal(expense.vendorName, "Supply Co");
  assert.equal(expense.amount, 100);
  assert.equal(expense.source, "purchase_order");
  assert.equal(expense.sourceId?.toString(), created.body.id);
  assert.equal(expense.status, "pending_review");
});

test("warehouse alerts: returns only items below threshold", async () => {
  const actor = await createWarehouseWorkspaceActor();
  await createWarehouseProduct(actor, {
    name: "Critical Item",
    currentStock: 4,
    minimumStock: 10,
    reorderThreshold: 10,
    reorderQuantity: 20
  });
  await createWarehouseProduct(actor, {
    name: "Healthy Item",
    currentStock: 25,
    minimumStock: 10,
    reorderThreshold: 10,
    reorderQuantity: 30
  });

  const response = await getWarehouseAlerts(actor);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.length, 1);
  assert.equal(response.body[0].itemName, "Critical Item");
  assert.equal(response.body[0].reorderThreshold, 10);
});

test("warehouse alerts: excludes items without threshold set", async () => {
  const actor = await createWarehouseWorkspaceActor();
  await createWarehouseProduct(actor, {
    name: "No Threshold Item",
    currentStock: 1,
    minimumStock: 0,
    reorderThreshold: 0,
    reorderQuantity: 0
  });

  const response = await getWarehouseAlerts(actor);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, []);
});
