const prisma = require("@/db/prisma");
const { serializeUser } = require("@/utils/serializers");

const USER_SELECT = { id: true, avatar: true, username: true, fullname: true, firstName: true, lastName: true };

class MessengerService {
  async getConversations(currentUser) {
    const conversations = await prisma.conversation.findMany({
      where: { members: { some: { id: currentUser.id } } },
      include: { members: { select: USER_SELECT } },
      orderBy: { lastMessageAt: "desc" },
    });

    return Promise.all(
      conversations.map(async (conv) => {
        const lastMsg = await prisma.message.findFirst({
          where: { conversationId: conv.id, deletedAt: null },
          include: { user: { select: USER_SELECT } },
          orderBy: { createdAt: "desc" },
        });

        return {
          id: conv.id,
          name: conv.name,
          avatar: conv.avatar,
          last_message_at: conv.lastMessageAt,
          members: conv.members.map(serializeUser),
          last_message: lastMsg
            ? { id: lastMsg.id, content: lastMsg.content, createdAt: lastMsg.createdAt, user: serializeUser(lastMsg.user) }
            : null,
        };
      })
    );
  }

  async getMessages(conversationId, currentUser) {
    const conv = await prisma.conversation.findFirst({
      where: { id: conversationId, members: { some: { id: currentUser.id } } },
    });
    if (!conv) throw new Error("Conversation not found");

    const messages = await prisma.message.findMany({
      where: { conversationId, deletedAt: null },
      include: { user: { select: USER_SELECT } },
      orderBy: { createdAt: "asc" },
    });

    return messages.map((m) => ({
      id: m.id,
      content: m.content,
      type: m.type,
      createdAt: m.createdAt,
      user: serializeUser(m.user),
    }));
  }

  async sendMessage(conversationId, currentUser, content) {
    const conv = await prisma.conversation.findFirst({
      where: { id: conversationId, members: { some: { id: currentUser.id } } },
    });
    if (!conv) throw new Error("Conversation not found");

    const message = await prisma.message.create({
      data: { conversationId, userId: currentUser.id, type: "text", content },
    });

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });

    const populated = await prisma.message.findUnique({
      where: { id: message.id },
      include: { user: { select: USER_SELECT } },
    });

    return {
      id: populated.id,
      content: populated.content,
      type: populated.type,
      createdAt: populated.createdAt,
      user: serializeUser(populated.user),
    };
  }

  async getOrCreateDirect(currentUser, targetUserId) {
    const existing = await prisma.conversation.findFirst({
      where: {
        AND: [
          { members: { some: { id: currentUser.id } } },
          { members: { some: { id: targetUserId } } },
          { members: { every: { id: { in: [currentUser.id, targetUserId] } } } },
        ],
      },
      include: { members: { select: USER_SELECT } },
    });

    if (existing) {
      return {
        id: existing.id,
        name: existing.name,
        avatar: existing.avatar,
        last_message_at: existing.lastMessageAt,
        members: existing.members.map(serializeUser),
      };
    }

    const conv = await prisma.conversation.create({
      data: {
        createdBy: currentUser.id,
        lastMessageAt: new Date(),
        members: { connect: [{ id: currentUser.id }, { id: targetUserId }] },
      },
    });

    const populated = await prisma.conversation.findUnique({
      where: { id: conv.id },
      include: { members: { select: USER_SELECT } },
    });

    return {
      id: populated.id,
      name: populated.name,
      avatar: populated.avatar,
      last_message_at: populated.lastMessageAt,
      members: populated.members.map(serializeUser),
    };
  }
}

module.exports = new MessengerService();
