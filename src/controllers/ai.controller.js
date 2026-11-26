const { timingSafeEqual } = require("node:crypto");
const chatService = require("@/service/aiChat.service");
const indexService = require("@/service/aiIndex.service");
const { getAiConfig } = require("@/config/ai");

const chat = async (req, res, next) => {
  try {
    const { question, history } = req.aiInput;
    res.set("Cache-Control", "no-store");
    res.json({ success: true, data: await chatService.chat(question, history) });
  } catch (error) { next(error); }
};

const suggestions = async (req, res, next) => {
  try {
    const config = getAiConfig();
    const ready = Boolean(config.enabled && config.chatKey && config.embeddingKey);
    res.set("Cache-Control", "no-store");
    res.json({ success: true, data: { ready, suggestions: ready ? await chatService.suggestions() : [] } });
  } catch (error) { next(error); }
};

const index = async (req, res, next) => {
  try {
    const config = getAiConfig();
    if (!config.enabled) return res.status(503).json({ success: false, message: "AI disabled" });
    if (!process.env.QSTASH_CURRENT_SIGNING_KEY || !process.env.QSTASH_NEXT_SIGNING_KEY || !config.jobUrl) {
      return res.status(503).json({ success: false, message: "Job delivery is not configured" });
    }
    const { Receiver } = require("@upstash/qstash");
    const receiver = new Receiver({
      currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
    });
    let valid = false;
    try {
      valid = await receiver.verify({ signature: req.get("Upstash-Signature") || "",
        body: req.rawBody || "", url: config.jobUrl });
    } catch { /* Reject without logging signatures or raw bodies. */ }
    if (!valid) return res.status(401).json({ success: false, message: "Invalid job signature" });
    if (typeof req.body?.postId !== "string" || req.body.postId.length > 100) {
      return res.status(400).json({ success: false, message: "Invalid postId" });
    }
    const data = await indexService.process(req.body.postId);
    // A scheduled/retried delivery may arrive slightly before availableAt.
    if (data.status === "skipped") {
      const prisma = require("@/db/prisma");
      const job = await prisma.aiIndexJob.findUnique({ where: { postId: req.body.postId } });
      if (job && ["pending", "failed"].includes(job.status) && job.attempts < 5) {
        return res.status(503).json({ success: false, message: "Job not ready yet" });
      }
    }
    res.json({ success: true, data });
  } catch (error) { next(error); }
};

const reconcile = async (req, res, next) => {
  const secret = process.env.CRON_SECRET || process.env.AI_JOB_SECRET;
  const supplied = Buffer.from(req.get("Authorization") || "");
  const expected = Buffer.from(`Bearer ${secret || ""}`);
  if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  if (!getAiConfig().enabled) return res.status(503).json({ success: false, message: "AI disabled" });
  try { res.json({ success: true, data: await indexService.refreshForChat() }); } catch (error) { next(error); }
};

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const status = error.status || 500;
  const quotaMessage = error.code === "AI_INSUFFICIENT_QUOTA"
    ? "Tài khoản OpenAI API chưa có hoặc đã hết credit. Vui lòng kiểm tra Billing của OpenAI."
    : null;
  const messages = {
    429: "Dịch vụ AI đang đạt giới hạn lượt gọi. Vui lòng thử lại sau.",
    502: "Dịch vụ AI tạm thời không phản hồi. Vui lòng thử lại.",
    503: "Trợ lý AI chưa được cấu hình. Vui lòng thử lại sau.",
    504: "Trợ lý mất quá nhiều thời gian để trả lời. Vui lòng thử lại.",
  };
  if (status >= 500) console.error("[AI] Request failed:", error.code || "AI_REQUEST_ERROR");
  res.status(status).json({ success: false, code: error.code || "AI_REQUEST_ERROR",
    message: quotaMessage || (status === 400 ? error.message : messages[status] || "Trợ lý tạm thời không khả dụng. Vui lòng thử lại.") });
}

module.exports = { chat, suggestions, index, reconcile, errorHandler };
