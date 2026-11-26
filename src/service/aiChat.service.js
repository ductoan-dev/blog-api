const prisma = require("@/db/prisma");
const provider = require("@/service/aiProvider.service");
const { requireAiConfig } = require("@/config/ai");
const { isPublicPost, sourceHash, vectorLiteral } = require("@/utils/aiContent");

const NO_ANSWER = "Chưa tìm thấy thông tin đủ phù hợp trong các bài viết công khai để trả lời câu hỏi này. Bạn có thể hỏi cụ thể hơn hoặc thử một chủ đề khác.";
const noAnswer = () => ({ answer: NO_ANSWER, paragraphs: [], sources: [] });

function validateInput(body) {
  if (!body || typeof body.question !== "string" || !body.question.trim() || body.question.length > 1500) {
    throw Object.assign(new Error("Câu hỏi cần có từ 1 đến 1.500 ký tự."), { status: 400 });
  }
  const history = body.history ?? [];
  if (!Array.isArray(history) || history.length > 6 || history.some((item) =>
    !item || !["user", "assistant"].includes(item.role) || typeof item.content !== "string" ||
    item.content.length > 2000
  ) || history.reduce((sum, item) => sum + item.content.length, 0) > 8000) {
    throw Object.assign(new Error("Lịch sử hội thoại không hợp lệ."), { status: 400 });
  }
  return { question: body.question.trim(), history: history.map(({ role, content }) => ({ role, content })) };
}

function validateAnswer(result, sources) {
  if (result?.supported !== true || !Array.isArray(result.paragraphs) ||
      !result.paragraphs.length || result.paragraphs.length > 8) return null;
  const ids = new Set(sources.map((source) => source.id));
  const paragraphs = [];
  for (const item of result.paragraphs) {
    if (!item || typeof item.text !== "string" || !item.text.trim() || item.text.length > 2000 ||
        /https?:\/\/|www\.|\]\s*\(|<[^>]+>|\[\d+\]/i.test(item.text) ||
        !Array.isArray(item.sourceIds) || !item.sourceIds.length ||
        item.sourceIds.some((id) => !Number.isInteger(id) || !ids.has(id))) return null;
    paragraphs.push({ text: item.text.trim(), sourceIds: [...new Set(item.sourceIds)] });
  }
  return paragraphs;
}

class AiChatService {
  async retrieve(query) {
    const config = requireAiConfig();
    const [embedding] = await provider.embed([query], "RETRIEVAL_QUERY");
    const vector = vectorLiteral(embedding);
    // Exact search includes all permission filters before ranking. Both branches
    // only consider the currently configured embedding space.
    const rows = await prisma.$queryRaw`
      WITH eligible AS (
        SELECT c.id, c.post_id, c.content, i.source_hash,
          1 - (c.embedding <=> ${vector}::vector) AS similarity,
          ts_rank_cd(to_tsvector('simple', c.content), plainto_tsquery('simple', ${query})) AS keyword_score
        FROM post_chunks c JOIN post_ai_indexes i ON i.post_id = c.post_id
        JOIN posts p ON p.id = c.post_id
        WHERE p.status = 'published' AND p.visibility = 'public'
          AND p.published_at <= NOW() AND i.embedding_model = ${config.embeddingVersion}
      ), semantic AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY similarity DESC, id) AS rank
        FROM eligible WHERE similarity >= ${config.minSimilarity} ORDER BY similarity DESC, id LIMIT 20
      ), keyword AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY keyword_score DESC, id) AS rank
        FROM eligible WHERE keyword_score > 0 ORDER BY keyword_score DESC, id LIMIT 20
      )
      SELECT e.*, COALESCE(1.0 / (60 + s.rank), 0) + COALESCE(1.0 / (60 + k.rank), 0) AS score
      FROM eligible e LEFT JOIN semantic s ON s.id = e.id LEFT JOIN keyword k ON k.id = e.id
      WHERE s.id IS NOT NULL OR k.id IS NOT NULL ORDER BY score DESC, e.id LIMIT 16
    `;
    const posts = await prisma.post.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.post_id))] } } });
    const postMap = new Map(posts.map((post) => [post.id, post]));
    const counts = new Map();
    const selected = [];
    for (const row of rows) {
      const post = postMap.get(row.post_id);
      if (!isPublicPost(post) || sourceHash(post) !== row.source_hash || (counts.get(post.id) || 0) >= 2) continue;
      counts.set(post.id, (counts.get(post.id) || 0) + 1);
      selected.push({ id: selected.length + 1, postId: post.id, title: post.title || "Bài viết",
        slug: post.slug, text: row.content, hash: row.source_hash });
      if (selected.length === 6) break;
    }
    return selected;
  }

  async chat(question, history) {
    requireAiConfig();
    if (process.env.AI_SYNC_ON_CHAT === "true") {
      await require("@/service/aiIndex.service").refreshForChat();
    }
    // Search the current topic first. Appending old questions to every query
    // can pull a new interview question back toward the previous React topic.
    let sources = await this.retrieve(question);
    const followUp = /(?:\b(?:it|that|those|more|explain)\b|đó|này|thêm|kỹ hơn|tiếp|nó|phần trên|ví dụ)/iu.test(question);
    if (!sources.length && followUp) {
      const previous = history.filter((item) => item.role === "user").slice(-2).map((item) => item.content);
      if (previous.length) sources = await this.retrieve([question, ...previous].join("\n").slice(0, 3500));
    }
    if (!sources.length) return noAnswer();
    const result = await provider.answer(question, history, sources.map(({ id, title, text }) => ({ id, title, text })));
    const paragraphs = validateAnswer(result, sources);
    if (!paragraphs) return noAnswer();
    const used = new Set(paragraphs.flatMap((paragraph) => paragraph.sourceIds));
    const referenced = sources.filter((source) => used.has(source.id));
    // A post could be unpublished/edited during the LLM call. Check again and
    // resolve its current slug instead of returning stale links or private text.
    const latest = await prisma.post.findMany({ where: { id: { in: referenced.map((source) => source.postId) } } });
    const latestMap = new Map(latest.map((post) => [post.id, post]));
    if (referenced.some((source) => !isPublicPost(latestMap.get(source.postId)) ||
        sourceHash(latestMap.get(source.postId)) !== source.hash)) return noAnswer();
    return {
      answer: paragraphs.map((paragraph) => `${paragraph.text} ${paragraph.sourceIds.map((id) => `[${id}]`).join(" ")}`).join("\n\n"),
      paragraphs,
      sources: referenced.map((source) => ({ id: source.id, postId: source.postId,
        title: latestMap.get(source.postId).title || "Bài viết",
        url: `/blog/${encodeURIComponent(latestMap.get(source.postId).slug)}`,
        excerpt: source.text.slice(0, 180),
      })),
    };
  }

  async suggestions() {
    const posts = await prisma.post.findMany({ where: {
      status: "published", visibility: "public", publishedAt: { lte: new Date() },
    }, select: { title: true }, orderBy: { publishedAt: "desc" }, take: 3 });
    return posts.filter((post) => post.title).map((post) => `Tóm tắt bài “${post.title.slice(0, 180)}”`);
  }
}

module.exports = new AiChatService();
module.exports.validateInput = validateInput;
module.exports.validateAnswer = validateAnswer;
