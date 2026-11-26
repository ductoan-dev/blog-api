const { createHash } = require("node:crypto");
const prisma = require("@/db/prisma");
const { requireAiConfig } = require("@/config/ai");

async function consume(key, windowStart, limit) {
  const rows = await prisma.$queryRaw`
    INSERT INTO ai_rate_limits (key, window_start, count) VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = ai_rate_limits.count + 1
    WHERE ai_rate_limits.count < ${limit}
    RETURNING count
  `;
  return rows.length > 0;
}

async function aiRateLimit(req, res, next) {
  try {
    const config = requireAiConfig();
    const now = Date.now();
    const ip = process.env.VERCEL ? (req.headers["x-vercel-forwarded-for"] || req.ip) : req.ip;
    const key = createHash("sha256").update(`${process.env.AI_RATE_LIMIT_SALT || "blog-ai"}:${ip}`).digest("hex");
    const allowed = await consume(key, new Date(Math.floor(now / 60000) * 60000), config.requestsPerMinute);
    const daily = allowed && await consume("global:daily", new Date(Math.floor(now / 86400000) * 86400000), config.requestsPerDay);
    if (!daily) {
      res.set("Retry-After", allowed ? String(Math.ceil((86400000 - now % 86400000) / 1000)) : "60");
      return res.status(429).json({ success: false, code: "AI_RATE_LIMIT",
        message: allowed ? "Trợ lý đã đạt giới hạn hôm nay. Vui lòng quay lại sau." : "Bạn đang hỏi quá nhanh. Vui lòng thử lại sau một phút." });
    }
    next();
  } catch (error) { next(error); }
}

module.exports = aiRateLimit;
module.exports.consume = consume;
