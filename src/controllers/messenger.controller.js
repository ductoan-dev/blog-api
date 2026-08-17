const response = require("@/utils/response");
const messengerService = require("@/service/messenger.service");

exports.getConversations = async (req, res) => {
  try {
    const data = await messengerService.getConversations(req.user);
    response.succsess(res, 200, data);
  } catch (error) {
    response.error(res, 400, error.message);
  }
};

exports.getMessages = async (req, res) => {
  try {
    const data = await messengerService.getMessages(
      req.params.conversationId,
      req.user
    );
    response.succsess(res, 200, data);
  } catch (error) {
    response.error(res, 400, error.message);
  }
};

exports.sendMessage = async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) return response.error(res, 400, "Content is required");
    const data = await messengerService.sendMessage(
      req.params.conversationId,
      req.user,
      content.trim()
    );
    response.succsess(res, 201, data);
  } catch (error) {
    response.error(res, 400, error.message);
  }
};

exports.getOrCreateDirect = async (req, res) => {
  try {
    const data = await messengerService.getOrCreateDirect(
      req.user,
      req.params.userId
    );
    response.succsess(res, 200, data);
  } catch (error) {
    response.error(res, 400, error.message);
  }
};
