const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function docker(args, input) {
  const result = spawnSync("docker", args, { input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error("Local Docker database operation failed. No remote database was used.");
  return result.stdout;
}

module.exports = async function importLocal(prisma) {
  const target = new URL(process.env.DATABASE_URL);
  if (target.hostname !== "127.0.0.1" || target.port !== "5434" || target.pathname !== "/blog_ai_local") {
    throw new Error("Import is restricted to the dedicated blog_ai_local database at 127.0.0.1:5434.");
  }
  const posts = await prisma.post.findMany({ select: { slug: true, user: { select: { username: true } } } });
  const users = await prisma.user.findMany({ select: { username: true } });
  const samples = new Set(["react-useeffect-local", "postgres-prisma-local", "rag-blog-local"]);
  if (posts.some((post) => !samples.has(post.slug) || post.user.username !== "ai-local-demo") ||
      users.some((user) => user.username !== "ai-local-demo")) {
    throw new Error("Target already contains non-demo data; import stopped to preserve local edits.");
  }
  const sourceDump = docker(["exec", "blog-postgres", "pg_dump", "-U", "postgres", "-d", "blog",
    "--data-only", "--disable-triggers", "--no-owner", "--no-acl", "--exclude-table=public._prisma_migrations"]);
  const previousDump = docker(["exec", "blog-ai-postgres-local", "pg_dump", "-U", "blog_ai", "-d", "blog_ai_local",
    "--data-only", "--disable-triggers", "--no-owner", "--no-acl", "--exclude-table=public._prisma_migrations"]);
  const backupDirectory = path.resolve(__dirname, "../.local-backups");
  fs.mkdirSync(backupDirectory, { recursive: true });
  fs.writeFileSync(path.join(backupDirectory, `before-blog-import-${Date.now()}.sql`), previousDump);
  // This runs as one transaction. A failed restore rolls back the truncation as
  // well. The source database is only read; its containers/data are not changed.
  docker(["exec", "-i", "blog-ai-postgres-local", "psql", "-U", "blog_ai", "-d", "blog_ai_local",
    "--set", "ON_ERROR_STOP=1", "--single-transaction"],
  `TRUNCATE TABLE users, topics, tags, queue, ai_rate_limits RESTART IDENTITY CASCADE;\n${sourceDump}`);

  // Keep existing browser sessions valid against the copied user records. Read
  // the running local API's effective signing secret without printing it.
  const auth = JSON.parse(docker(["exec", "blog-api", "node", "-e",
    "require('module-alias/register');process.stdout.write(JSON.stringify({JWT_SECRET:require('./src/config/auth').JWT_SECRET}))"]));
  const envPath = path.resolve(__dirname, "../.env.ai.local");
  let env = fs.readFileSync(envPath, "utf8");
  const secretLine = `JWT_SECRET=${JSON.stringify(auth.JWT_SECRET)}`;
  env = /^JWT_SECRET=.*$/m.test(env) ? env.replace(/^JWT_SECRET=.*$/m, () => secretLine) : `${env.trimEnd()}\n${secretLine}\n`;
  fs.writeFileSync(envPath, env);
  console.log(`Imported ${await prisma.post.count()} actual blog posts into local pgvector. Original Docker database unchanged.`);
};
