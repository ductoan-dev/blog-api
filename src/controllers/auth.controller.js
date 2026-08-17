const response = require("@/utils/response");
const authService = require("@/service/auth.service");
const prisma = require("@/db/prisma");
const { serializeUser } = require("@/utils/serializers");

const register = async (req, res) => {
  try {
    const { userId, token } = await authService.register(req.body);

    await prisma.queue.create({
      data: { type: "sendVerifyEmailJob", payload: { userId } },
    });

    response.succsess(res, 200, token);
  } catch (error) {
    response.error(res, 400, error.message);
  }
};

const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    const userData = await authService.login({ email, password });

    return response.succsess(res, 200, userData);
  } catch (error) {
    response.error(res, 401, error.message);
  }
};

const me = async (req, res) => {
  try {
    if (!req.user) {
      return response.error(res, 401, "Token invalid");
    }

    return response.succsess(res, 200, serializeUser(req.user));
  } catch (error) {
    return response.error(res, 500, "Internal server error");
  }
};
const refreshToken = async (req, res) => {
  try {
    const tokenData = await authService.refreshAccessToken(
      req.body.refresh_token
    );
    response.succsess(res, 200, tokenData);
  } catch (error) {
    response.error(res, 403, error.message);
  }
};

const verifyEmail = async (req, res) => {
  try {
    const check = await authService.verifyEmail(req.body.email);
    if (check === "verified") {
      return res.json({
        status: true,
      });
    }
    res.status(201).send("");
  } catch (error) {
    throw new Error("Token không tồn tại");
  }
};

const verifyToken = async (req, res) => {
  try {
    const verify = await authService.verifyToken(req.body.token);
    res.status(201).json({
      data: verify,
    });
  } catch (error) {
    throw new Error("Token không tồn tại");
  }
};
const forGotPassWord = async (req, res) => {
  try {
    await authService.forGotPassWord(req.body.email);
    res.status(201).send("");
  } catch (error) {
    throw new Error("Email không tồn tại");
  }
};

const resetPassword = async (req, res) => {
  try {
    await authService.resetPassword(req.body, req.user);
    res.status(201).send("");
  } catch (error) {
    response.error(res, 400, error.message);
  }
};

module.exports = {
  register,
  login,
  me,
  verifyEmail,
  verifyToken,
  forGotPassWord,
  resetPassword,
  refreshToken,
};
