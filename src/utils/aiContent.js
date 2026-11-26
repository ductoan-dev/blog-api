const { createHash } = require("node:crypto");
const { convert } = require("html-to-text");
const { getEncoding } = require("js-tiktoken");
let encoding;

const PIPELINE_VERSION = "html-chunks-v1";

function isPublicPost(post, now = new Date()) {
  return Boolean(post && post.status === "published" && post.visibility === "public" &&
    post.publishedAt && new Date(post.publishedAt) <= now);
}

function sourceHash(post) {
  return createHash("sha256").update(JSON.stringify([
    PIPELINE_VERSION, post.title || "", post.description || "", post.content || "",
  ])).digest("hex");
}

function vectorLiteral(vector) {
  if (!Array.isArray(vector) || vector.length !== 1536 ||
      vector.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    throw new Error("Invalid embedding: expected 1536 finite numbers");
  }
  return `[${vector.join(",")}]`;
}

function chunkPost(post) {
  const text = convert(post.content || "", {
    wordwrap: false,
    selectors: [
      { selector: "a", options: { ignoreHref: true } },
      { selector: "img", format: "skip" },
      { selector: "script", format: "skip" },
      { selector: "style", format: "skip" },
      ...["h1", "h2", "h3", "h4", "h5", "h6"].map((selector) => ({
        selector, options: { uppercase: false },
      })),
    ],
  }).trim();
  const prefix = [post.title, convert(post.description || "", { wordwrap: false })]
    .filter(Boolean).join("\n").slice(0, 1200);
  if (!text && !prefix) return [];
  encoding ||= getEncoding("cl100k_base");
  const tokens = encoding.encode(text || prefix);
  if (tokens.length > 32000) throw new Error("AI_POST_TOO_LARGE");
  const chunks = [];
  for (let start = 0; start < tokens.length; start += 420) {
    chunks.push(`${prefix}\n\n${encoding.decode(tokens.slice(start, start + 500))}`.trim());
    if (start + 500 >= tokens.length) break;
  }
  return chunks;
}

module.exports = { PIPELINE_VERSION, isPublicPost, sourceHash, vectorLiteral, chunkPost };
