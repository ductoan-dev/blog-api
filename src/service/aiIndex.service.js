const { randomUUID } = require("node:crypto");
const prisma = require("@/db/prisma");
const provider = require("@/service/aiProvider.service");
const { getAiConfig } = require("@/config/ai");
const { isPublicPost, sourceHash, chunkPost, vectorLiteral } = require("@/utils/aiContent");

const MAX_ATTEMPTS = 5;

class AiIndexService {
  async enqueue(postId, { dispatch = true } = {}) {
    if (!getAiConfig().enabled) return;
    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (!post) return;
    const now = new Date();
    await prisma.aiIndexJob.upsert({
      where: { postId },
      create: { postId, availableAt: post.publishedAt > now ? post.publishedAt : now },
      update: {
        status: "pending", revision: { increment: 1 }, attempts: 0, lockedAt: null, lastError: null,
        availableAt: post.publishedAt > now ? post.publishedAt : now,
      },
    });
    // Source permissions are also checked in every retrieval. Remove stale data
    // immediately where possible; a failed dispatch must not fail publication.
    if (!isPublicPost(post)) {
      await prisma.postAiIndex.deleteMany({ where: { postId } });
    }
    if (dispatch) await this.dispatch(postId);
  }

  async dispatch(postId) {
    const config = getAiConfig();
    if (!process.env.QSTASH_TOKEN || !config.jobUrl) {
      if (!process.env.VERCEL) return false;
      // A small blog can use bounded Vercel background work without another
      // queue account. The database job remains durable for cron recovery.
      require("@vercel/functions").waitUntil(this.process(postId).catch(() => {
        console.error("[AI] Background indexing failed; job retained for recovery.");
      }));
      return true;
    }
    const job = await prisma.aiIndexJob.findUnique({ where: { postId } });
    if (!job || job.status === "completed" || job.attempts >= MAX_ATTEMPTS) return false;
    try {
      const { Client } = require("@upstash/qstash");
      const client = new Client({ token: process.env.QSTASH_TOKEN, retry: { retries: 0 } });
      await client.publishJSON({
        url: config.jobUrl, body: { postId }, retries: 4,
        delay: Math.max(0, Math.ceil((job.availableAt.getTime() - Date.now()) / 1000)),
      });
      return true;
    } catch {
      console.error("[AI] Dispatch failed; job retained for reconciliation.");
      return false;
    }
  }

