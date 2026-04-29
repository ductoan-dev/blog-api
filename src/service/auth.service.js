const { where } = require("sequelize");

const { User, Queue } = require("@/db/models");
const { Op } = require("sequelize");
const { hash, compare } = require("@/utils/bcrypt");
const jwtService = require("@/service/jwt.service");
const refreshTokenService = require("@/service/refreshToken.service");

const register = async (data) => {
  const user = await User.create({
    ...data,
    password: await hash(data.password),
    first_name: data.first_name,
    last_name: data.last_name,
  });

  const userId = user.id;
  const token = jwtService.generateAccessToken(userId);
  return {
    userId,
    token,
  };
};

const login = async ({ email, password }) => {
  const user = await User.findOne({ where: { email }, raw: true });

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

  const user = await User.findOne({
    where: {
      [Op.and]: [
        { first_name: { [Op.iLike]: `%${firstName}%` } },
        { last_name: { [Op.iLike]: `%${lastName}%` } },
      ],
    },
    attributes: {
      exclude: ["password", "refresh_token"],
    },
    raw: true,
  });

  if (!user) {
    const error = new Error("Không tìm thấy người dùng");
    error.status = 404;
    throw error;
  }

  return user;
};
const forGotPassWord = async (email) => {
  const user = await User.findOne({ where: { email } });

  if (!user) {
    throw new Error("Không tìm thấy người dùng với email này");
  }

  await User.update({ verified_at: null }, { where: { id: user.id } });
  await Queue.create({
    type: "sendVerifyEmailJob",
    payload: { userId: user.id },
  });
};

const resetPassword = async (data, currentUser) => {
  if (currentUser && currentUser.id) {
    let user = currentUser;

    // Luôn tìm lại người dùng để đảm bảo có mật khẩu từ DB
    const userWithPassword = await User.findOne({
      where: { id: currentUser.id },
      attributes: ["id", "password"],
    });

    // Kiểm tra xem người dùng có tồn tại và có mật khẩu hay không
    if (!userWithPassword || !userWithPassword.password) {
      throw new Error("Không thể tìm thấy mật khẩu người dùng để so sánh.");
    }

    // Gán lại user để dùng cho các bước tiếp theo
    user = userWithPassword;

    // ... các đoạn code tiếp theo không thay đổi
    if (!data.currentPassword) {
      throw new Error("Vui lòng nhập mật khẩu hiện tại.");
    }

    const isValid = await compare(data.currentPassword, user.password);
    if (!isValid) {
      throw new Error("Mật khẩu hiện tại bạn đã nhập không đúng.");
    }

    const isSameAsOld = await compare(data.newPassword, user.password);
    if (isSameAsOld) {
      throw new Error("Vui lòng chọn mật khẩu khác với mật khẩu hiện tại.");
    }

    await User.update(
      { password: await hash(data.newPassword) },
      { where: { id: user.id } }
    );

    return;
  }

  // Trường hợp reset qua email (forgot password)
  const { userId, password } = data;

  if (!userId || !password) {
    throw new Error("userID or password is missing");
  }

  const user = await User.findOne({ where: { id: userId } });
  if (!user) {
    throw new Error("Invalid user");
  }

  await User.update(
    { password: await hash(password) },
    { where: { id: userId } }
  );
};

const verifyEmail = async (token) => {
  try {
    const { userId } = jwtService.verifyAccessToken(
      token,
      process.env.MAIL_JWT_SECRET
    );
    const user = await User.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error("User không tồn tại");
    }
    if (user.verified_at) {
      return "verified";
    }
    await User.update(
      {
        verified_at: new Date(),
      },
      {
        where: { id: userId },
      }
    );
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
  const refreshToken = await refreshTokenService.findValidRefreshToken(
    refreshTokenString
  );
  if (!refreshToken) {
    throw new Error("Refresh token không hợp lệ");
  }

  const tokenData = jwtService.generateAccessToken(refreshToken.user_id);
  await refreshTokenService.deleteRefreshToken(refreshToken);

  const newRefreshToken = await refreshTokenService.createRefreshToken(
    refreshToken.user_id
  );

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
