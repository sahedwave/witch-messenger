import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { io as ioClient } from "socket.io-client";

import { createServerEnvironment } from "../src/app.js";
import { connectDB } from "../src/config/db.js";

let mongoServer;
let serverEnvironment;
let address;

async function registerUser(user) {
  const response = await request(serverEnvironment.app).post("/api/auth/register").send(user);
  assert.equal(response.statusCode, 201);
  return response.body;
}

function connectSocket(token) {
  return ioClient(address, {
    auth: { token },
    transports: ["websocket"],
    autoConnect: false
  });
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
  mongoServer = await MongoMemoryServer.create({
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

  aliceSocket.connect();
  bobSocket.connect();

  await Promise.all([aliceConnect, bobConnect]);

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

  aliceSocket.disconnect();
  bobSocket.disconnect();
});
