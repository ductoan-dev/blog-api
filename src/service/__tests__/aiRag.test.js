const { createHash } = require("node:crypto");
const jwt = require("jsonwebtoken");
const prisma = require("@/db/prisma");
const provider = require("@/service/aiProvider.service");
const indexService = require("@/service/aiIndex.service");
const chatService = require("@/service/aiChat.service");
const { consume } = require("@/middlewares/aiRateLimit");
const { sourceHash } = require("@/utils/aiContent");
const { resetDb } = require("@/test/resetDb");

function embedding(text) {
  const vector = Array(1536).fill(0);
  vector[/react|effect/i.test(text) ? 0 : /postgres|database/i.test(text) ? 1 : 2] = 1;
  return vector;
}

let user;
let server;
let base;
async function post(overrides = {}) {
  const record = await prisma.post.create({ data: { userId: user.id, title: "React useEffect", slug: `react-${crypto.randomUUID()}`,
    content: "<p>useEffect đồng bộ React với hệ thống bên ngoài. Cleanup hủy đăng ký sự kiện.</p>",
    status: "published", visibility: "public", publishedAt: new Date(Date.now() - 1000), ...overrides } });
  await indexService.enqueue(record.id);
  return record;
}

beforeAll(async () => {
  server = require("../../../ai.app").listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1/ai`;
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await resetDb();
  await prisma.aiRateLimit.deleteMany();
  process.env.AI_ENABLED = "true";
  process.env.AI_SYNC_ON_CHAT = "false";
  process.env.AI_PROVIDER = "openai";
  process.env.AI_EMBEDDING_MODEL = "text-embedding-3-small";
  process.env.OPENAI_API_KEY = "test-key-no-network";
  process.env.AI_REQUESTS_PER_MINUTE = "5";
  delete process.env.QSTASH_TOKEN;
  vi.spyOn(provider, "embed").mockImplementation(async (texts) => texts.map(embedding));
  vi.spyOn(provider, "answer").mockImplementation(async (question, history, sources) => ({ supported: true,
    paragraphs: [{ text: "useEffect đồng bộ component với hệ thống bên ngoài.", sourceIds: [sources[0].id] }] }));
  user = await prisma.user.create({ data: { username: "ai-test" } });
});

afterAll(async () => {
  vi.restoreAllMocks();
  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();
});

describe("RAG against local pgvector (provider mocked, no paid calls)", () => {
  it("indexes, retrieves and answers over HTTP with server-generated source links", async () => {
    const article = await post();
    expect((await indexService.process(article.id)).status).toBe("indexed");
    const response = await fetch(`${base}/chat`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "React useEffect dùng làm gì?" }) });
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.answer).toContain("[1]");
    expect(data.sources[0].url).toBe(`/blog/${article.slug}`);
    expect(data.sources[0].title).toBe(article.title);
  });

  it("deduplicates simultaneous deliveries and skips unchanged content", async () => {
    const article = await post();
    const results = await Promise.all([indexService.process(article.id), indexService.process(article.id)]);
    expect(results.map((result) => result.status).sort()).toEqual(["indexed", "skipped"]);
    expect(await prisma.postChunk.count()).toBe(1);
    await indexService.enqueue(article.id);
    expect((await indexService.process(article.id)).status).toBe("unchanged");
    expect(provider.embed).toHaveBeenCalledTimes(1);
  });

  it("does not leak draft, private, followers, scheduled or deleted posts", async () => {
    const article = await post();
    await indexService.process(article.id);
    for (const change of [{ status: "draft" }, { visibility: "private" }, { visibility: "followers" },
      { publishedAt: new Date(Date.now() + 3600000) }]) {
      await prisma.post.update({ where: { id: article.id }, data: change });
      expect(await chatService.retrieve("React")).toEqual([]);
      await prisma.post.update({ where: { id: article.id }, data: { status: "published", visibility: "public", publishedAt: new Date(0) } });
    }
    await prisma.post.delete({ where: { id: article.id } });
    expect(await prisma.postChunk.count()).toBe(0);
    expect(await chatService.retrieve("React")).toEqual([]);
  });

  it("excludes stale content and uses the latest slug without re-embedding", async () => {
    const article = await post();
    await indexService.process(article.id);
    await prisma.post.update({ where: { id: article.id }, data: { slug: "renamed" } });
    expect((await chatService.chat("React", [])).sources[0].url).toBe("/blog/renamed");
    await prisma.post.update({ where: { id: article.id }, data: { content: "Nội dung mới" } });
    expect(await chatService.retrieve("React")).toEqual([]);
  });

  it("discards an answer when its source becomes private during generation", async () => {
    const article = await post();
    await indexService.process(article.id);
    provider.answer.mockImplementationOnce(async () => {
      await prisma.post.update({ where: { id: article.id }, data: { visibility: "private" } });
      return { supported: true, paragraphs: [{ text: "Private answer", sourceIds: [1] }] };
    });
    const answer = await chatService.chat("React", []);
    expect(answer.sources).toEqual([]);
    expect(answer.answer).not.toContain("Private answer");
  });

  it("does not overwrite an edit made while embedding the previous revision", async () => {
    const article = await post();
    provider.embed.mockImplementationOnce(async (texts) => {
      await prisma.post.update({ where: { id: article.id }, data: { content: "<p>Updated React</p>" } });
      await indexService.enqueue(article.id);
      return texts.map(embedding);
    });
    expect((await indexService.process(article.id)).status).toBe("superseded");
    expect(await prisma.postChunk.count()).toBe(0);
    expect((await indexService.process(article.id)).status).toBe("indexed");
    const latest = await prisma.post.findUnique({ where: { id: article.id } });
    expect((await prisma.postAiIndex.findUnique({ where: { postId: article.id } })).sourceHash).toBe(sourceHash(latest));
  });

  it("keeps failed jobs retryable with sanitized error text", async () => {
    const article = await post();
    provider.embed.mockRejectedValueOnce(new Error("secret upstream response"));
    await expect(indexService.process(article.id)).rejects.toThrow();
    const job = await prisma.aiIndexJob.findUnique({ where: { postId: article.id } });
    expect(job.status).toBe("failed");
    expect(job.attempts).toBe(1);
    expect(job.lastError).toBe("AI_INDEX_ERROR");
    await prisma.aiIndexJob.update({ where: { postId: article.id }, data: { availableAt: new Date(0) } });
    expect((await indexService.process(article.id)).status).toBe("indexed");
  });

  it("returns no answer for unrelated questions and invalid source ids", async () => {
    const article = await post();
    await indexService.process(article.id);
    expect((await chatService.chat("công thức bánh mì", [])).sources).toEqual([]);
    expect(provider.answer).not.toHaveBeenCalled();
    provider.answer.mockResolvedValueOnce({ supported: true, paragraphs: [{ text: "Fake", sourceIds: [999] }] });
    expect((await chatService.chat("React", [])).sources).toEqual([]);
  });

  it("enforces a shared database rate limit atomically", async () => {
    const window = new Date(0);
    const results = await Promise.all(Array.from({ length: 8 }, () => consume("same-client", window, 3)));
    expect(results.filter(Boolean)).toHaveLength(3);
    expect((await prisma.aiRateLimit.findUnique({ where: { key_windowStart: { key: "same-client", windowStart: window } } })).count).toBe(3);
  });

  it("validates input before consuming quota and handles missing configuration", async () => {
    const invalid = await fetch(`${base}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"question":""}' });
    expect(invalid.status).toBe(400);
    expect(await prisma.aiRateLimit.count()).toBe(0);
    delete process.env.OPENAI_API_KEY;
    const disabled = await fetch(`${base}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"question":"React"}' });
    expect(disabled.status).toBe(503);
    expect(provider.answer).not.toHaveBeenCalled();
  });

  it("verifies the exact raw QStash body and rejects unsigned requests", async () => {
    const article = await post();
    process.env.QSTASH_CURRENT_SIGNING_KEY = "test-current-key";
    process.env.QSTASH_NEXT_SIGNING_KEY = "test-next-key";
    process.env.AI_INDEX_JOB_URL = `${base}/jobs/index`;
    expect((await fetch(`${base}/jobs/index`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postId: article.id }) })).status).toBe(401);
    const body = `{ "postId": "${article.id}" }`;
    const signature = jwt.sign({ iss: "Upstash", sub: process.env.AI_INDEX_JOB_URL,
      body: createHash("sha256").update(body).digest("base64url") }, "test-current-key", { expiresIn: 60 });
    const response = await fetch(`${base}/jobs/index`, { method: "POST", headers: {
      "Content-Type": "application/json", "Upstash-Signature": signature,
    }, body });
    expect(response.status).toBe(200);
    expect((await response.json()).data.status).toBe("indexed");
    const tampered = await fetch(`${base}/jobs/index`, { method: "POST", headers: {
      "Content-Type": "application/json", "Upstash-Signature": signature,
    }, body: body.replace("postId", "changed") });
    expect(tampered.status).toBe(401);
  });

  it("explains exhausted OpenAI credits instead of blaming the user's request rate", async () => {
    provider.embed.mockRejectedValueOnce(Object.assign(new Error("AI_INSUFFICIENT_QUOTA"), {
      status: 503, code: "AI_INSUFFICIENT_QUOTA",
    }));
    const response = await fetch(`${base}/chat`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "React?" }) });
    expect(response.status).toBe(503);
    const data = await response.json();
    expect(data.code).toBe("AI_INSUFFICIENT_QUOTA");
    expect(data.message).toContain("Billing");
  });

  it("excludes vectors from the previous provider until posts are reindexed", async () => {
    const article = await post();
    await indexService.process(article.id);
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "test-gemini-no-network";
    process.env.AI_EMBEDDING_MODEL = "gemini-embedding-001";
    expect(await chatService.retrieve("React")).toEqual([]);
    await indexService.enqueue(article.id);
    expect((await indexService.process(article.id)).status).toBe("indexed");
    expect((await chatService.retrieve("React"))[0].postId).toBe(article.id);
  });

  it("retrieves a new interview topic without diluting it with the previous React question", async () => {
    const react = await post();
    await indexService.process(react.id);
    const interview = await post({ title: "Câu hỏi phỏng vấn JavaScript", slug: "phong-van",
      content: "<p>Câu hỏi phỏng vấn JavaScript gồm closure và event loop.</p>" });
    await indexService.process(interview.id);
    const question = "có bài viết nào liên quan tới những câu hỏi khi đi phỏng vấn k";
    await chatService.chat(question, [{ role: "user", content: "React useEffect là gì?" }]);
    expect(provider.embed.mock.calls.at(-1)[0]).toEqual([question]);
    expect(provider.answer.mock.calls.at(-1)[2][0].title).toBe(interview.title);
  });

  it("refreshes a post published by the existing API before answering on Vercel", async () => {
    const article = await prisma.post.create({ data: { userId: user.id, title: "React mới", slug: "react-new",
      content: "<p>React useEffect đồng bộ component.</p>", status: "published", visibility: "public", publishedAt: new Date(0) } });
    expect(await prisma.aiIndexJob.count()).toBe(0);
    process.env.AI_SYNC_ON_CHAT = "true";
    const result = await chatService.chat("React", []);
    expect(result.sources[0].postId).toBe(article.id);
    expect(await prisma.postAiIndex.count()).toBe(1);
  });
});
