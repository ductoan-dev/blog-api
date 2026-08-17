const { Conversation, Message } = require("@/db/models");

const USER_SELECT = "id avatar username fullname first_name last_name";

class MessengerService {
  async getConversations(currentUser) {
    const conversations = await Conversation.find({ members: currentUser._id })
      .populate("members", USER_SELECT)
      .sort({ last_message_at: -1 })
      .lean();

    return Promise.all(
      conversations.map(async (conv) => {
        const lastMsg = await Message.findOne({
          conversation_id: conv._id,
          deleted_at: null,
        })
          .populate("user_id", USER_SELECT)
          .sort({ createdAt: -1 })
          .lean();

        return {
          ...conv,
          id: conv._id.toString(),
          members: conv.members.map((m) => ({ ...m, id: m._id.toString() })),
          last_message: lastMsg
            ? { ...lastMsg, id: lastMsg._id.toString(), user: lastMsg.user_id }
            : null,
        };
      })
    );
  }

  async getMessages(conversationId, currentUser) {
    const conv = await Conversation.findOne({
      _id: conversationId,
      members: currentUser._id,
    });
    if (!conv) throw new Error("Conversation not found");

    const messages = await Message.find({
      conversation_id: conversationId,
      deleted_at: null,
    })
      .populate("user_id", USER_SELECT)
      .sort({ createdAt: 1 })
      .lean();

    return messages.map((m) => ({
      ...m,
      id: m._id.toString(),
      user: m.user_id,
    }));
  }

  async sendMessage(conversationId, currentUser, content) {
    const conv = await Conversation.findOne({
      _id: conversationId,
      members: currentUser._id,
    });
    if (!conv) throw new Error("Conversation not found");

    const message = await Message.create({
      conversation_id: conversationId,
      user_id: currentUser._id,
      type: "text",
      content,
    });

    await Conversation.findByIdAndUpdate(conversationId, {
      last_message_at: new Date(),
    });

    const populated = await Message.findById(message._id)
      .populate("user_id", USER_SELECT)
      .lean();

    return { ...populated, id: populated._id.toString(), user: populated.user_id };
  }

  async getOrCreateDirect(currentUser, targetUserId) {
    const existing = await Conversation.findOne({
      members: { $all: [currentUser._id, targetUserId], $size: 2 },
    })
      .populate("members", USER_SELECT)
      .lean();

    if (existing) {
      return {
        ...existing,
        id: existing._id.toString(),
        members: existing.members.map((m) => ({ ...m, id: m._id.toString() })),
      };
    }

    const conv = await Conversation.create({
      created_by: currentUser._id,
      members: [currentUser._id, targetUserId],
      last_message_at: new Date(),
    });

    const populated = await Conversation.findById(conv._id)
      .populate("members", USER_SELECT)
      .lean();

    return {
      ...populated,
      id: populated._id.toString(),
      members: populated.members.map((m) => ({ ...m, id: m._id.toString() })),
    };
  }
}

module.exports = new MessengerService();
