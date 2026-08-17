const { User, Queue } = require("@/db/models");
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

  const userId = user._id;
  const token = jwtService.generateAccessToken(userId);
  return { userId, token };
};

const login = async ({ email, password }) => {
  const user = await User.findOne({ email }).lean();

  if (!user) {
    throw new Error("Thông tin đăng nhập không hợp lệ");
  }

  const isValid = await compare(password, user.password);
  if (!isValid) {
    throw new Error("Thông tin đăng nhập không hợp lệ");
  }

  const tokenData = jwtService.generateAccessToken(user._id);
  const refreshToken = await refreshTokenService.createRefreshToken(user._id);
  return {
    ...tokenData,
    refresh_token: refreshToken.token,
  };
};

const getProfile = async (fullname) => {
  const [firstName, ...rest] = fullname.split(" ");
  const lastName = rest.join(" ");

  const user = await User.findOne({
    first_name: { $regex: firstName, $options: "i" },
    last_name: { $regex: lastName, $options: "i" },
  })
    .select("-password")
    .lean();

  if (!user) {
    const error = new Error("Không tìm thấy người dùng");
    error.status = 404;
    throw error;
  }

  return user;
};

const forGotPassWord = async (email) => {
  const user = await User.findOne({ email });

  if (!user) {
    throw new Error("Không tìm thấy người dùng với email này");
  }

  await User.findByIdAndUpdate(user._id, { verified_at: null });
  await Queue.create({
    type: "sendVerifyEmailJob",
    payload: { userId: user._id.toString() },
  });
};

const resetPassword = async (data, currentUser) => {
  if (currentUser && currentUser._id) {
    const userWithPassword = await User.findById(currentUser._id).select(
      "_id password"
    );

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

    await User.findByIdAndUpdate(currentUser._id, {
      password: await hash(data.newPassword),
    });
    return;
  }

  const { userId, password } = data;
  if (!userId || !password) {
    throw new Error("userID or password is missing");
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new Error("Invalid user");
  }

  await User.findByIdAndUpdate(userId, { password: await hash(password) });
};

const verifyEmail = async (token) => {
  try {
    const { userId } = jwtService.verifyAccessToken(
      token,
      process.env.MAIL_JWT_SECRET
    );
    const user = await User.findById(userId);
    if (!user) {
      throw new Error("User không tồn tại");
    }
    if (user.verified_at) {
      return "verified";
    }
    await User.findByIdAndUpdate(userId, { verified_at: new Date() });
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
