const jwtService = require("@/service/jwt.service");
const { User } = require("@/db/models");
const messengerService = require("@/service/messenger.service");
const emitter = require("@/utils/emitter");

module.exports = (io) => {
  // Auth middleware — verify JWT on handshake
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("No token"));

      const payload = jwtService.verifyAccessToken(token);
      const user = await User.findById(payload.userId).lean();
      if (!user) return next(new Error("User not found"));

      socket.user = { ...user, id: user._id.toString() };
      next();
    } catch {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.user.username} (${socket.id})`);

    // Join personal room for receiving notifications
    socket.join(`user:${socket.user.id}`);

    // Join a conversation room
    socket.on("join_conversation", (conversationId) => {
      socket.join(`conv:${conversationId}`);
    });

    // Leave a conversation room
    socket.on("leave_conversation", (conversationId) => {
      socket.leave(`conv:${conversationId}`);
    });

    // Send message via socket
    socket.on("send_message", async ({ conversationId, content }, callback) => {
      try {
        if (!content?.trim()) return;

        const message = await messengerService.sendMessage(
          conversationId,
          socket.user,
          content.trim()
        );

        const payload = { conversationId, message };

        // Broadcast new message to everyone in the conversation room
        io.to(`conv:${conversationId}`).emit("new_message", payload);

        // Update conversation list preview for everyone in the room
        io.to(`conv:${conversationId}`).emit("conversation_updated", {
          conversationId,
          last_message: message,
          last_message_at: message.createdAt,
        });

        // Push notification to each member's personal room (except sender)
        const { Conversation } = require("@/db/models");
        const conv = await Conversation.findById(conversationId)
          .populate("members", "id")
          .lean();

        if (conv?.members) {
          const sender = {
            id: socket.user.id,
            username: socket.user.username,
            fullname: socket.user.fullname,
            first_name: socket.user.first_name,
            last_name: socket.user.last_name,
            avatar: socket.user.avatar,
          };
          conv.members.forEach((member) => {
            const memberId = member._id.toString();
            if (memberId !== socket.user.id) {
              io.to(`user:${memberId}`).emit("notification:new_message", {
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

    // Typing indicator
    socket.on("typing", ({ conversationId }) => {
      socket.to(`conv:${conversationId}`).emit("user_typing", {
        conversationId,
        user: {
          id: socket.user.id,
          username: socket.user.username,
          fullname: socket.user.fullname,
          first_name: socket.user.first_name,
          last_name: socket.user.last_name,
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

  // Forward all service-layer notifications to personal rooms
  const forwardNotif = ({ toUserId, notification }) => {
    io.to(`user:${toUserId}`).emit("notification:new", notification);
  };
  emitter.on("notification:follow", forwardNotif);
  emitter.on("notification:post_like", forwardNotif);
  emitter.on("notification:post_comment", forwardNotif);
};
