require("dotenv").config();
const nodemailer = require("nodemailer");

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

// "Name <email>" | "email" -> { name?, email }
const parseAddress = (address) => {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(address);
  return match ? { name: match[1] || undefined, email: match[2] } : { email: address.trim() };
};

// Free hosts (Render...) block outbound SMTP ports, so production sends through
// Brevo's HTTP API. Same sendMail({ from, to, subject, html }) shape as nodemailer.
const brevoTransporter = {
  async sendMail({ from, to, subject, html }) {
    const res = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        sender: parseAddress(from),
        to: [parseAddress(to)],
        subject,
        htmlContent: html,
      }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Brevo ${res.status}: ${body.message || res.statusText}`);
    }
    return body; // { messageId }
  },
};

const smtpTransporter = nodemailer.createTransport({
  service: process.env.MAIL_SERVICE,
  auth: {
    user: process.env.MAIL_AUTH_USER,
    pass: process.env.MAIL_AUTH_PASS,
  },
});

const transporter = process.env.BREVO_API_KEY ? brevoTransporter : smtpTransporter;

module.exports = transporter;
