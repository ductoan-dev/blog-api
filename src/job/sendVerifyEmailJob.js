require("module-alias/register");
require("dotenv").config();
const transporter = require("@/config/mailer");
const loadEmail = require("@/utils/loadEmail");
const { User } = require("@/db/models");
const jwtService = require("@/service/jwt.service");

async function sendVerifyEmailJob(job) {
  try {
    const { userId } = job.payload;

    const user = await User.findById(userId);

    if (!user) {
      throw new Error(`User not found with ID: ${userId}`);
    }

    const { token } = jwtService.generateAccessToken(
      userId,
      process.env.MAIL_JWT_SECRET
    );

    const verifyUrl = `${process.env.CLIENT_URL}/verify-email?token=${token}`;
    const data = { token, userId, verifyUrl };
    const template = await loadEmail("verify-email", data);

    if (!template) {
      throw new Error("Failed to load email template");
    }

    const result = await transporter.sendMail({
      from: process.env.MAIL_FROM || "meocute0508@gmail.com",
      subject: "Verification email",
      to: user.email,
      html: template,
    });

    return result;
  } catch (error) {
    console.error("Error in sendVerifyEmailJob:", error.message);
    console.error(error.stack);
    throw error;
  }
}

module.exports = sendVerifyEmailJob;
