const { RefreshToken } = require("@/db/models");
const { REFRESH_TOKEN_EXPIRES_IN } = require("@/config/auth");
const generateToken = require("@/utils/generateToken");

const generateUniqueToken = async () => {
  let randToken = null;
  do {
    randToken = generateToken();
  } while (await RefreshToken.findOne({ token: randToken }));
  return randToken;
};

const createRefreshToken = async (userId) => {
  const token = await generateUniqueToken();

  const current = new Date();
  const expiredAt = new Date(current.getTime() + REFRESH_TOKEN_EXPIRES_IN * 1000);

  return await RefreshToken.create({
    user_id: userId,
    token,
    expired_at: expiredAt,
  });
};

const findValidRefreshToken = async (token) => {
  return await RefreshToken.findOne({
    token,
    expired_at: { $gt: new Date() },
  });
};

const deleteRefreshToken = async (refreshToken) => {
  await refreshToken.deleteOne();
};

module.exports = {
  createRefreshToken,
  findValidRefreshToken,
  deleteRefreshToken,
};
