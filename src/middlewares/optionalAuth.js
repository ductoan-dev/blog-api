const { User } = require("@/db/models");
const jwtService = require("@/service/jwt.service");

async function optionalAuth(req, res, next) {
  try {
    const token = req.headers?.authorization?.replace("Bearer ", "");
    if (!token) return next();

    const payload = jwtService.verifyAccessToken(token);
    const user = await User.findById(payload.userId);
    if (user) req.user = user;
  } catch {
    // token invalid — proceed as guest
  }
  next();
}

module.exports = optionalAuth;
