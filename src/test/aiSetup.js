const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env.ai.local"), override: true, quiet: true });
const database = new URL(process.env.DATABASE_URL || "postgresql://blog_ai:blog_ai_local@127.0.0.1:5434/blog_ai_test");
if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname)) {
  throw new Error("AI tests require a local database");
}
database.pathname = "/blog_ai_test";
process.env.DATABASE_URL = database.toString();
process.env.AI_ENABLED = "true";
process.env.AI_PROVIDER = "openai";
process.env.OPENAI_API_KEY = "test-key-no-network";
process.env.AI_CHAT_BASE_URL = "https://api.openai.com/v1";
process.env.AI_CHAT_MODEL = "gpt-4.1-mini";
process.env.AI_EMBEDDING_MODEL = "text-embedding-3-small";
delete process.env.QSTASH_TOKEN;
require("module-alias/register");
