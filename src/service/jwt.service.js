const jwt = require("jsonwebtoken");
const { JWT_SECRET, JWT_EXPIRES_IN, TOKEN_TYPE } = require("@/config/auth");

const generateAccessToken = (
  userId,
  secret = JWT_SECRET,
  expires = JWT_EXPIRES_IN
) => {
  const token = jwt.sign({ userId }, secret, {
    expiresIn: expires,
  });

  return {
    token: token,
    token_type: TOKEN_TYPE,
    expires_in: expires,
  };
};

const verifyAccessToken = (token, secret = JWT_SECRET) => {
  return jwt.verify(token, secret);
};

module.exports = {
  generateAccessToken,
  verifyAccessToken,
};
