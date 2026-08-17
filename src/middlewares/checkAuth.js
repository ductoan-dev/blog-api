const response = require("@/utils/response");
const { User } = require("@/db/models");
const jwtService = require("@/service/jwt.service");

async function checkAuth(req, res, next) {
  try {
    const token = req.headers?.authorization?.replace("Bearer ", "");

    if (!token) {
      return response.error(res, 401, "Token không được cung cấp");
    }

    const payload = jwtService.verifyAccessToken(token);

    const user = await User.findById(payload.userId);

    if (!user) {
      return response.error(res, 401, "User không tồn tại");
    }

    req.user = user;
    next();
  } catch (error) {
    return response.error(res, 401, "Token không hợp lệ");
  }
}

module.exports = checkAuth;
