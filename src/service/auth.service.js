const prisma = require("@/db/prisma");
const { hash, compare } = require("@/utils/bcrypt");
const jwtService = require("@/service/jwt.service");
const refreshTokenService = require("@/service/refreshToken.service");

const register = async (data) => {
  const user = await prisma.user.create({
    data: {
      email: data.email,
      firstName: data.first_name,
      lastName: data.last_name,
      password: await hash(data.password),
    },
  });

  const userId = user.id;
  const token = jwtService.generateAccessToken(userId);
  return { userId, token };
};

const login = async ({ email, password }) => {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    throw new Error("Thông tin đăng nhập không hợp lệ");
  }

  const isValid = await compare(password, user.password);
  if (!isValid) {
    throw new Error("Thông tin đăng nhập không hợp lệ");
  }

  const tokenData = jwtService.generateAccessToken(user.id);
  const refreshToken = await refreshTokenService.createRefreshToken(user.id);
  return {
    ...tokenData,
    refresh_token: refreshToken.token,
  };
};

const getProfile = async (fullname) => {
  const [firstName, ...rest] = fullname.split(" ");
  const lastName = rest.join(" ");

  const user = await prisma.user.findFirst({
    where: {
      firstName: { contains: firstName, mode: "insensitive" },
      lastName: { contains: lastName, mode: "insensitive" },
    },
  });

  if (!user) {
    const error = new Error("Không tìm thấy người dùng");
    error.status = 404;
    throw error;
  }

  const { password, twoFactorSecret, ...safeUser } = user;
  return safeUser;
};

const forGotPassWord = async (email) => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new Error("Không tìm thấy người dùng với email này");
  }

  await prisma.user.update({ where: { id: user.id }, data: { verifiedAt: null } });
  await prisma.queue.create({
    data: { type: "sendVerifyEmailJob", payload: { userId: user.id } },
  });
};

const resetPassword = async (data, currentUser) => {
  if (currentUser && currentUser.id) {
    const userWithPassword = await prisma.user.findUnique({ where: { id: currentUser.id } });

    if (!userWithPassword || !userWithPassword.password) {
      throw new Error("Không thể tìm thấy mật khẩu người dùng để so sánh.");
    }

    if (!data.currentPassword) {
      throw new Error("Vui lòng nhập mật khẩu hiện tại.");
    }

    const isValid = await compare(data.currentPassword, userWithPassword.password);
    if (!isValid) {
      throw new Error("Mật khẩu hiện tại bạn đã nhập không đúng.");
    }

    const isSameAsOld = await compare(data.newPassword, userWithPassword.password);
    if (isSameAsOld) {
      throw new Error("Vui lòng chọn mật khẩu khác với mật khẩu hiện tại.");
    }

    await prisma.user.update({
      where: { id: currentUser.id },
      data: { password: await hash(data.newPassword) },
    });
    return;
  }

  const { userId, password } = data;
  if (!userId || !password) {
    throw new Error("userID or password is missing");
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new Error("Invalid user");
  }

  await prisma.user.update({ where: { id: userId }, data: { password: await hash(password) } });
};

const verifyEmail = async (token) => {
  try {
    const { userId } = jwtService.verifyAccessToken(token, process.env.MAIL_JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new Error("User không tồn tại");
    }
    if (user.verifiedAt) {
      return "verified";
    }
    await prisma.user.update({ where: { id: userId }, data: { verifiedAt: new Date() } });
  } catch (error) {
    throw new Error(error);
  }
};

const verifyToken = async (token) => {
  try {
    return jwtService.verifyAccessToken(token, process.env.MAIL_JWT_SECRET);
  } catch (error) {
    throw new Error(error);
  }
};

const refreshAccessToken = async (refreshTokenString) => {
  const refreshToken = await refreshTokenService.findValidRefreshToken(refreshTokenString);
  if (!refreshToken) {
    throw new Error("Refresh token không hợp lệ");
  }

  const tokenData = jwtService.generateAccessToken(refreshToken.userId);
  await refreshTokenService.deleteRefreshToken(refreshToken);

  const newRefreshToken = await refreshTokenService.createRefreshToken(refreshToken.userId);

  return {
    ...tokenData,
    refresh_token: newRefreshToken.token,
  };
};

module.exports = {
  register,
  login,
  getProfile,
  forGotPassWord,
  resetPassword,
  verifyEmail,
  verifyToken,
  refreshAccessToken,
};
