CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "post_ai_indexes" (
  "post_id" TEXT PRIMARY KEY REFERENCES "posts"("id") ON DELETE CASCADE,
  "source_hash" TEXT NOT NULL,
  "embedding_model" TEXT NOT NULL,
  "indexed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "post_chunks" (
  "id" TEXT PRIMARY KEY,
  "post_id" TEXT NOT NULL REFERENCES "post_ai_indexes"("post_id") ON DELETE CASCADE,
  "position" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "embedding" vector(1536) NOT NULL
);
CREATE UNIQUE INDEX "post_chunks_post_id_position_key" ON "post_chunks"("post_id", "position");
CREATE INDEX "post_chunks_content_search_idx" ON "post_chunks"
  USING GIN (to_tsvector('simple', "content"));
-- Exact vector search is intentional for a small blog. Add HNSW after measuring
-- corpus size and recall with the publication/visibility filters in place.

CREATE TABLE "ai_index_jobs" (
  "post_id" TEXT PRIMARY KEY REFERENCES "posts"("id") ON DELETE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMP(3),
  "last_error" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ai_index_jobs_status_available_at_idx" ON "ai_index_jobs"("status", "available_at");

CREATE TABLE "ai_rate_limits" (
  "key" TEXT NOT NULL,
  "window_start" TIMESTAMP(3) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("key", "window_start")
);
