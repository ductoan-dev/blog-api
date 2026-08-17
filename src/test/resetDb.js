const prisma = require("@/db/prisma");

const TABLES = [
  "messages", "conversations", "notifications", "refresh_tokens", "queue",
  "bookmarks", "follows", "likes", "comments", "posts", "user_settings",
  "tags", "topics", "users",
];

async function resetDb() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE;`
  );
}

module.exports = { resetDb };
