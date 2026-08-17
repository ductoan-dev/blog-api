const prisma = require("@/db/prisma");
const { REFRESH_TOKEN_EXPIRES_IN } = require("@/config/auth");
const generateToken = require("@/utils/generateToken");

const generateUniqueToken = async () => {
  let randToken = null;
  do {
    randToken = generateToken();
  } while (await prisma.refreshToken.findUnique({ where: { token: randToken } }));
  return randToken;
};

const createRefreshToken = async (userId) => {
  const token = await generateUniqueToken();
  const current = new Date();
  const expiredAt = new Date(current.getTime() + REFRESH_TOKEN_EXPIRES_IN * 1000);

  return prisma.refreshToken.create({
    data: { userId, token, expiredAt },
  });
};

const findValidRefreshToken = async (token) => {
  return prisma.refreshToken.findFirst({
    where: { token, expiredAt: { gt: new Date() } },
  });
};

const deleteRefreshToken = async (refreshToken) => {
  await prisma.refreshToken.delete({ where: { id: refreshToken.id } });
};

module.exports = {
  createRefreshToken,
  findValidRefreshToken,
  deleteRefreshToken,
};
