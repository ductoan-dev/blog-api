const jwtService = require("@/service/jwt.service");
const prisma = require("@/db/prisma");
const messengerService = require("@/service/messenger.service");
const emitter = require("@/utils/emitter");

module.exports = (io) => {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("No token"));

      const payload = jwtService.verifyAccessToken(token);
      const user = await prisma.user.findUnique({ where: { id: payload.userId } });
      if (!user) return next(new Error("User not found"));

      socket.user = user;
      next();
    } catch {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.user.username} (${socket.id})`);

    socket.join(`user:${socket.user.id}`);

    socket.on("join_conversation", (conversationId) => {
      socket.join(`conv:${conversationId}`);
    });

    socket.on("leave_conversation", (conversationId) => {
      socket.leave(`conv:${conversationId}`);
    });

    socket.on("send_message", async ({ conversationId, content }, callback) => {
      try {
        if (!content?.trim()) return;

        const message = await messengerService.sendMessage(
          conversationId,
          socket.user,
          content.trim()
        );

        const payload = { conversationId, message };

        io.to(`conv:${conversationId}`).emit("new_message", payload);

        io.to(`conv:${conversationId}`).emit("conversation_updated", {
          conversationId,
          last_message: message,
          last_message_at: message.createdAt,
        });

        const conv = await prisma.conversation.findUnique({
          where: { id: conversationId },
          include: { members: { select: { id: true } } },
        });

        if (conv?.members) {
          const sender = {
            id: socket.user.id,
            username: socket.user.username,
            fullname: socket.user.fullname,
            first_name: socket.user.firstName,
            last_name: socket.user.lastName,
            avatar: socket.user.avatar,
          };
          conv.members.forEach((member) => {
            if (member.id !== socket.user.id) {
              io.to(`user:${member.id}`).emit("notification:new_message", {
                conversationId,
                message,
                sender,
              });
            }
          });
        }

        if (callback) callback({ ok: true, message });
      } catch (err) {
        if (callback) callback({ ok: false, error: err.message });
      }
    });

    socket.on("typing", ({ conversationId }) => {
      socket.to(`conv:${conversationId}`).emit("user_typing", {
        conversationId,
        user: {
          id: socket.user.id,
          username: socket.user.username,
          fullname: socket.user.fullname,
          first_name: socket.user.firstName,
          last_name: socket.user.lastName,
        },
      });
    });

    socket.on("stop_typing", ({ conversationId }) => {
      socket.to(`conv:${conversationId}`).emit("user_stop_typing", {
        conversationId,
        userId: socket.user.id,
      });
    });

    socket.on("disconnect", () => {
      console.log(`Socket disconnected: ${socket.user.username}`);
    });
  });

  const forwardNotif = ({ toUserId, notification }) => {
    io.to(`user:${toUserId}`).emit("notification:new", notification);
  };
  emitter.on("notification:follow", forwardNotif);
  emitter.on("notification:post_like", forwardNotif);
  emitter.on("notification:post_comment", forwardNotif);
};
