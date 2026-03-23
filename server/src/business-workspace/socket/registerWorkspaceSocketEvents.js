export function registerWorkspaceSocketEvents(io, socket, { redisClient } = {}) {
  socket.on("join_conversation", (conversationId) => {
    socket.join(`conversation:${conversationId}`);
  });

  socket.on("leave_conversation", (conversationId) => {
    socket.leave(`conversation:${conversationId}`);
  });

  socket.on("send_message", ({ conversationId, message }) => {
    io.to(`conversation:${conversationId}`).emit("new_message", message);
  });

  socket.on("typing_start", ({ conversationId, userId }) => {
    socket.to(`conversation:${conversationId}`).emit("user_typing", { userId, conversationId });
  });

  socket.on("typing_stop", ({ conversationId, userId }) => {
    socket.to(`conversation:${conversationId}`).emit("user_typing", { userId, conversationId, stopped: true });
  });

  socket.on("user_online", async ({ userId }) => {
    if (redisClient) {
      await redisClient.set(`presence:${userId}`, "online");
    }
    io.emit("user_online", userId);
  });

  socket.on("user_offline", async ({ userId }) => {
    if (redisClient) {
      await redisClient.set(`presence:${userId}`, "offline");
    }
    io.emit("user_offline", userId);
  });
}