  async process(postId) {
    const config = getAiConfig();
    if (!config.enabled) return { status: "disabled" };
    // One atomic claim; concurrent HTTP deliveries cannot process the same lease.
    const claimed = await prisma.$queryRaw`
      UPDATE ai_index_jobs SET status = 'processing', locked_at = NOW(),
        attempts = attempts + 1, updated_at = NOW()
      WHERE post_id = ${postId} AND attempts < ${MAX_ATTEMPTS}
        AND available_at <= NOW()
        AND (status IN ('pending', 'failed') OR
          (status = 'processing' AND locked_at < NOW() - INTERVAL '2 minutes'))
      RETURNING revision, attempts
    `;
    if (!claimed.length) return { status: "skipped" };
    const revision = claimed[0].revision;
    try {
      const post = await prisma.post.findUnique({ where: { id: postId } });
      if (!isPublicPost(post)) {
        await prisma.$transaction(async (tx) => {
          await tx.postAiIndex.deleteMany({ where: { postId } });
          await tx.aiIndexJob.updateMany({ where: { postId, revision }, data: { status: "completed", lockedAt: null } });
        });
        return { status: "removed" };
      }
      const hash = sourceHash(post);
      const existing = await prisma.postAiIndex.findUnique({ where: { postId } });
      if (existing?.sourceHash === hash && existing.embeddingModel === config.embeddingVersion) {
        await prisma.aiIndexJob.updateMany({ where: { postId, revision }, data: { status: "completed", lockedAt: null } });
        return { status: "unchanged" };
      }
      const chunks = chunkPost(post);
      // A single bounded provider request per post; no detached background work.
      const embeddings = chunks.length ? await provider.embed(chunks) : [];
      return await prisma.$transaction(async (tx) => {
        // Lock in the same order as publishing: post, then job. Never overwrite
        // a new publication with an embedding generated from an older snapshot.
        await tx.$queryRaw`SELECT id FROM posts WHERE id = ${postId} FOR UPDATE`;
        const jobs = await tx.$queryRaw`SELECT revision FROM ai_index_jobs WHERE post_id = ${postId} FOR UPDATE`;
        if (!jobs.length || jobs[0].revision !== revision) return { status: "superseded" };
        const latest = await tx.post.findUnique({ where: { id: postId } });
        if (!isPublicPost(latest) || sourceHash(latest) !== hash) {
          await tx.aiIndexJob.update({ where: { postId }, data: { status: "pending", lockedAt: null } });
          return { status: "superseded" };
        }
        await tx.postAiIndex.deleteMany({ where: { postId } });
        await tx.postAiIndex.create({ data: { postId, sourceHash: hash, embeddingModel: config.embeddingVersion } });
        for (let position = 0; position < chunks.length; position++) {
          const vector = vectorLiteral(embeddings[position]);
          await tx.$executeRaw`
            INSERT INTO post_chunks (id, post_id, position, content, embedding)
            VALUES (${randomUUID()}, ${postId}, ${position}, ${chunks[position]}, ${vector}::vector)
          `;
        }
        await tx.aiIndexJob.update({ where: { postId }, data: { status: "completed", lockedAt: null, lastError: null } });
        return { status: "indexed", chunks: chunks.length };
      }, { timeout: 15000 });
    } catch (error) {
      await prisma.aiIndexJob.updateMany({ where: { postId, revision }, data: {
        status: "failed", lockedAt: null,
        lastError: /^AI_[A-Z_]+$/.test(error.message) ? error.message : "AI_INDEX_ERROR",
        availableAt: new Date(Date.now() + Math.min(300, 2 ** claimed[0].attempts) * 1000),
      } });
      throw error;
    }
  }

  async pending(limit = 10) {
    return prisma.aiIndexJob.findMany({
      where: { attempts: { lt: MAX_ATTEMPTS }, availableAt: { lte: new Date() }, OR: [
        { status: { in: ["pending", "failed"] } },
        { status: "processing", lockedAt: { lt: new Date(Date.now() - 120000) } },
      ] }, orderBy: { availableAt: "asc" }, take: limit,
    });
  }

  async reconcile({ dispatch = true } = {}) {
    // Cursor/pagination is supplied by local backfill for large corpora. This
    // small recovery endpoint also catches scheduled posts and missed hooks.
    const posts = await prisma.post.findMany({ where: {
      status: "published", visibility: "public", publishedAt: { lte: new Date() },
    }, include: { aiIndex: true, aiJob: true }, orderBy: { id: "asc" }, take: 1000 });
    let queued = 0;
    for (const post of posts) {
      if (post.aiIndex?.sourceHash === sourceHash(post) &&
          post.aiIndex.embeddingModel === getAiConfig().embeddingVersion) continue;
      if (!post.aiJob || post.aiJob.status === "completed") {
        await this.enqueue(post.id, { dispatch: false });
        queued++;
        if (queued >= 10) break;
      }
    }
    if (dispatch) for (const job of await this.pending()) await this.dispatch(job.postId);
    await prisma.aiRateLimit.deleteMany({ where: { windowStart: { lt: new Date(Date.now() - 172800000) } } });
    return { queued };
  }

  async refreshForChat() {
    const result = await this.reconcile({ dispatch: false });
    const jobs = await this.pending(3);
    // The existing Render API may not yet publish indexing events. Refresh one
    // changed post before retrieval so newly published content is available.
    if (jobs[0]) await this.process(jobs[0].postId);
    if (process.env.VERCEL && jobs.length > 1) {
      require("@vercel/functions").waitUntil((async () => {
        for (const job of jobs.slice(1)) await this.process(job.postId);
      })().catch(() => console.error("[AI] Background refresh deferred to recovery.")));
    }
    return { ...result, processed: jobs.length ? 1 : 0 };
  }
}

module.exports = new AiIndexService();
