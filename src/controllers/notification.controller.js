const response = require("@/utils/response");
const notificationService = require("@/service/notification.service");

exports.getAll = async (req, res) => {
  try {
    const data = await notificationService.getAll(req.user._id);
    response.succsess(res, 200, data);
  } catch (error) {
    response.error(res, 400, error.message);
  }
};

exports.markRead = async (req, res) => {
  try {
    const data = await notificationService.markRead(req.params.id, req.user._id);
    response.succsess(res, 200, data);
  } catch (error) {
    response.error(res, 400, error.message);
  }
};

exports.markAllRead = async (req, res) => {
  try {
    await notificationService.markAllRead(req.user._id);
    response.succsess(res, 200, true);
  } catch (error) {
    response.error(res, 400, error.message);
  }
};
