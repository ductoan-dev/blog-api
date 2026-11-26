// Small HTTP-only entrypoint for the AI Vercel project. Existing Express,
// Socket.IO and local worker entrypoints stay in server.js.
require("module-alias").addAlias("@", require("node:path").join(__dirname, "src"));
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const router = require("@/routes/api/ai.route");
const { errorHandler } = require("@/controllers/ai.controller");
const app = express();

app.use(cors({ origin: process.env.CLIENT_URL || false, methods: ["GET", "POST"] }));
app.use(express.json({ limit: "32kb", verify: (req, res, buffer) => { req.rawBody = buffer.toString("utf8"); } }));
app.use("/api/v1/ai", router);
app.use("/api/ai", router);
app.use(errorHandler);
module.exports = app;
