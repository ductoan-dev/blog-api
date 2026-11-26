function positiveInt(value, fallback, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function getAiConfig() {
  const similarity = Number(process.env.AI_MIN_SIMILARITY || 0.45);
  const provider = process.env.AI_PROVIDER || "openai";
  const isGemini = provider === "gemini";
  const embeddingModel = process.env.AI_EMBEDDING_MODEL || (isGemini ? "gemini-embedding-001" : "text-embedding-3-small");
  return {
    provider,
    enabled: process.env.AI_ENABLED === "true",
    chatBaseUrl: process.env.AI_CHAT_BASE_URL || "https://api.openai.com/v1",
    chatKey: isGemini ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY,
    chatModel: process.env.AI_CHAT_MODEL || (isGemini ? "gemini-3.5-flash-lite" : "gpt-4.1-mini"),
    embeddingKey: isGemini ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY,
    embeddingModel,
    embeddingVersion: `${provider}:${embeddingModel}:1536`,
    requestsPerMinute: positiveInt(process.env.AI_REQUESTS_PER_MINUTE, 5, 30),
    requestsPerDay: positiveInt(process.env.AI_REQUESTS_PER_DAY, 100, 10000),
    minSimilarity: Number.isFinite(similarity) && similarity >= 0 && similarity <= 1 ? similarity : 0.45,
    jobUrl: process.env.AI_INDEX_JOB_URL,
  };
}

function requireAiConfig() {
  const config = getAiConfig();
  if (!["openai", "gemini"].includes(config.provider) || !config.enabled || !config.chatKey || !config.embeddingKey) {
    const error = new Error("Trợ lý AI chưa được cấu hình. Vui lòng thử lại sau.");
    error.status = 503;
    error.code = "AI_NOT_CONFIGURED";
    throw error;
  }
  return config;
}

module.exports = { getAiConfig, requireAiConfig };
