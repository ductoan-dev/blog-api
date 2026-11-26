const path = require("node:path");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const dotenv = require("dotenv");
const envFile = path.resolve(__dirname, "../.env.ai.local");
if (!fs.existsSync(envFile)) {
  console.error("Copy .env.ai.local.example to .env.ai.local first.");
  process.exit(1);
}
dotenv.config({ path: envFile, override: true, quiet: true });
// Guard before importing Prisma or any application modules. Local commands must
// never fall through to the remote DATABASE_URL in the existing .env file.
const url = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || process.env.VERCEL) {
  console.error("ai:local requires a loopback PostgreSQL URL and cannot run on Vercel.");
  process.exit(1);
}
process.env.NODE_ENV = "development";
// Local runs never dispatch jobs to a remote HTTP endpoint.
process.env.QSTASH_TOKEN = "";
process.env.AI_INDEX_JOB_URL = "";
require("module-alias/register");
const { getAiConfig } = require("@/config/ai");
const command = process.argv[2] || "serve";

async function main() {
  if (command === "serve") {
    require("../server");
    if (getAiConfig().enabled && getAiConfig().embeddingKey) {
      const indexService = require("@/service/aiIndex.service");
      let busy = false;
      const timer = setInterval(async () => {
        if (busy) return;
        busy = true;
        try {
          for (const job of await indexService.pending(1)) await indexService.process(job.postId);
        } catch { console.error("[AI local] Index job failed; it will be retried with backoff."); }
        finally { busy = false; }
      }, 3000);
      timer.unref();
      console.log("Local AI indexing is active.");
    }
    return;
  }
  if (["test:migrate", "test:base"].includes(command)) {
    url.pathname = "/blog_ai_test";
    process.env.DATABASE_URL = url.toString();
  }
  if (command === "test:base") {
    process.env.AI_ENABLED = "false";
    const result = spawnSync(process.execPath, [require.resolve("vitest/vitest.mjs"), "run"], {
      cwd: path.resolve(__dirname, ".."), env: process.env, stdio: "inherit",
    });
    process.exitCode = result.status ?? 1;
    return;
  }
  if (["migrate", "test:migrate", "generate"].includes(command)) {
    const args = command === "generate" ? ["generate"] : ["migrate", "deploy"];
    const result = spawnSync(process.execPath, [require.resolve("prisma/build/index.js"), ...args], {
      cwd: path.resolve(__dirname, ".."), env: process.env, stdio: "inherit",
    });
    process.exitCode = result.status ?? 1;
    return;
  }
  const prisma = require("@/db/prisma");
  try {
    const indexService = require("@/service/aiIndex.service");
    if (command === "import-docker") {
      await require("./import-ai-local")(prisma);
    } else if (command === "seed") {
      const user = await prisma.user.upsert({ where: { username: "ai-local-demo" },
        create: { username: "ai-local-demo", fullname: "Blog Local", email: "ai-local@example.invalid" }, update: {} });
      const examples = [
        { slug: "react-useeffect-local", title: "Hiểu useEffect trong React", description: "Đồng bộ component với hệ thống bên ngoài.",
          content: "<h2>useEffect dùng khi nào?</h2><p>useEffect giúp đồng bộ component React với hệ thống bên ngoài, chẳng hạn gọi API hoặc đăng ký sự kiện.</p><h2>Dependency và cleanup</h2><p>Mảng dependency khai báo các giá trị mà effect phụ thuộc. Khi dependency thay đổi, React chạy cleanup trước khi chạy effect mới. Hàm cleanup dùng để hủy timer, gỡ event listener hoặc hủy request bằng AbortController.</p><pre>useEffect(() =&gt; { const controller = new AbortController(); fetch('/api/posts', { signal: controller.signal }); return () =&gt; controller.abort(); }, []);</pre>" },
        { slug: "postgres-prisma-local", title: "Kết nối PostgreSQL bằng Prisma", description: "Quản lý schema và kết nối database.",
          content: "<h2>Schema và migration</h2><p>Prisma định nghĩa model trong schema.prisma. Migration lưu các thay đổi cấu trúc database thành SQL có phiên bản.</p><h2>Kết nối</h2><p>Ứng dụng đọc chuỗi kết nối từ DATABASE_URL. Với serverless, dùng connection pooling để kiểm soát số kết nối. Không đưa thông tin kết nối database vào mã frontend.</p>" },
        { slug: "rag-blog-local", title: "RAG giúp chatbot trả lời từ bài viết", description: "Tìm kiếm nội dung và dẫn nguồn cho câu trả lời.",
          content: "<h2>Luồng RAG</h2><p>RAG chia bài viết thành các đoạn, tạo embedding và lưu vector trong PostgreSQL. Khi có câu hỏi, hệ thống tìm đoạn liên quan rồi gửi các đoạn đó cho mô hình ngôn ngữ tổng hợp câu trả lời.</p><h2>Dẫn nguồn</h2><p>Backend tạo liên kết từ slug của bài viết. Chatbot chỉ dùng bài công khai đã xuất bản; nếu không tìm được nội dung phù hợp thì báo thiếu thông tin.</p>" },
      ];
      for (const example of examples) {
        const article = await prisma.post.upsert({ where: { slug: example.slug },
          create: { ...example, userId: user.id, status: "published", visibility: "public", publishedAt: new Date() },
          update: example });
        await indexService.enqueue(article.id);
      }
      console.log("Created/updated 3 local sample posts. No remote database was used.");
    } else if (command === "backfill") {
      let cursor;
      let queued = 0;
      while (true) {
        const posts = await prisma.post.findMany({ where: { status: "published", visibility: "public" },
          orderBy: { id: "asc" }, take: 50, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
        if (!posts.length) break;
        for (const post of posts) { await indexService.enqueue(post.id); queued++; }
        cursor = posts[posts.length - 1].id;
      }
      console.log(`Queued ${queued} local posts. Run npm run ai:local -- work next.`);
    } else if (command === "work") {
      if (!getAiConfig().embeddingKey) throw new Error("Add the selected provider API key to .env.ai.local before creating real embeddings.");
      for (const job of await indexService.pending(20)) {
        console.log(job.postId, await indexService.process(job.postId));
      }
    } else if (command === "status") {
      console.log({ posts: await prisma.post.count(), indexes: await prisma.postAiIndex.count(),
        jobs: await prisma.aiIndexJob.groupBy({ by: ["status"], _count: true }) });
    } else if (command === "ask") {
      const question = process.argv.slice(3).join(" ").trim();
      if (!question) throw new Error('Usage: npm run ai:local -- ask "Your question"');
      console.log(JSON.stringify(await require("@/service/aiChat.service").chat(question, []), null, 2));
    } else {
      throw new Error("Commands: serve, migrate, generate, import-docker, seed, backfill, work, status, ask, test:migrate, test:base");
    }
  } finally { await prisma.$disconnect(); }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
