# Mongo → PostgreSQL/Prisma Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `blog-api`'s MongoDB/Mongoose data layer with PostgreSQL/Prisma end-to-end (schema, every service, worker, middleware, socket layer, seed script) and update the specific `blog-ui` files that depend on Mongo-specific id/populate shapes.

**Architecture:** One Prisma schema defines all 14 tables up front (Task 1), so every later task can use any model immediately. Each subsequent task rewrites exactly one service (or a small tightly-coupled group: middlewares+socket, worker+job) from Mongoose calls to Prisma Client calls, verified by real integration tests against a local Postgres test database (no mocking of the ORM — the whole point is verifying the port is correct). This is a **big-bang replacement**, not incremental/dual-write (approved in the spec): between Task 1 (which deletes all Mongoose models) and Task 13 (which restores `server.js`/middlewares/socket), the HTTP server will not boot. This is intentional — correctness is verified per-task via Vitest hitting Prisma directly, not by running the server, until the final smoke-test step.

**Tech Stack:** Prisma 5 + `@prisma/client` (PostgreSQL provider), Vitest (new — this repo has no test runner today) for integration tests against a real local Postgres test database, Node/Express (unchanged), Sequelize/mysql2/mongoose all removed.

**Spec:** `blog-api/docs/superpowers/specs/2026-08-17-mongo-to-postgres-migration-design.md`

## Global Constraints

- Backend stays **CommonJS** (`require`/`module.exports`) everywhere — no ESM, matching the rest of the repo.
- All new DB access goes through Prisma Client (`src/db/prisma.js` singleton). No direct `pg` calls except the raw `TRUNCATE` used by the test-reset helper.
- Every model's primary key is a UUID string (`@id @default(uuid())`) — this preserves the existing `id: string` API contract.
- `utils/response.js`'s `succsess` (misspelled) key is **never** renamed — FE depends on the typo.
- **Casing rule for API responses:** Prisma model fields are camelCase internally, but the JSON sent to `blog-ui` must keep the exact field names it already reads: `first_name`, `last_name`, `website_url`, `twitter_url`, `github_url`, `linkedin_url`, `cover_image`, `two_factor_enabled`, `verified_at`, `follower_count`, `following_count`, `posts_count`, `likes_count`, `views_count`, `like_count`, `meta_title`, `meta_description`, `published_at`, `created_at`, `updated_at` (Comment only), `is_like`, `is_bookmark`. `createdAt`/`updatedAt` (camelCase) stay as-is everywhere else — that was already Mongoose's default and nothing reads a snake_case variant of those two outside Comment. All of this is centralized in `src/utils/serializers.js` (Task 2) — **never build a response object with raw `...spread` of a Prisma row**; always go through a serializer.
- **Two intentional behavior changes, both explicitly approved — do not introduce any others:**
  1. `post.service.js#remove` now decrements the author's `posts_count`, the author's `likes_count` (by however many Post-likes existed), and each attached topic's `posts_count`. The old Mongoose version never decremented any of these (a known drift bug) — this plan fixes it since the whole service is being rewritten anyway.
  2. `src/utils/serializers.js#serializeUser` **never** includes `password` or `twoFactorSecret`, even though the old Mongoose `getUserByUsername`/`getProfile` paths returned the full raw document (including the password hash) to any caller. This was an unintentional leak, not a relied-upon behavior; excluding it here is a deliberate, low-risk fix, called out explicitly rather than silently ported.
- Do **not** fix any other item from CLAUDE.md's "known pitfalls" list (missing `checkAuth` on some write routes, `topic.service.js`/`user.service.js` import gaps that turned out not to exist in the current code, queue retry counter never incrementing, CORS wide open, hardcoded JWT fallback secret) — those are unrelated to the database engine swap.
- Every field-name mapping from an incoming request body (snake_case, matching the old Mongo schema's field names) to a Prisma field (camelCase) must be **explicit** (a literal object/allow-list), never a blind `...spread` into `prisma.<model>.update({ data })` — Prisma throws on unknown keys, unlike Mongoose which silently drops them. This matters for `user.service.js#editProfile`, `post.service.js#create`, and `auth.service.js#register`.

---

## Task 1: Prisma schema, migration, and test harness

**Files:**
- Create: `blog-api/prisma/schema.prisma`
- Create: `blog-api/.env.test`
- Modify: `blog-api/.env`, `blog-api/.env.example` (replace `MONGODB_URI`/`DB_*`/`PROD_DB_*` with `DATABASE_URL`)
- Modify: `blog-api/package.json` (remove `mongoose`; add `prisma` dev dep, `@prisma/client`, `vitest` dev dep; add `test`/`prisma:migrate`/`prisma:generate` scripts)
- Create: `blog-api/vitest.config.js`
- Create: `blog-api/src/test/setup.js`
- Create: `blog-api/src/test/resetDb.js`
- Create: `blog-api/src/test/factories.js`
- Create: `blog-api/src/db/prisma.js`
- Delete: `blog-api/src/db/migrations/` (all 25 files — dead Sequelize scaffold)
- Delete: `blog-api/src/db/seeders/` (all 16 files — dead Sequelize scaffold)
- Delete: `blog-api/.sequelizerc`
- Delete: `blog-api/src/config/database.js`
- Delete: `blog-api/src/db/models/` (all 13 `*.model.js` files + `index.js` — replaced by Prisma; **the app will not boot again until Task 13**)
- Delete: `blog-api/src/utils/queue.js` (dead code — its only job was wrapping `@/db/models`, and it has no caller anywhere in `src/`)
- Test: `blog-api/src/test/__tests__/prisma-setup.test.js`

**Interfaces:**
- Produces: `prisma` (default export of `src/db/prisma.js`) — a `PrismaClient` singleton every later task's service files `require("@/db/prisma")`.
- Produces: `resetDb()` (async, no args, from `src/test/resetDb.js`) — truncates every table; every later test file calls this in a `beforeEach`.
- Produces: `createUser(overrides = {})` (async, from `src/test/factories.js`) — returns a created `User` row; used by every later test that needs a FK.

- [ ] **Step 1: Confirm a local PostgreSQL server is reachable**

Run: `psql -U postgres -h localhost -c "SELECT 1;"` (adjust user/host to your local install)
Expected: returns `1`. If PostgreSQL isn't installed locally, install it now (e.g. via the official installer or Docker: `docker run --name blog-postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16`) before continuing — every later task's tests need it.

- [ ] **Step 2: Create the dev and test databases**

Run:
```bash
psql -U postgres -h localhost -c "CREATE DATABASE blog;"
psql -U postgres -h localhost -c "CREATE DATABASE blog_test;"
```
Expected: both `CREATE DATABASE` succeed (or already exist).

- [ ] **Step 3: Update environment files**

Edit `blog-api/.env` — remove `DB_USER`, `DB_PASS`, `DB_NAME`, `DB_HOST`, `DB_PORT`, `MONGODB_URI`; add:
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/blog
```
(replace `postgres:postgres` with your real local Postgres credentials)

Create `blog-api/.env.test`:
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/blog_test
```

Edit `blog-api/.env.example` — same shape as `.env` but with placeholder credentials:
```
DATABASE_URL=postgresql://user:pass@localhost:5432/blog

MAIL_SERVICE=
MAIL_AUTH_USER=
MAIL_AUTH_PASS=
MAIL_FROM=
CLIENT_URL=

JWT_SECRET=
JWT_EXPIRES_IN=
REFRESH_TOKEN_EXPIRES_IN=
MAIL_JWT_SECRET=
```
Also remove the `PROD_DB_*` block if present and replace with a comment noting production uses its own `DATABASE_URL` in its deploy environment.

- [ ] **Step 4: Write `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id                 String    @id @default(uuid())
  firstName          String?   @map("first_name")
  lastName           String?   @map("last_name")
  email              String?   @unique
  password           String?
  twoFactorEnabled   Boolean   @default(false) @map("two_factor_enabled")
  twoFactorSecret    String?   @map("two_factor_secret")
  username           String?   @unique
  fullname           String?
  avatar             String?
  title              String?
  about              String?
  likesCount         Int       @default(0) @map("likes_count")
  postsCount         Int       @default(0) @map("posts_count")
  followerCount      Int       @default(0) @map("follower_count")
  followingCount     Int       @default(0) @map("following_count")
  address            String?
  websiteUrl         String?   @map("website_url")
  twitterUrl         String?   @map("twitter_url")
  githubUrl          String?   @map("github_url")
  linkedinUrl        String?   @map("linkedin_url")
  location           String?
  skills             String?
  badges             Json?
  coverImage         String?   @map("cover_image")
  verifiedAt         DateTime? @map("verified_at")
  createdAt          DateTime  @default(now()) @map("created_at")
  updatedAt          DateTime  @updatedAt @map("updated_at")

  setting              UserSetting?
  posts                Post[]
  comments             Comment[]
  likes                Like[]
  bookmarks            Bookmark[]
  refreshTokens        RefreshToken[]
  notifications        Notification[]
  messages             Message[]
  followsGiven         Follow[]       @relation("FollowerRelation")
  followsReceived      Follow[]       @relation("FollowingRelation")
  createdConversations Conversation[] @relation("ConversationCreator")
  conversations        Conversation[] @relation("ConversationMembers")

  @@map("users")
}

model UserSetting {
  id        String   @id @default(uuid())
  userId    String   @unique @map("user_id")
  data      Json
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_settings")
}

model Post {
  id              String    @id @default(uuid())
  userId          String    @map("user_id")
  title           String?
  thumbnail       String?
  description     String?
  metaTitle       String?   @map("meta_title")
  metaDescription String?   @map("meta_description")
  content         String?
  slug            String    @unique
  status          String    @default("draft")
  visibility      String    @default("public")
  viewsCount      Int       @default(0) @map("views_count")
  likesCount      Int       @default(0) @map("likes_count")
  publishedAt     DateTime? @map("published_at")
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  topics    Topic[]    @relation("PostTopics")
  tags      Tag[]      @relation("PostTags")
  comments  Comment[]
  bookmarks Bookmark[]

  @@map("posts")
}

model Comment {
  id        String    @id @default(uuid())
  userId    String    @map("user_id")
  postId    String    @map("post_id")
  parentId  String?   @map("parent_id")
  content   String?
  likeCount Int       @default(0) @map("like_count")
  deletedAt DateTime? @map("deleted_at")
  editedAt  DateTime? @map("edited_at")
  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")

  user    User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  post    Post      @relation(fields: [postId], references: [id], onDelete: Cascade)
  parent  Comment?  @relation("CommentReplies", fields: [parentId], references: [id], onDelete: NoAction, onUpdate: NoAction)
  replies Comment[] @relation("CommentReplies")

  @@map("comments")
}

model Like {
  id           String   @id @default(uuid())
  userId       String   @map("user_id")
  likeableType String   @map("likeable_type")
  likeableId   String   @map("likeable_id")
  isLike       Boolean  @default(false) @map("is_like")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, likeableType, likeableId])
  @@map("likes")
}

model Tag {
  id        String   @id @default(uuid())
  name      String   @unique
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  posts Post[] @relation("PostTags")

  @@map("tags")
}

model Topic {
  id          String   @id @default(uuid())
  name        String
  slug        String   @unique
  image       String?
  description String?
  postsCount  Int      @default(0) @map("posts_count")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  posts Post[] @relation("PostTopics")

  @@map("topics")
}

model Bookmark {
  id        String   @id @default(uuid())
  userId    String   @map("user_id")
  postId    String   @map("post_id")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  post Post @relation(fields: [postId], references: [id], onDelete: Cascade)

  @@unique([userId, postId])
  @@map("bookmarks")
}

model Follow {
  id          String   @id @default(uuid())
  followerId  String   @map("follower_id")
  followingId String   @map("following_id")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  follower  User @relation("FollowerRelation", fields: [followerId], references: [id], onDelete: Cascade)
  following User @relation("FollowingRelation", fields: [followingId], references: [id], onDelete: Cascade)

  @@unique([followerId, followingId])
  @@map("follows")
}

model Conversation {
  id            String    @id @default(uuid())
  name          String?
  avatar        String?
  lastMessageAt DateTime? @map("last_message_at")
  createdBy     String?   @map("created_by")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")

  creator  User?     @relation("ConversationCreator", fields: [createdBy], references: [id], onDelete: SetNull)
  members  User[]    @relation("ConversationMembers")
  messages Message[]

  @@map("conversations")
}

model Message {
  id             String    @id @default(uuid())
  userId         String    @map("user_id")
  conversationId String    @map("conversation_id")
  type           String    @default("text")
  content        String?
  deletedAt      DateTime? @map("deleted_at")
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")

  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@map("messages")
}

model Notification {
  id             String    @id @default(uuid())
  userId         String?   @map("user_id")
  type           String
  title          String
  notifiableType String    @map("notifiable_type")
  notifiableId   String    @map("notifiable_id")
  messageLink    String?   @map("message_link")
  readAt         DateTime? @map("read_at")
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")

  user User? @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("notifications")
}

model RefreshToken {
  id        String    @id @default(uuid())
  userId    String    @map("user_id")
  token     String    @unique
  expiredAt DateTime? @map("expired_at")
  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("refresh_tokens")
}

model Queue {
  id           String    @id @default(uuid())
  type         String
  status       String    @default("pending")
  payload      Json
  maxRetries   Int       @default(5) @map("max_retries")
  retriesCount Int       @default(0) @map("retries_count")
  retriedAt    DateTime? @map("retried_at")
  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt @map("updated_at")

  @@map("queue")
}
```

- [ ] **Step 5: Delete the dead Sequelize scaffold and Mongoose models**

Run:
```bash
rm -rf blog-api/src/db/migrations blog-api/src/db/seeders blog-api/.sequelizerc blog-api/src/config/database.js blog-api/src/db/models blog-api/src/utils/queue.js
```
Expected: all six paths gone. The app will not start (`node server.js`) again until Task 13 — this is intentional (see Architecture above).

- [ ] **Step 6: Update `package.json`**

Remove `"mongoose": "^8.24.0"` from `dependencies`. Add to `dependencies`: `"@prisma/client": "^5.20.0"`. Add to `devDependencies`: `"prisma": "^5.20.0"`, `"vitest": "^2.1.0"`. Add to `scripts`:
```json
"test": "vitest run",
"test:watch": "vitest",
"prisma:generate": "prisma generate",
"prisma:migrate": "prisma migrate dev"
```
Run: `cd blog-api && npm install`
Expected: installs cleanly, `node_modules/@prisma/client` and `node_modules/.bin/prisma` exist.

- [ ] **Step 7: Generate and run the initial migration**

Run:
```bash
cd blog-api && npx prisma migrate dev --name init
```
Expected: creates `prisma/migrations/<timestamp>_init/migration.sql`, applies it to the `blog` database, and generates the Prisma Client into `node_modules/@prisma/client`. Then apply the same migration to the test database:
```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/blog_test" npx prisma migrate deploy
```
(On Windows PowerShell: `$env:DATABASE_URL="postgresql://postgres:postgres@localhost:5432/blog_test"; npx prisma migrate deploy`)
Expected: `blog_test` now has the same 14 tables.

- [ ] **Step 8: Create `src/db/prisma.js`**

```js
const { PrismaClient } = require("@prisma/client");

const prisma = global.__prisma || new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}

module.exports = prisma;
```

- [ ] **Step 9: Create the test harness**

`blog-api/vitest.config.js`:
```js
const { defineConfig } = require("vitest/config");
const path = require("path");

module.exports = defineConfig({
  test: {
    environment: "node",
    setupFiles: [path.resolve(__dirname, "src/test/setup.js")],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
```

`blog-api/src/test/setup.js`:
```js
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "../../.env.test") });
require("module-alias/register");
```

`blog-api/src/test/resetDb.js`:
```js
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
```

`blog-api/src/test/factories.js`:
```js
const prisma = require("@/db/prisma");

let counter = 0;

async function createUser(overrides = {}) {
  counter += 1;
  return prisma.user.create({
    data: {
      email: `user${counter}@example.com`,
      username: `user${counter}`,
      firstName: "Test",
      lastName: `User${counter}`,
      password: "hashed-password",
      ...overrides,
    },
  });
}

module.exports = { createUser };
```

- [ ] **Step 10: Write the smoke test**

`blog-api/src/test/__tests__/prisma-setup.test.js`:
```js
const { describe, it, expect, beforeEach, afterAll } = require("vitest");
const prisma = require("@/db/prisma");
const { resetDb } = require("@/test/resetDb");
const { createUser } = require("@/test/factories");

describe("Prisma test harness", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates and reads a user through the real Postgres test database", async () => {
    const user = await createUser({ username: "smoketest" });
    const found = await prisma.user.findUnique({ where: { id: user.id } });
    expect(found.username).toBe("smoketest");
  });

  it("resetDb truncates between tests", async () => {
    const count = await prisma.user.count();
    expect(count).toBe(0);
  });
});
```

- [ ] **Step 11: Run the test to verify it passes**

Run: `cd blog-api && npm test`
Expected: 2 passed (this is a setup-verification test, not a red/green TDD cycle — there is no prior "failing" state to compare against since this is infrastructure being created for the first time).

- [ ] **Step 12: Commit**

```bash
cd blog-api
git add -A
git commit -m "chore: replace Mongoose/MySQL scaffold with Prisma/PostgreSQL schema and test harness"
```

---

## Task 2: Shared serializers + server bootstrap

**Files:**
- Create: `blog-api/src/utils/serializers.js`
- Modify: `blog-api/server.js`
- Test: `blog-api/src/utils/__tests__/serializers.test.js`

**Interfaces:**
- Consumes: `prisma` (Task 1's `src/db/prisma.js`), `createUser` (Task 1's `src/test/factories.js`).
- Produces: `serializeUser(user)`, `serializeTopic(topic)`, `serializeTag(tag)`, `serializePost(post)`, `serializeComment(comment)` — all exported from `src/utils/serializers.js`. Every later service task imports whichever of these it needs.

- [ ] **Step 1: Write the failing test**

```js
const { describe, it, expect, beforeEach, afterAll } = require("vitest");
const prisma = require("@/db/prisma");
const { resetDb } = require("@/test/resetDb");
const { createUser } = require("@/test/factories");
const { serializeUser, serializeTopic, serializePost } = require("@/utils/serializers");

describe("serializers", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("serializeUser maps camelCase fields to the legacy snake_case contract and drops secrets", async () => {
    const user = await createUser({
      firstName: "Alice",
      lastName: "Nguyen",
      websiteUrl: "https://alice.dev",
      password: "super-secret-hash",
      twoFactorSecret: "otp-secret",
    });

    const result = serializeUser(user);

    expect(result.first_name).toBe("Alice");
    expect(result.last_name).toBe("Nguyen");
    expect(result.website_url).toBe("https://alice.dev");
    expect(result.password).toBeUndefined();
    expect(result.two_factor_secret).toBeUndefined();
  });

  it("serializeUser wraps a UserSetting relation back into the legacy stringified settings.data shape", async () => {
    const user = await createUser();
    await prisma.userSetting.create({
      data: { userId: user.id, data: { profileVisibility: "public" } },
    });
    const withSetting = await prisma.user.findUnique({
      where: { id: user.id },
      include: { setting: true },
    });

    const result = serializeUser(withSetting);

    expect(JSON.parse(result.settings.data)).toEqual({ profileVisibility: "public" });
  });

  it("serializeTopic maps posts_count", () => {
    const result = serializeTopic({ id: "t1", name: "Tech", slug: "tech", image: null, description: null, postsCount: 4 });
    expect(result.posts_count).toBe(4);
    expect(result.id).toBe("t1");
  });

  it("serializePost maps counters and nests the user/topics", async () => {
    const user = await createUser();
    const post = await prisma.post.create({
      data: {
        userId: user.id,
        title: "Hello",
        slug: "hello",
        metaTitle: "Hello meta",
        metaDescription: "desc",
        publishedAt: new Date("2026-01-01"),
        viewsCount: 10,
        likesCount: 2,
      },
      include: { user: true, topics: true, tags: true },
    });

    const result = serializePost(post);

    expect(result.meta_title).toBe("Hello meta");
    expect(result.views_count).toBe(10);
    expect(result.likes_count).toBe(2);
    expect(result.user.id).toBe(user.id);
    expect(result.topics).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd blog-api && npx vitest run src/utils/__tests__/serializers.test.js`
Expected: FAIL with "Cannot find module '@/utils/serializers'".

- [ ] **Step 3: Write `src/utils/serializers.js`**

```js
function serializeUser(user) {
  if (!user) return user;
  return {
    id: user.id,
    first_name: user.firstName,
    last_name: user.lastName,
    email: user.email,
    two_factor_enabled: user.twoFactorEnabled,
    username: user.username,
    fullname: user.fullname,
    avatar: user.avatar,
    title: user.title,
    about: user.about,
    likes_count: user.likesCount,
    posts_count: user.postsCount,
    follower_count: user.followerCount,
    following_count: user.followingCount,
    address: user.address,
    website_url: user.websiteUrl,
    twitter_url: user.twitterUrl,
    github_url: user.githubUrl,
    linkedin_url: user.linkedinUrl,
    location: user.location,
    skills: user.skills,
    badges: user.badges,
    cover_image: user.coverImage,
    verified_at: user.verifiedAt,
    settings: user.setting ? { data: JSON.stringify(user.setting.data) } : null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function serializeTag(tag) {
  if (!tag) return tag;
  return { id: tag.id, name: tag.name };
}

function serializeTopic(topic) {
  if (!topic) return topic;
  return {
    id: topic.id,
    name: topic.name,
    slug: topic.slug,
    image: topic.image,
    description: topic.description,
    posts_count: topic.postsCount,
  };
}

function serializePost(post) {
  return {
    id: post.id,
    user: post.user ? serializeUser(post.user) : undefined,
    topics: Array.isArray(post.topics) ? post.topics.map(serializeTopic) : [],
    tags: Array.isArray(post.tags) ? post.tags.map(serializeTag) : [],
    title: post.title,
    thumbnail: post.thumbnail,
    description: post.description,
    meta_title: post.metaTitle,
    meta_description: post.metaDescription,
    content: post.content,
    slug: post.slug,
    status: post.status,
    visibility: post.visibility,
    views_count: post.viewsCount,
    likes_count: post.likesCount,
    published_at: post.publishedAt,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

function serializeComment(comment) {
  return {
    id: comment.id,
    post_id: comment.postId,
    parent_id: comment.parentId,
    user: comment.user ? serializeUser(comment.user) : undefined,
    content: comment.content,
    like_count: comment.likeCount,
    is_like: comment.is_like,
    deleted_at: comment.deletedAt,
    edited_at: comment.editedAt,
    created_at: comment.createdAt,
    updated_at: comment.updatedAt,
    replies: Array.isArray(comment.replies) ? comment.replies.map(serializeComment) : undefined,
  };
}

module.exports = {
  serializeUser,
  serializeTag,
  serializeTopic,
  serializePost,
  serializeComment,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd blog-api && npx vitest run src/utils/__tests__/serializers.test.js`
Expected: 4 passed.

- [ ] **Step 5: Update `server.js`'s bootstrap**

Replace the `mongoose` require/connect block:
```js
require("module-alias/register");
require("dotenv").config();
const http = require("http");
const express = require("express");
const cors = require("cors");
const path = require("path");
const { Server } = require("socket.io");
const router = require("@/routes/api");
const app = express();

const errorHandler = require("@/middlewares/errors/errorHandler");
const notFoudHandler = require("@/middlewares/errors/notFoundHandler");

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use("/api/v1/uploads", express.static(path.join(__dirname, "uploads")));

app.use("/api/v1", router);

app.use(notFoudHandler);
app.use(errorHandler);

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
});

require("@/socket")(io);

server.listen(3000, () => {
  console.log("Server running on port 3000");
});
```
(Prisma needs no explicit connect call — the first query lazily opens the connection pool. `server.js` cannot actually boot yet — every controller still requires the now-deleted service internals or, for services not yet rewritten, will throw at require-time. This is expected until Task 13; do not attempt `node server.js` before then.)

- [ ] **Step 6: Commit**

```bash
cd blog-api
git add -A
git commit -m "feat: add shared response serializers and swap server.js bootstrap to Prisma"
```

---

## Task 3: RefreshToken service

**Files:**
- Modify: `blog-api/src/service/refreshToken.service.js`
- Test: `blog-api/src/service/__tests__/refreshToken.service.test.js`

**Interfaces:**
- Consumes: `prisma`, `createUser`, `resetDb`.
- Produces: `createRefreshToken(userId)`, `findValidRefreshToken(token)`, `deleteRefreshToken(refreshToken)` — unchanged names; `refreshToken.userId` (was `.user_id`) is the new field name every caller (`auth.service.js`, Task 12) must use.

- [ ] **Step 1: Write the failing test**

```js
const { describe, it, expect, beforeEach, afterAll } = require("vitest");
const prisma = require("@/db/prisma");
const { resetDb } = require("@/test/resetDb");
const { createUser } = require("@/test/factories");
const refreshTokenService = require("@/service/refreshToken.service");

describe("refreshToken.service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a refresh token with a future expiry", async () => {
    const user = await createUser();
    const rt = await refreshTokenService.createRefreshToken(user.id);
    expect(rt.userId).toBe(user.id);
    expect(rt.expiredAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("findValidRefreshToken returns null for an expired token", async () => {
    const user = await createUser();
    const rt = await prisma.refreshToken.create({
      data: { userId: user.id, token: "expired-token", expiredAt: new Date(Date.now() - 1000) },
    });
    const found = await refreshTokenService.findValidRefreshToken(rt.token);
    expect(found).toBeNull();
  });

  it("deleteRefreshToken removes the row", async () => {
    const user = await createUser();
    const rt = await refreshTokenService.createRefreshToken(user.id);
    await refreshTokenService.deleteRefreshToken(rt);
    const found = await prisma.refreshToken.findUnique({ where: { id: rt.id } });
    expect(found).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd blog-api && npx vitest run src/service/__tests__/refreshToken.service.test.js`
Expected: FAIL — the current file still calls the deleted `@/db/models`, so it throws `Cannot find module '@/db/models'` at require time.

- [ ] **Step 3: Rewrite `src/service/refreshToken.service.js`**

```js
const prisma = require("@/db/prisma");
const { REFRESH_TOKEN_EXPIRES_IN } = require("@/config/auth");
const generateToken = require("@/utils/generateToken");

const generateUniqueToken = async () => {
  let randToken = null;
  do {
    randToken = generateToken();
  } while (await prisma.refreshToken.findUnique({ where: { token: randToken } }));
  return randToken;
};

const createRefreshToken = async (userId) => {
  const token = await generateUniqueToken();
  const current = new Date();
  const expiredAt = new Date(current.getTime() + REFRESH_TOKEN_EXPIRES_IN * 1000);

  return prisma.refreshToken.create({
    data: { userId, token, expiredAt },
  });
};

const findValidRefreshToken = async (token) => {
  return prisma.refreshToken.findFirst({
    where: { token, expiredAt: { gt: new Date() } },
  });
};

const deleteRefreshToken = async (refreshToken) => {
  await prisma.refreshToken.delete({ where: { id: refreshToken.id } });
};

module.exports = {
  createRefreshToken,
  findValidRefreshToken,
  deleteRefreshToken,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd blog-api && npx vitest run src/service/__tests__/refreshToken.service.test.js`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
cd blog-api
git add -A
git commit -m "feat: port refreshToken.service to Prisma"
```

---

## Task 4: Queue service, worker, and email-verify job

**Files:**
- Modify: `blog-api/src/service/queue.service.js`
- Modify: `blog-api/src/workers/queueWorker.js`
- Modify: `blog-api/src/job/sendVerifyEmailJob.js`
- Test: `blog-api/src/service/__tests__/queue.service.test.js`

**Interfaces:**
- Consumes: `prisma`, `createUser`, `resetDb`.
- Produces: `findPendingJobs()`, `create(data)`, `update(id, data)`, `remove(id)` on `queue.service.js` — same names; jobs now carry `job.maxRetries`/`job.retriesCount` (camelCase) instead of `job.max_retries`/`job.retries_count`.

- [ ] **Step 1: Write the failing test**

```js
const { describe, it, expect, beforeEach, afterAll } = require("vitest");
const prisma = require("@/db/prisma");
const { resetDb } = require("@/test/resetDb");
const queueService = require("@/service/queue.service");

describe("queue.service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a job with a plain-object JSON payload and finds it as pending", async () => {
    await queueService.create({ type: "sendVerifyEmailJob", payload: { userId: "abc" } });
    const pending = await queueService.findPendingJobs();
    expect(pending).toHaveLength(1);
    expect(pending[0].payload).toEqual({ userId: "abc" });
  });

  it("update changes the status", async () => {
    const job = await queueService.create({ type: "sendVerifyEmailJob", payload: {} });
    await queueService.update(job.id, { status: "completed" });
    const updated = await prisma.queue.findUnique({ where: { id: job.id } });
    expect(updated.status).toBe("completed");
  });

  it("remove deletes the job", async () => {
    const job = await queueService.create({ type: "sendVerifyEmailJob", payload: {} });
    await queueService.remove(job.id);
    const found = await prisma.queue.findUnique({ where: { id: job.id } });
    expect(found).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd blog-api && npx vitest run src/service/__tests__/queue.service.test.js`
Expected: FAIL — `Cannot find module '@/db/models'`.

- [ ] **Step 3: Rewrite `src/service/queue.service.js`**

```js
const prisma = require("@/db/prisma");

class QueueService {
  async findPendingJobs() {
    return prisma.queue.findMany({ where: { status: "pending" } });
  }

  async create(data) {
    return prisma.queue.create({ data });
  }

  async update(id, data) {
    await prisma.queue.update({ where: { id }, data });
  }

  async remove(id) {
    await prisma.queue.delete({ where: { id } });
    return null;
  }
}

module.exports = new QueueService();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd blog-api && npx vitest run src/service/__tests__/queue.service.test.js`
Expected: 3 passed.

- [ ] **Step 5: Update `src/workers/queueWorker.js` (field rename only — no automated test)**

This file self-invokes an infinite polling loop and was not unit-tested before either; it's verified in Task 15's end-to-end smoke test instead.

```js
const sendVerifyEmailJob = require("../job/sendVerifyEmailJob");
const QueueService = require("../service/queue.service");

const handlers = {
  sendVerifyEmailJob,
};

async function jobProcess(job) {
  const handler = handlers[job.type];
  if (handler) {
    try {
      await QueueService.update(job.id, { status: "processing" });
      await handler(job);
      await QueueService.update(job.id, { status: "completed" });
    } catch (error) {
      await QueueService.update(job.id, { status: "reject" });

      if (job.maxRetries < job.retriesCount) {
        await QueueService.update(job.id, {
          status: "failed",
        });
      }
    }
  }
}

async function queueWorker() {
  while (true) {
    const jobs = await QueueService.findPendingJobs();

    for (let job of jobs) {
      await jobProcess(job);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

queueWorker();
```

- [ ] **Step 6: Update `src/job/sendVerifyEmailJob.js` (also no automated test — it sends a real email via nodemailer, which this migration does not add mocking for)**

```js
require("module-alias/register");
require("dotenv").config();
const transporter = require("@/config/mailer");
const loadEmail = require("@/utils/loadEmail");
const prisma = require("@/db/prisma");
const jwtService = require("@/service/jwt.service");

async function sendVerifyEmailJob(job) {
  try {
    const { userId } = job.payload;

    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new Error(`User not found with ID: ${userId}`);
    }

    const { token } = jwtService.generateAccessToken(
      userId,
      process.env.MAIL_JWT_SECRET
    );

    const verifyUrl = `${process.env.CLIENT_URL}/verify-email?token=${token}`;
    const data = { token, userId, verifyUrl };
    const template = await loadEmail("verify-email", data);

    if (!template) {
      throw new Error("Failed to load email template");
    }

    const result = await transporter.sendMail({
      from: process.env.MAIL_FROM || "meocute0508@gmail.com",
      subject: "Verification email",
      to: user.email,
      html: template,
    });

    return result;
  } catch (error) {
    console.error("Error in sendVerifyEmailJob:", error.message);
    console.error(error.stack);
    throw error;
  }
}

module.exports = sendVerifyEmailJob;
```

- [ ] **Step 7: Commit**

```bash
cd blog-api
git add -A
git commit -m "feat: port queue.service, queueWorker, and sendVerifyEmailJob to Prisma"
```

---

## Task 5: Notification service (+ notification.controller fix)

**Files:**
- Modify: `blog-api/src/service/notification.service.js`
- Modify: `blog-api/src/controllers/notification.controller.js` (`req.user._id` → `req.user.id`, 3 occurrences)
- Test: `blog-api/src/service/__tests__/notification.service.test.js`

**Interfaces:**
- Consumes: `prisma`, `createUser`, `resetDb`.
- Produces: `create({userId, type, title, notifiableType, notifiableId, messageLink})`, `getAll(userId)`, `markRead(notificationId, userId)`, `markAllRead(userId)` — same names and same returned shape (`{id, type, message, link, read, createdAt}`) as before.

- [ ] **Step 1: Write the failing test**

```js
const { describe, it, expect, beforeEach, afterAll } = require("vitest");
const prisma = require("@/db/prisma");
const { resetDb } = require("@/test/resetDb");
const { createUser } = require("@/test/factories");
const notificationService = require("@/service/notification.service");

describe("notification.service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("create returns the legacy {id,type,message,link,read,createdAt} shape", async () => {
    const user = await createUser();
    const notif = await notificationService.create({
      userId: user.id,
      type: "follow",
      title: "Alice đã theo dõi bạn",
      notifiableType: "User",
      notifiableId: user.id,
      messageLink: "/profile/alice",
    });

    expect(notif.message).toBe("Alice đã theo dõi bạn");
    expect(notif.link).toBe("/profile/alice");
    expect(notif.read).toBe(false);
  });

  it("markRead only succeeds for the notification's own user", async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const created = await notificationService.create({
      userId: owner.id, type: "follow", title: "x", notifiableType: "User", notifiableId: owner.id,
    });

    const wrongUserResult = await notificationService.markRead(created.id, stranger.id);
    expect(wrongUserResult).toBeNull();

    const rightUserResult = await notificationService.markRead(created.id, owner.id);
    expect(rightUserResult.read).toBe(true);
  });

  it("markAllRead marks every unread notification for that user", async () => {
    const user = await createUser();
    await notificationService.create({ userId: user.id, type: "follow", title: "a", notifiableType: "User", notifiableId: user.id });
    await notificationService.create({ userId: user.id, type: "like", title: "b", notifiableType: "Post", notifiableId: user.id });

    await notificationService.markAllRead(user.id);

    const all = await notificationService.getAll(user.id);
    expect(all.every((n) => n.read)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd blog-api && npx vitest run src/service/__tests__/notification.service.test.js`
Expected: FAIL — `Cannot find module '@/db/models'`.

- [ ] **Step 3: Rewrite `src/service/notification.service.js`**

```js
const prisma = require("@/db/prisma");

class NotificationService {
  async create({ userId, type, title, notifiableType, notifiableId, messageLink }) {
    const notif = await prisma.notification.create({
      data: {
        userId,
        type,
        title,
        notifiableType,
        notifiableId,
        messageLink: messageLink || null,
        readAt: null,
      },
    });
    return this._format(notif);
  }

  async getAll(userId) {
    const notifs = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return notifs.map(this._format);
  }

  async markRead(notificationId, userId) {
    const result = await prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { readAt: new Date() },
    });
    if (result.count === 0) return null;
    const notif = await prisma.notification.findUnique({ where: { id: notificationId } });
    return this._format(notif);
  }

  async markAllRead(userId) {
    await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  _format(n) {
    return {
      id: n.id,
      type: n.type,
      message: n.title,
      link: n.messageLink || null,
      read: !!n.readAt,
      createdAt: n.createdAt,
    };
  }
}

module.exports = new NotificationService();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd blog-api && npx vitest run src/service/__tests__/notification.service.test.js`
Expected: 3 passed.

- [ ] **Step 5: Fix `src/controllers/notification.controller.js`**

Replace all three `req.user._id` with `req.user.id`:
```js
const response = require("@/utils/response");
const notificationService = require("@/service/notification.service");

exports.getAll = async (req, res) => {
  try {
    const data = await notificationService.getAll(req.user.id);
    response.succsess(res, 200, data);
  } catch (error) {
    response.error(res, 400, error.message);
  }
};

exports.markRead = async (req, res) => {
  try {
    const data = await notificationService.markRead(req.params.id, req.user.id);
    response.succsess(res, 200, data);
  } catch (error) {
    response.error(res, 400, error.message);
  }
};

exports.markAllRead = async (req, res) => {
  try {
    await notificationService.markAllRead(req.user.id);
    response.succsess(res, 200, true);
  } catch (error) {
    response.error(res, 400, error.message);
  }
};
```

- [ ] **Step 6: Commit**

```bash
cd blog-api
git add -A
git commit -m "feat: port notification.service to Prisma and fix controller's req.user.id"
```

---

## Task 6: Topic service

**Files:**
- Modify: `blog-api/src/service/topic.service.js`
- Test: `blog-api/src/service/__tests__/topic.service.test.js`

**Interfaces:**
- Consumes: `prisma`, `resetDb`.
- Produces: `getAll()`, `getById(id)`, `getBySlug(slug)`, `findOrCreate(name)` (returns `{topic, created}`), `create(data)`, `update(id, data)`, `remove(id)` — same names, same return shapes (raw Prisma rows — `post.service.js`'s Task 10 rewrite is responsible for serializing when embedding a topic in a Post response).

- [ ] **Step 1: Write the failing test**

```js
const { describe, it, expect, beforeEach, afterAll } = require("vitest");
const prisma = require("@/db/prisma");
const { resetDb } = require("@/test/resetDb");
const topicService = require("@/service/topic.service");

describe("topic.service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("findOrCreate creates a topic with a unique slug on first call, reuses it on the second", async () => {
    const first = await topicService.findOrCreate("Technology");
    expect(first.created).toBe(true);
    expect(first.topic.slug).toBe("technology");

    const second = await topicService.findOrCreate("Technology");
    expect(second.created).toBe(false);
    expect(second.topic.id).toBe(first.topic.id);
  });

  it("findOrCreate disambiguates a slug collision between two different names", async () => {
    await prisma.topic.create({ data: { name: "Old Tech", slug: "technology", postsCount: 0 } });
    const { topic } = await topicService.findOrCreate("Technology");
    expect(topic.slug).toBe("technology-1");
  });

  it("update and remove work", async () => {
    const created = await topicService.create({ name: "Design", description: "d", image: "i.png" });
    const updated = await topicService.update(created.id, { description: "updated" });
    expect(updated.description).toBe("updated");

    await topicService.remove(created.id);
    const found = await topicService.getById(created.id);
    expect(found).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd blog-api && npx vitest run src/service/__tests__/topic.service.test.js`
Expected: FAIL — `Cannot find module '@/db/models'`.

- [ ] **Step 3: Rewrite `src/service/topic.service.js`**

```js
const prisma = require("@/db/prisma");
const slugify = require("slugify");
const { faker } = require("@faker-js/faker");

class TopicService {
  async getAll() {
    try {
      return await prisma.topic.findMany();
    } catch (error) {
      throw new Error("Unable to fetch the list of topics");
    }
  }

  async getById(id) {
    return prisma.topic.findUnique({ where: { id } });
  }

  async getBySlug(slug) {
    try {
      return await prisma.topic.findUnique({ where: { slug } });
    } catch (error) {
      throw new Error("Invalid slug");
    }
  }

  async findOrCreate(name) {
    const existing = await prisma.topic.findFirst({ where: { name } });
    if (existing) {
      return { topic: existing, created: false };
    }

    const baseSlug = slugify(name, { lower: true, strict: true });
    let slug = baseSlug;
    let counter = 1;
    while (await prisma.topic.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${counter++}`;
    }

    const topic = await prisma.topic.create({
      data: {
        name,
        slug,
        image: faker.image.urlPicsumPhotos(),
        description: faker.lorem.sentence(),
        postsCount: 0,
      },
    });

    return { topic, created: true };
  }

  async create(data) {
    const { name, description, image } = data;
    if (!name?.trim()) throw new Error("Topic name is required");

    const baseSlug = slugify(name.trim(), { lower: true, strict: true });
    let slug = baseSlug;
    let counter = 1;
    while (await prisma.topic.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${counter++}`;
    }

    return prisma.topic.create({
      data: {
        name: name.trim(),
        slug,
        description: description?.trim() || "",
        image: image?.trim() || faker.image.urlPicsumPhotos(),
        postsCount: 0,
      },
    });
  }

  async update(id, data) {
    try {
      return await prisma.topic.update({ where: { id }, data });
    } catch (error) {
      console.log("Lỗi khi update: ", error);
      return null;
    }
  }

  async remove(id) {
    await prisma.topic.delete({ where: { id } });
    return null;
  }
}

module.exports = new TopicService();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd blog-api && npx vitest run src/service/__tests__/topic.service.test.js`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
cd blog-api
git add -A
git commit -m "feat: port topic.service to Prisma"
```

---

## Task 7: Like service

**Files:**
- Modify: `blog-api/src/service/like.service.js`
- Test: `blog-api/src/service/__tests__/like.service.test.js`

**Interfaces:**
- Consumes: `prisma`, `createUser`, `resetDb`.
- Produces: `getAll(type, ids)` (returns raw Like rows with `.userId`/`.likeableId`/`.likeableType`), `create(data)`, `update(userId, data)`, `checkLike(data)`, `remove(userId, type)`. `post.service.js` (Task 10) and `comment.service.js` (Task 11) both call `getAll` directly.

- [ ] **Step 1: Write the failing test**

```js
const { describe, it, expect, beforeEach, afterAll } = require("vitest");
const prisma = require("@/db/prisma");
const { resetDb } = require("@/test/resetDb");
const { createUser } = require("@/test/factories");
const likesService = require("@/service/like.service");

describe("like.service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("getAll filters by polymorphic type and a list of ids", async () => {
    const user = await createUser();
    await prisma.like.create({ data: { userId: user.id, likeableType: "Post", likeableId: "post-1" } });
    await prisma.like.create({ data: { userId: user.id, likeableType: "Comment", likeableId: "comment-1" } });

    const postLikes = await likesService.getAll("Post", ["post-1", "post-2"]);
    expect(postLikes).toHaveLength(1);
    expect(postLikes[0].likeableId).toBe("post-1");
  });

  it("create maps snake_case caller fields onto the Prisma columns", async () => {
    const user = await createUser();
    const like = await likesService.create({
      user_id: user.id,
      likeable_type: "Post",
      likeable_id: "post-1",
      is_like: true,
    });
    expect(like.userId).toBe(user.id);
    expect(like.likeableType).toBe("Post");
    expect(like.isLike).toBe(true);
  });

  it("remove deletes all likes of a type for a user", async () => {
    const user = await createUser();
    await likesService.create({ user_id: user.id, likeable_type: "Post", likeable_id: "post-1" });
    await likesService.create({ user_id: user.id, likeable_type: "Post", likeable_id: "post-2" });

    await likesService.remove(user.id, "Post");

    const remaining = await prisma.like.findMany({ where: { userId: user.id } });
    expect(remaining).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd blog-api && npx vitest run src/service/__tests__/like.service.test.js`
Expected: FAIL — `Cannot find module '@/db/models'`.

- [ ] **Step 3: Rewrite `src/service/like.service.js`**

```js
const prisma = require("@/db/prisma");

class LikesService {
  async getAll(type, ids) {
    const idArray = Array.isArray(ids) ? ids : [ids];
    return prisma.like.findMany({
      where: { likeableType: type, likeableId: { in: idArray } },
    });
  }

  async create(data) {
    return prisma.like.create({
      data: {
        userId: data.user_id,
        likeableType: data.likeable_type,
        likeableId: data.likeable_id,
        isLike: data.is_like ?? false,
      },
    });
  }

  async update(userId, data) {
    try {
      const like = await prisma.like.findFirst({
        where: {
          userId,
          likeableType: data.likeable_type,
          likeableId: data.likeable_id,
        },
      });

      if (!like) {
        throw new Error("Không tìm thấy bản ghi like");
      }

      return prisma.like.update({
        where: { id: like.id },
        data: { isLike: data.is_like },
      });
    } catch (error) {
      console.log("Lỗi khi update: ", error.message);
      return null;
    }
  }

  async checkLike(data) {
    return this.create(data);
  }

  async remove(userId, type) {
    await prisma.like.deleteMany({ where: { userId, likeableType: type } });
    return null;
  }
}

module.exports = new LikesService();
```

Note: `checkLike` delegates to `create` (both did an identical `Like.create(data)` in the original — kept as an alias rather than duplicated logic).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd blog-api && npx vitest run src/service/__tests__/like.service.test.js`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
cd blog-api
git add -A
git commit -m "feat: port like.service to Prisma"
```

---

## Task 8: Bookmark service

**Files:**
- Modify: `blog-api/src/service/bookmarks.service.js`
- Test: `blog-api/src/service/__tests__/bookmarks.service.test.js`

**Interfaces:**
- Consumes: `prisma`, `createUser`, `resetDb`.
- Produces: `toggleBookmark(currentUser, postId)` (returns boolean), `remove(currentUser, ids)`.

- [ ] **Step 1: Write the failing test**

```js
const { describe, it, expect, beforeEach, afterAll } = require("vitest");
const prisma = require("@/db/prisma");
const { resetDb } = require("@/test/resetDb");
const { createUser } = require("@/test/factories");
const bookmarksService = require("@/service/bookmarks.service");

async function createPost(userId) {
  return prisma.post.create({ data: { userId, title: "T", slug: `t-${Date.now()}-${Math.random()}` } });
}

describe("bookmarks.service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("toggleBookmark creates on first call, removes on second", async () => {
    const user = await createUser();
    const post = await createPost(user.id);

    const created = await bookmarksService.toggleBookmark(user, post.id);
    expect(created).toBe(true);

    const removed = await bookmarksService.toggleBookmark(user, post.id);
    expect(removed).toBe(false);

    const remaining = await prisma.bookmark.findMany({ where: { userId: user.id } });
    expect(remaining).toHaveLength(0);
  });

  it("remove deletes only the given ids", async () => {
    const user = await createUser();
    const post1 = await createPost(user.id);
    const post2 = await createPost(user.id);
    const b1 = await prisma.bookmark.create({ data: { userId: user.id, postId: post1.id } });
    await prisma.bookmark.create({ data: { userId: user.id, postId: post2.id } });

    await bookmarksService.remove(user, [b1.id]);

    const remaining = await prisma.bookmark.findMany({ where: { userId: user.id } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].postId).toBe(post2.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd blog-api && npx vitest run src/service/__tests__/bookmarks.service.test.js`
Expected: FAIL — `Cannot find module '@/db/models'`.

- [ ] **Step 3: Rewrite `src/service/bookmarks.service.js`**

```js
const prisma = require("@/db/prisma");

class BookmarksService {
  async toggleBookmark(currentUser, postId) {
    if (!currentUser)
      throw new Error("You must be logged in to save this post.");

    const existing = await prisma.bookmark.findFirst({
      where: { userId: currentUser.id, postId },
    });

    if (existing) {
      await prisma.bookmark.delete({ where: { id: existing.id } });
      return false;
    }

    await prisma.bookmark.create({ data: { userId: currentUser.id, postId } });
    return true;
  }

  async remove(currentUser, ids) {
    if (!currentUser)
      throw new Error("You must be logged in to remove save all post.");

    if (!Array.isArray(ids) || ids.length === 0)
      throw new Error("No bookmark IDs provided");

    return prisma.bookmark.deleteMany({ where: { id: { in: ids } } });
  }
}

module.exports = new BookmarksService();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd blog-api && npx vitest run src/service/__tests__/bookmarks.service.test.js`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
cd blog-api
git add -A
git commit -m "feat: port bookmarks.service to Prisma"
```

---

## Task 9: User service (+ UserSetting)

**Files:**
- Modify: `blog-api/src/service/user.service.js`
- Test: `blog-api/src/service/__tests__/user.service.test.js`

**Interfaces:**
- Consumes: `prisma`, `createUser`, `resetDb`, `notificationService.create` (Task 5), `serializeUser` (only used internally by other services, not here — this file returns raw Prisma rows same as before, except the two limited-profile fields already used snake_case names).
- Produces: same method names as before (`getAllUser`, `getUserById`, `canUserViewProfile`, `getUserProfileVisibility`, `getUserFollowingIds`, `getUserByUsername`, `toggleFollow`, `getFollowersList`, `getFollowingList`, `checkFollowing`, `editProfile`, `setting`, `search`). `getUserFollowingIds` now returns plain UUID strings (was `.toString()`-converted ObjectIds before — same type, same call sites unaffected).

- [ ] **Step 1: Write the failing test**

```js
const { describe, it, expect, beforeEach, afterAll } = require("vitest");
const prisma = require("@/db/prisma");
const { resetDb } = require("@/test/resetDb");
const { createUser } = require("@/test/factories");
const userService = require("@/service/user.service");

describe("user.service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("toggleFollow creates a Follow row and increments both counters, then reverses on second call", async () => {
    const alice = await createUser({ username: "alice" });
    const bob = await createUser({ username: "bob" });

    const followed = await userService.toggleFollow(alice, bob.id);
    expect(followed).toBe(true);

    const aliceAfter = await prisma.user.findUnique({ where: { id: alice.id } });
    const bobAfter = await prisma.user.findUnique({ where: { id: bob.id } });
    expect(aliceAfter.followingCount).toBe(1);
    expect(bobAfter.followerCount).toBe(1);

    const unfollowed = await userService.toggleFollow(alice, bob.id);
    expect(unfollowed).toBe(false);

    const aliceFinal = await prisma.user.findUnique({ where: { id: alice.id } });
    const bobFinal = await prisma.user.findUnique({ where: { id: bob.id } });
    expect(aliceFinal.followingCount).toBe(0);
    expect(bobFinal.followerCount).toBe(0);
  });

  it("getUserByUsername returns a limited profile when the viewer cannot see it", async () => {
    const owner = await createUser({ username: "private-owner" });
    await prisma.userSetting.create({
      data: { userId: owner.id, data: { profileVisibility: "private" } },
    });
    const stranger = await createUser({ username: "stranger" });

    const result = await userService.getUserByUsername("private-owner", stranger);

    expect(result.canView).toBe(false);
    expect(result.password).toBeUndefined();
  });

  it("setting() upserts a UserSetting row without double JSON-encoding", async () => {
    const user = await createUser();
    await userService.setting({ profileVisibility: "followers", allowComments: false }, user);

    const setting = await prisma.userSetting.findUnique({ where: { userId: user.id } });
    expect(setting.data).toEqual({ profileVisibility: "followers", allowComments: false });
  });

  it("editProfile maps known snake_case body keys and silently ignores unknown ones", async () => {
    const user = await createUser();
    const updated = await userService.editProfile(null, {
      website_url: "https://example.com",
      privacy: JSON.stringify({ ignored: true }),
    }, user);

    expect(updated.websiteUrl).toBe("https://example.com");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd blog-api && npx vitest run src/service/__tests__/user.service.test.js`
Expected: FAIL — `Cannot find module '@/db/models'`.

- [ ] **Step 3: Rewrite `src/service/user.service.js`**

```js
const prisma = require("@/db/prisma");
const emitter = require("@/utils/emitter");
const notificationService = require("@/service/notification.service");

const isEmail = (value) =>
  typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

class UserService {
  async getAllUser() {
    return prisma.user.findMany();
  }

  async getUserById(id) {
    return prisma.user.findUnique({ where: { id } });
  }

  canUserViewProfile(currentUser, targetUser, followerIds = []) {
    const profileVisibility = this.getUserProfileVisibility(targetUser);

    if (!currentUser) {
      return { canView: profileVisibility === "public", type: profileVisibility };
    }

    if (targetUser.id === currentUser.id) {
      return { canView: true, type: "self" };
    }

    if (profileVisibility === "public") {
      return { canView: true, type: "public" };
    }

    if (profileVisibility === "followers") {
      return {
        canView: followerIds.includes(currentUser.id),
        type: "followers",
      };
    }

    if (profileVisibility === "private") {
      return { canView: false, type: "private" };
    }

    return { canView: false, type: "unknown" };
  }

  getUserProfileVisibility(user) {
    return user.setting?.data?.profileVisibility || "public";
  }

  async getUserFollowingIds(currentUser) {
    if (!currentUser) return [];
    try {
      const follows = await prisma.follow.findMany({
        where: { followerId: currentUser.id },
        select: { followingId: true },
      });
      return follows.map((f) => f.followingId);
    } catch (error) {
      console.log(error);
      return [];
    }
  }

  async getUserByUsername(username, currentUser = null) {
    const user = await prisma.user.findUnique({
      where: { username },
      include: { setting: true },
    });

    if (!user) throw new Error("User does not exist");

    const followerDocs = await prisma.follow.findMany({
      where: { followingId: user.id },
      select: { followerId: true },
    });
    const followerIds = followerDocs.map((f) => f.followerId);

    const result = this.canUserViewProfile(currentUser, user, followerIds);

    if (!result.canView) {
      return {
        id: user.id,
        username: user.username,
        title: user.title,
        avatar: user.avatar,
        canView: false,
        type: result.type,
        follower_count: user.followerCount,
        following_count: user.followingCount,
      };
    }

    const { password, twoFactorSecret, ...safeUser } = user;
    return safeUser;
  }

  async toggleFollow(currentUser, userId) {
    if (!currentUser) throw new Error("Bạn phải đăng nhập để follow");
    if (currentUser.id === userId) throw new Error("You cannot follow yourself");

    const userFollower = await prisma.user.findUnique({
      where: { id: userId },
      include: { setting: true },
    });
    if (!userFollower) throw new Error("User not found");

    const existingFollow = await prisma.follow.findFirst({
      where: { followerId: currentUser.id, followingId: userId },
    });

    if (existingFollow) {
      await prisma.follow.delete({ where: { id: existingFollow.id } });
      await prisma.user.update({
        where: { id: currentUser.id },
        data: { followingCount: { decrement: 1 } },
      });
      await prisma.user.update({
        where: { id: userId },
        data: { followerCount: { decrement: 1 } },
      });
      return false;
    }

    await prisma.follow.create({ data: { followerId: currentUser.id, followingId: userId } });
    await prisma.user.update({
      where: { id: userId },
      data: { followerCount: { increment: 1 } },
    });
    await prisma.user.update({
      where: { id: currentUser.id },
      data: { followingCount: { increment: 1 } },
    });

    try {
      const followerName =
        currentUser.fullname ||
        [currentUser.firstName, currentUser.lastName].filter(Boolean).join(" ") ||
        currentUser.username;
      const notif = await notificationService.create({
        userId: userFollower.id,
        type: "follow",
        title: `${followerName} đã theo dõi bạn`,
        notifiableType: "User",
        notifiableId: currentUser.id,
        messageLink: `/profile/${currentUser.username}`,
      });
      emitter.emit("notification:follow", { toUserId: userFollower.id, notification: notif });
    } catch (error) {
      console.log("Follow notification error:", error);
    }

    try {
      if (userFollower.setting?.data?.emailNewFollowers) {
        await prisma.queue.create({
          data: {
            type: "sendNewFollowerJob",
            payload: { following: userFollower, follower: currentUser },
          },
        });
      }
    } catch (error) {
      console.log(error);
    }

    return true;
  }

  async getFollowersList(userId) {
    const follows = await prisma.follow.findMany({
      where: { followingId: userId },
      include: { follower: true },
    });
    return follows.map((f) => f.follower);
  }

  async getFollowingList(userId) {
    const follows = await prisma.follow.findMany({
      where: { followerId: userId },
      include: { following: true },
    });
    return follows.map((f) => f.following);
  }

  async checkFollowing(currentUser, userId) {
    if (!currentUser) throw new Error("Bạn phải đăng nhập để follow");

    const follow = await prisma.follow.findFirst({
      where: { followerId: currentUser.id, followingId: userId },
    });

    return !!follow;
  }

  async editProfile(avatarOrCoverPath, data, currentUser) {
    if (!currentUser) throw new Error("You must be logged to edit");

    const updateData = {};

    if (avatarOrCoverPath?.avatar?.[0]?.path) {
      updateData.avatar = avatarOrCoverPath.avatar[0].path.replace(/\\/g, "/");
    }
    if (avatarOrCoverPath?.cover_image?.[0]?.path) {
      updateData.coverImage = avatarOrCoverPath.cover_image[0].path.replace(/\\/g, "/");
    }

    // Prisma throws on unknown keys (unlike Mongoose, which silently drops
    // fields with no matching schema path) — map explicitly instead of
    // spreading the raw multipart body.
    const allowedFields = {
      fullname: "fullname",
      first_name: "firstName",
      last_name: "lastName",
      username: "username",
      title: "title",
      about: "about",
      location: "location",
      address: "address",
      website_url: "websiteUrl",
      twitter_url: "twitterUrl",
      github_url: "githubUrl",
      linkedin_url: "linkedinUrl",
      skills: "skills",
    };

    for (const [bodyKey, prismaField] of Object.entries(allowedFields)) {
      if (data[bodyKey] !== undefined) {
        updateData[prismaField] = data[bodyKey];
      }
    }

    try {
      return await prisma.user.update({ where: { id: currentUser.id }, data: updateData });
    } catch (error) {
      throw new Error(error);
    }
  }

  async setting(data, currentUser) {
    if (!currentUser) throw new Error("You must be logged to edit settings");
    const { email, ...settings } = data;

    if (email !== currentUser.email) {
      if (email && !isEmail(email)) {
        throw new Error("Invalid email address");
      }
      await prisma.user.update({
        where: { id: currentUser.id },
        data: { verifiedAt: null, email },
      });

      await prisma.queue.create({
        data: {
          type: "sendVerifyEmailJob",
          payload: { userId: currentUser.id },
        },
      });
    }

    await prisma.userSetting.upsert({
      where: { userId: currentUser.id },
      create: { userId: currentUser.id, data: settings },
      update: { data: settings },
    });
  }

  async search(query) {
    return prisma.user.findMany({
      where: {
        OR: [
          { username: { contains: query, mode: "insensitive" } },
          { fullname: { contains: query, mode: "insensitive" } },
          { firstName: { contains: query, mode: "insensitive" } },
          { lastName: { contains: query, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        avatar: true,
        username: true,
        fullname: true,
        firstName: true,
        lastName: true,
        title: true,
      },
    });
  }
}

module.exports = new UserService();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd blog-api && npx vitest run src/service/__tests__/user.service.test.js`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
cd blog-api
git add -A
git commit -m "feat: port user.service to Prisma, moving settings to a real UserSetting table"
```

---

## Task 10: Post service

**Files:**
- Modify: `blog-api/src/service/post.service.js`
- Test: `blog-api/src/service/__tests__/post.service.test.js`

**Interfaces:**
- Consumes: `prisma`, `createUser`, `resetDb`, `serializePost` (Task 2), `likesService.getAll` (Task 7), `topicsService.findOrCreate` (Task 6), `usersService.getUserFollowingIds` (Task 9), `notificationService.create` (Task 5).
- Produces: same method names as before. `getAll`/`getListByMe`/`getByUserName`/`getBookmarkedPostsByUser`/`getByTopicId`/`getRelatedPosts`/`getFollowingFeed`/`search` all now return already-serialized post objects (via `serializePost`) plus `is_like`/`is_bookmark`.

- [ ] **Step 1: Write the failing test**

```js
const { describe, it, expect, beforeEach, afterAll } = require("vitest");
const prisma = require("@/db/prisma");
const { resetDb } = require("@/test/resetDb");
const { createUser } = require("@/test/factories");
const postService = require("@/service/post.service");

describe("post.service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("create() maps the multipart-form snake_case fields, attaches topics, and increments counters", async () => {
    const user = await createUser();

    const post = await postService.create(null, {
      title: "Hello World",
      description: "desc",
      content: "content",
      status: "published",
      visibility: "public",
      meta_title: "meta title",
      meta_description: "meta desc",
      topics: JSON.stringify(["Technology"]),
    }, user);

    expect(post.slug).toBe("hello-world");
    expect(post.metaTitle).toBe("meta title");

    const withTopics = await prisma.post.findUnique({ where: { id: post.id }, include: { topics: true } });
    expect(withTopics.topics.map((t) => t.name)).toEqual(["Technology"]);

    const author = await prisma.user.findUnique({ where: { id: user.id } });
    expect(author.postsCount).toBe(1);

    const topic = await prisma.topic.findUnique({ where: { slug: "technology" } });
    expect(topic.postsCount).toBe(1);
  });

  it("toggleLike creates a Like row and updates both post and author counters, then reverses", async () => {
    const author = await createUser();
    const liker = await createUser();
    const post = await postService.create(null, {
      title: "P", description: "d", content: "c", status: "published", visibility: "public",
      meta_title: "", meta_description: "", topics: "[]",
    }, author);

    const liked = await postService.toggleLike(liker, post.id);
    expect(liked).toBe(true);
    let authorAfter = await prisma.user.findUnique({ where: { id: author.id } });
    expect(authorAfter.likesCount).toBe(1);

    const unliked = await postService.toggleLike(liker, post.id);
    expect(unliked).toBe(false);
    authorAfter = await prisma.user.findUnique({ where: { id: author.id } });
    expect(authorAfter.likesCount).toBe(0);
  });

  it("remove() decrements the author's posts_count/likes_count and each topic's posts_count (approved bug fix)", async () => {
    const author = await createUser();
    const liker = await createUser();
    const post = await postService.create(null, {
      title: "P2", description: "d", content: "c", status: "published", visibility: "public",
      meta_title: "", meta_description: "", topics: JSON.stringify(["Design"]),
    }, author);
    await postService.toggleLike(liker, post.id);

    await postService.remove(post.id);

    const authorAfter = await prisma.user.findUnique({ where: { id: author.id } });
    expect(authorAfter.postsCount).toBe(0);
    expect(authorAfter.likesCount).toBe(0);

    const topic = await prisma.topic.findUnique({ where: { slug: "design" } });
    expect(topic.postsCount).toBe(0);
  });

  it("getBySlug returns a serialized post with is_like/is_bookmark flags for the viewing user", async () => {
    const author = await createUser();
    const viewer = await createUser();
    const post = await postService.create(null, {
      title: "P3", description: "d", content: "c", status: "published", visibility: "public",
      meta_title: "", meta_description: "", topics: "[]",
    }, author);
    await postService.toggleLike(viewer, post.id);

    const found = await postService.getBySlug(post.slug, viewer);

    expect(found.is_like).toBe(true);
    expect(found.is_bookmark).toBe(false);
    expect(found.user.id).toBe(author.id);
    expect(found.views_count).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd blog-api && npx vitest run src/service/__tests__/post.service.test.js`
Expected: FAIL — `Cannot find module '@/db/models'`.

- [ ] **Step 3: Rewrite `src/service/post.service.js`**

```js
const prisma = require("@/db/prisma");
const likesService = require("@/service/like.service");
const topicsService = require("@/service/topic.service");
const usersService = require("@/service/user.service");
const slugify = require("slugify");
const emitter = require("@/utils/emitter");
const notificationService = require("@/service/notification.service");
const { serializePost } = require("@/utils/serializers");

const POST_INCLUDE = { user: true, topics: true, tags: true };

class PostsService {
  async getAll(currentUser = null) {
    const posts = await prisma.post.findMany({
      include: POST_INCLUDE,
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    });

    const mapped = posts.map(serializePost);
    const postIds = posts.map((p) => p.id);
    const result = await this.handleLikeAndBookmarkFlags(mapped, currentUser);
    return { posts: result, postIds };
  }

  canUserViewPost(post, currentUser, followingIds = []) {
    if (!currentUser) {
      return post.visibility === "public" || !post.visibility;
    }

    const postUserId = post.user?.id;

    if (postUserId === currentUser.id) return true;

    if (post.visibility === "public" || !post.visibility) return true;

    if (post.visibility === "followers") {
      return followingIds.includes(postUserId);
    }

    return false;
  }

  async getById(id) {
    const post = await prisma.post.findUnique({ where: { id }, include: POST_INCLUDE });
    if (!post) return null;
    return serializePost(post);
  }

  async getListByMe(currentUser) {
    try {
      const posts = await prisma.post.findMany({
        where: { userId: currentUser.id },
        include: POST_INCLUDE,
      });

      const mapped = posts.map(serializePost);
      return this.handleLikeAndBookmarkFlags(mapped, currentUser);
    } catch (error) {
      throw new Error("Get fail");
    }
  }

  async getByUserName(username, currentUser) {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) throw new Error("Not found user by username");

    const posts = await prisma.post.findMany({
      where: { userId: user.id, status: "published", publishedAt: { lte: new Date() } },
      include: POST_INCLUDE,
    });

    const mapped = posts.map(serializePost);

    const followingIds = await usersService.getUserFollowingIds(currentUser);
    const postVisible = mapped.filter((post) =>
      this.canUserViewPost(post, currentUser, followingIds)
    );

    return this.handleLikeAndBookmarkFlags(postVisible, currentUser);
  }

  handleLikeAndBookmarkFlags = async (posts, currentUser) => {
    if (!currentUser) return posts;

    const postIds = posts.map((p) => p.id);

    const [likes, bookmarks] = await Promise.all([
      likesService.getAll("Post", postIds),
      prisma.bookmark.findMany({ where: { userId: currentUser.id, postId: { in: postIds } } }),
    ]);

    const likedSet = new Set();
    likes.forEach((like) => {
      if (like.userId === currentUser.id) {
        likedSet.add(like.likeableId);
      }
    });

    const bookmarkSet = new Set(bookmarks.map((b) => b.postId));

    return posts.map((post) => ({
      ...post,
      is_like: likedSet.has(post.id),
      is_bookmark: bookmarkSet.has(post.id),
    }));
  };

  async getBySlug(slug, currentUser = null) {
    const post = await prisma.post.findUnique({ where: { slug }, include: POST_INCLUDE });
    if (!post) return null;

    const base = serializePost(post);
    const [withFlags] = await this.handleLikeAndBookmarkFlags([base], currentUser);
    return withFlags;
  }

  async getBookmarkedPostsByUser(currentUser) {
    if (!currentUser) throw new Error("You must be logged in to access this.");

    const bookmarks = await prisma.bookmark.findMany({ where: { userId: currentUser.id } });
    const postIds = bookmarks.map((b) => b.postId);

    const posts = await prisma.post.findMany({
      where: { id: { in: postIds } },
      include: POST_INCLUDE,
    });

    const mapped = posts.map(serializePost);
    return this.handleLikeAndBookmarkFlags(mapped, currentUser);
  }

  async getByTopicId(currentUser, topicId) {
    try {
      const posts = await prisma.post.findMany({
        where: {
          topics: { some: { id: topicId } },
          status: "published",
          publishedAt: { lte: new Date() },
        },
        include: POST_INCLUDE,
      });

      const mapped = posts.map(serializePost);

      const followingIds = await usersService.getUserFollowingIds(currentUser);
      const postVisible = mapped.filter((post) =>
        this.canUserViewPost(post, currentUser, followingIds)
      );

      return this.handleLikeAndBookmarkFlags(postVisible, currentUser);
    } catch (error) {
      throw new Error("TopicId invalid");
    }
  }

  async getRelatedPosts(currentPostId, currentUser) {
    const currentPost = await prisma.post.findUnique({
      where: { id: currentPostId },
      include: { topics: true },
    });

    if (!currentPost || currentPost.status !== "published" || currentPost.publishedAt > new Date()) {
      throw new Error("Post not found");
    }

    const topicIds = currentPost.topics.map((t) => t.id);

    const publishedFilter = {
      id: { not: currentPost.id },
      status: "published",
      publishedAt: { lte: new Date() },
    };

    let postByTopics = [];
    if (topicIds.length > 0) {
      postByTopics = await prisma.post.findMany({
        where: { ...publishedFilter, topics: { some: { id: { in: topicIds } } } },
        include: POST_INCLUDE,
      });
      postByTopics = shuffle(postByTopics).slice(0, 3);
    }

    let allPosts = postByTopics;

    if (postByTopics.length < 3) {
      const excludeIds = [currentPost.id, ...postByTopics.map((p) => p.id)];
      const morePosts = await prisma.post.findMany({
        where: { ...publishedFilter, id: { notIn: excludeIds } },
        include: POST_INCLUDE,
      });

      allPosts = [...postByTopics, ...shuffle(morePosts).slice(0, 3 - postByTopics.length)];
    }

    const mapped = allPosts.map(serializePost);

    const followingIds = await usersService.getUserFollowingIds(currentUser);
    const postVisible = mapped.filter((post) =>
      this.canUserViewPost(post, currentUser, followingIds)
    );

    return this.handleLikeAndBookmarkFlags(postVisible, currentUser);
  }

  async getFollowingFeed(currentUser) {
    if (!currentUser) throw new Error("You must be logged in.");

    const followingIds = await usersService.getUserFollowingIds(currentUser);
    if (!followingIds.length) return [];

    const posts = await prisma.post.findMany({
      where: {
        userId: { in: followingIds },
        status: "published",
        publishedAt: { lte: new Date() },
      },
      include: POST_INCLUDE,
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    });

    const mapped = posts.map(serializePost);

    return this.handleLikeAndBookmarkFlags(mapped, currentUser);
  }

  async viewsCount(id) {
    try {
      await prisma.post.update({ where: { id }, data: { viewsCount: { increment: 1 } } });
    } catch (error) {
      console.log("Lỗi không thấy cập nhập views", error);
    }
  }

  async toggleLike(currentUser, postId) {
    if (!currentUser)
      throw new Error("You must be logged in to like this post.");

    const existing = await prisma.like.findFirst({
      where: { likeableId: postId, userId: currentUser.id, likeableType: "Post" },
    });

    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (!post) throw new Error("Post not found");

    if (existing) {
      await prisma.like.delete({ where: { id: existing.id } });
      await prisma.post.update({
        where: { id: postId },
        data: { likesCount: Math.max(0, post.likesCount - 1) },
      });
      await prisma.user.update({
        where: { id: post.userId },
        data: { likesCount: { decrement: 1 } },
      });
      return false;
    }

    await prisma.like.create({
      data: { likeableId: postId, userId: currentUser.id, likeableType: "Post" },
    });
    await prisma.post.update({
      where: { id: postId },
      data: { likesCount: post.likesCount + 1 },
    });
    await prisma.user.update({
      where: { id: post.userId },
      data: { likesCount: { increment: 1 } },
    });

    if (post.userId !== currentUser.id) {
      try {
        const likerName =
          currentUser.fullname ||
          [currentUser.firstName, currentUser.lastName].filter(Boolean).join(" ") ||
          currentUser.username;
        const notif = await notificationService.create({
          userId: post.userId,
          type: "like",
          title: `${likerName} đã thích bài viết của bạn`,
          notifiableType: "Post",
          notifiableId: post.id,
          messageLink: `/blog/${post.slug}`,
        });
        emitter.emit("notification:post_like", {
          toUserId: post.userId,
          notification: notif,
        });
      } catch (err) {
        console.log("Like notification error:", err);
      }
    }

    return true;
  }

  async create(thumbnailPath, data, currentUser) {
    if (!currentUser) throw new Error("You must be logged to edit");

    const postData = {
      title: data.title,
      description: data.description,
      content: data.content,
      status: data.status,
      visibility: data.visibility,
      metaTitle: data.meta_title,
      metaDescription: data.meta_description,
    };

    if (thumbnailPath) {
      postData.thumbnail = thumbnailPath.path.replace(/\\/g, "/");
    }

    postData.publishedAt = data.published_at ? new Date(data.published_at) : new Date();

    const baseSlug = slugify(postData.title, { lower: true, strict: true });
    let slug = baseSlug;
    let counter = 1;
    while (await prisma.post.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${counter++}`;
    }

    const post = await prisma.post.create({
      data: { ...postData, slug, userId: currentUser.id },
    });

    const newTopics = JSON.parse(data.topics || "[]");
    await Promise.all(
      newTopics.map(async (item) => {
        const { topic } = await topicsService.findOrCreate(item);
        await prisma.topic.update({
          where: { id: topic.id },
          data: { postsCount: { increment: 1 } },
        });
        await prisma.post.update({
          where: { id: post.id },
          data: { topics: { connect: { id: topic.id } } },
        });
      })
    );

    await prisma.user.update({
      where: { id: currentUser.id },
      data: { postsCount: { increment: 1 } },
    });

    return post;
  }

  async update(id, data) {
    try {
      return await prisma.post.update({ where: { id }, data });
    } catch (error) {
      console.log("Lỗi khi update", error);
      return null;
    }
  }

  async remove(id) {
    const post = await prisma.post.findUnique({ where: { id }, include: { topics: true } });
    if (!post) return null;

    const likesToRemove = await prisma.like.count({
      where: { likeableType: "Post", likeableId: id },
    });

    await prisma.post.delete({ where: { id } });

    await prisma.user.update({
      where: { id: post.userId },
      data: {
        postsCount: { decrement: 1 },
        likesCount: { decrement: likesToRemove },
      },
    });

    await Promise.all(
      post.topics.map((topic) =>
        prisma.topic.update({ where: { id: topic.id }, data: { postsCount: { decrement: 1 } } })
      )
    );

    return null;
  }

  async search(query, currentUser = null) {
    const posts = await prisma.post.findMany({
      where: {
        status: "published",
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { content: { contains: query, mode: "insensitive" } },
        ],
      },
      include: POST_INCLUDE,
      orderBy: { publishedAt: "desc" },
    });

    const mapped = posts.map(serializePost);

    return this.handleLikeAndBookmarkFlags(mapped, currentUser);
  }
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = new PostsService();
```

Note: `Post.remove` now cascade-deletes the post's `Comment`/`Bookmark` rows automatically (the schema's `onDelete: Cascade` on those relations) — the old Mongoose version left them orphaned. This is a natural, low-risk consequence of using real foreign keys, not a separately-approved behavior change to call out with a flag — it only removes now-meaningless dangling rows.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd blog-api && npx vitest run src/service/__tests__/post.service.test.js`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
cd blog-api
git add -A
git commit -m "feat: port post.service to Prisma, fixing counter drift on post delete"
```

---

## Task 11: Comment service

**Files:**
- Modify: `blog-api/src/service/comment.service.js`
- Test: `blog-api/src/service/__tests__/comment.service.test.js`

**Interfaces:**
- Consumes: `prisma`, `createUser`, `resetDb`, `serializeComment` (Task 2), `likesService.getAll` (Task 7), `notificationService.create` (Task 5).
- Produces: same method names as before (`getAll`, `getById`, `getBySlug`, `getAllCommentsInPost`, `likeCommentFlags`, `toggleLike`, `create`, `update`, `remove`).

- [ ] **Step 1: Write the failing test**

```js
const { describe, it, expect, beforeEach, afterAll } = require("vitest");
const prisma = require("@/db/prisma");
const { resetDb } = require("@/test/resetDb");
const { createUser } = require("@/test/factories");
const commentService = require("@/service/comment.service");

async function createPost(userId) {
  return prisma.post.create({ data: { userId, title: "T", slug: `t-${Date.now()}-${Math.random()}` } });
}

describe("comment.service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("create() returns a serialized comment with a nested flat user", async () => {
    const author = await createUser();
    const post = await createPost(author.id);

    const comment = await commentService.create(author, { post_id: post.id, content: "hello" });

    expect(comment.content).toBe("hello");
    expect(comment.user.id).toBe(author.id);
    expect(comment.replies).toEqual([]);
  });

  it("a reply to a reply gets re-parented to the top-level comment", async () => {
    const author = await createUser();
    const post = await createPost(author.id);

    const top = await commentService.create(author, { post_id: post.id, content: "top" });
    const reply = await commentService.create(author, { post_id: post.id, content: "reply", parent_id: top.id });
    const replyToReply = await commentService.create(author, { post_id: post.id, content: "reply2", parent_id: reply.id });

    expect(replyToReply.parent_id).toBe(top.id);
  });

  it("getAllCommentsInPost nests replies and reports is_like for the viewer", async () => {
    const author = await createUser();
    const liker = await createUser();
    const post = await createPost(author.id);
    const top = await commentService.create(author, { post_id: post.id, content: "top" });
    await commentService.create(author, { post_id: post.id, content: "reply", parent_id: top.id });
    await commentService.toggleLike(liker, top.id);

    const result = await commentService.getAllCommentsInPost(post.id, liker);

    expect(result).toHaveLength(1);
    expect(result[0].replies).toHaveLength(1);
    expect(result[0].is_like).toBe(true);
  });

  it("toggleLike increments/decrements like_count", async () => {
    const author = await createUser();
    const liker = await createUser();
    const post = await createPost(author.id);
    const comment = await commentService.create(author, { post_id: post.id, content: "c" });

    await commentService.toggleLike(liker, comment.id);
    let updated = await prisma.comment.findUnique({ where: { id: comment.id } });
    expect(updated.likeCount).toBe(1);

    await commentService.toggleLike(liker, comment.id);
    updated = await prisma.comment.findUnique({ where: { id: comment.id } });
    expect(updated.likeCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd blog-api && npx vitest run src/service/__tests__/comment.service.test.js`
Expected: FAIL — `Cannot find module '@/db/models'`.

- [ ] **Step 3: Rewrite `src/service/comment.service.js`**

```js
const prisma = require("@/db/prisma");
const likesService = require("@/service/like.service");
const emitter = require("@/utils/emitter");
const notificationService = require("@/service/notification.service");
const { serializeComment } = require("@/utils/serializers");

const USER_SELECT = {
  id: true, avatar: true, firstName: true, lastName: true, email: true, username: true, fullname: true,
};

class CommentService {
  async getAll() {
    return prisma.comment.findMany();
  }

  async getById(id) {
    return prisma.comment.findUnique({ where: { id }, include: { post: true } });
  }

  async getBySlug(slug) {
    const post = await prisma.post.findUnique({ where: { slug } });
    if (!post) return null;
    return prisma.comment.findMany({ where: { postId: post.id }, include: { post: true } });
  }

  async getAllCommentsInPost(postId, currentUser) {
    const comments = await prisma.comment.findMany({
      where: { postId, deletedAt: null, parentId: null },
      include: { user: { select: USER_SELECT } },
    });

    const replies = await prisma.comment.findMany({
      where: { postId, deletedAt: null, parentId: { not: null } },
      include: { user: { select: USER_SELECT } },
    });

    const replyMap = {};
    replies.forEach((r) => {
      if (!replyMap[r.parentId]) replyMap[r.parentId] = [];
      replyMap[r.parentId].push(r);
    });

    const commentsWithReplies = comments.map((c) => ({
      ...c,
      replies: replyMap[c.id] || [],
    }));

    return this.likeCommentFlags(commentsWithReplies, currentUser);
  }

  likeCommentFlags = async (comments, currentUser) => {
    const allComments = [];
    comments.forEach((comment) => {
      allComments.push(comment);
      if (comment.replies && comment.replies.length > 0) {
        allComments.push(...comment.replies);
      }
    });

    let currentUserLikes = new Set();
    if (currentUser) {
      const commentIds = allComments.map((c) => c.id);
      const likes = await likesService.getAll("Comment", commentIds);
      likes.forEach((like) => {
        if (like.userId === currentUser.id) {
          currentUserLikes.add(like.likeableId);
        }
      });
    }

    return comments.map((comment) => {
      const withFlag = {
        ...comment,
        is_like: currentUserLikes.has(comment.id),
      };
      if (withFlag.replies && withFlag.replies.length > 0) {
        withFlag.replies = withFlag.replies.map((reply) => ({
          ...reply,
          is_like: currentUserLikes.has(reply.id),
        }));
      }
      return serializeComment(withFlag);
    });
  };

  async toggleLike(currentUser, commentId) {
    if (!currentUser)
      throw new Error("You must be logged in to like this post.");

    const existing = await prisma.like.findFirst({
      where: { likeableId: commentId, userId: currentUser.id, likeableType: "Comment" },
    });

    const comment = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment) throw new Error("Comment not found");

    if (existing) {
      await prisma.like.delete({ where: { id: existing.id } });
      await prisma.comment.update({
        where: { id: commentId },
        data: { likeCount: Math.max(0, comment.likeCount - 1) },
      });
      return false;
    }

    await prisma.like.create({
      data: { likeableId: commentId, userId: currentUser.id, likeableType: "Comment" },
    });
    await prisma.comment.update({
      where: { id: commentId },
      data: { likeCount: comment.likeCount + 1 },
    });
    return true;
  }

  async create(currentUser, data) {
    if (!currentUser) throw new Error("Bạn phải đăng nhập để comment");

    let parentId = data.parent_id || null;
    let currentPost = null;

    try {
      currentPost = await prisma.post.findUnique({ where: { id: data.post_id } });
      if (currentPost) {
        const userPost = await prisma.user.findUnique({
          where: { id: currentPost.userId },
          include: { setting: true },
        });
        const settings = userPost?.setting?.data || {};

        if (settings.allowComments === false) {
          throw new Error("Bạn không thể comment bài post này");
        }
      }
    } catch (error) {
      throw new Error(error.message);
    }

    if (parentId) {
      const parentComment = await prisma.comment.findUnique({ where: { id: parentId } });
      if (!parentComment) throw new Error("Parent not found");
      if (parentComment.parentId) {
        parentId = parentComment.parentId;
      }
    }

    const comment = await prisma.comment.create({
      data: {
        postId: data.post_id,
        content: data.content,
        parentId,
        userId: currentUser.id,
      },
    });

    const populated = await prisma.comment.findUnique({
      where: { id: comment.id },
      include: { user: { select: USER_SELECT } },
    });

    const result = serializeComment({ ...populated, replies: [] });

    try {
      if (currentPost) {
        const userPost = await prisma.user.findUnique({
          where: { id: currentPost.userId },
          include: { setting: true },
        });
        const settings = userPost?.setting?.data || {};
        if (userPost.id !== currentUser.id && settings.emailNewComments) {
          await prisma.queue.create({
            data: {
              type: "sendNewCommentJob",
              payload: {
                userPostId: userPost.id,
                userCommetnId: currentUser.id,
                content: data.content,
                post: currentPost,
              },
            },
          });
        }

        if (userPost.id !== currentUser.id) {
          const commenterName =
            currentUser.fullname ||
            [currentUser.firstName, currentUser.lastName].filter(Boolean).join(" ") ||
            currentUser.username;
          const notifTitle = parentId
            ? `${commenterName} đã trả lời bình luận trong bài viết của bạn`
            : `${commenterName} đã bình luận về bài viết của bạn`;
          const notif = await notificationService.create({
            userId: userPost.id,
            type: "comment",
            title: notifTitle,
            notifiableType: "Post",
            notifiableId: currentPost.id,
            messageLink: `/blog/${currentPost.slug}`,
          });
          emitter.emit("notification:post_comment", {
            toUserId: userPost.id,
            notification: notif,
          });
        }
      }
    } catch (error) {
      console.log(error);
    }

    if (data.parent_id) {
      try {
        const parentComment = await prisma.comment.findUnique({
          where: { id: data.parent_id },
          include: { user: { select: { id: true, fullname: true, firstName: true, lastName: true, username: true } } },
        });
        if (parentComment?.user) {
          const parentAuthorId = parentComment.user.id;
          const postAuthorId = currentPost?.userId || "";
          if (parentAuthorId !== currentUser.id && parentAuthorId !== postAuthorId) {
            const commenterName =
              currentUser.fullname ||
              [currentUser.firstName, currentUser.lastName].filter(Boolean).join(" ") ||
              currentUser.username;
            const notif = await notificationService.create({
              userId: parentComment.user.id,
              type: "comment",
              title: `${commenterName} đã trả lời bình luận của bạn`,
              notifiableType: "Post",
              notifiableId: currentPost.id,
              messageLink: `/blog/${currentPost.slug}`,
            });
            emitter.emit("notification:post_comment", {
              toUserId: parentAuthorId,
              notification: notif,
            });
          }
        }
      } catch (err) {
        console.log("Reply notification error:", err);
      }
    }

    return result;
  }

  async update(id) {
    try {
      const comment = await prisma.comment.findUnique({ where: { id } });

      if (!comment) return null;
      if (comment.deletedAt) return null;

      return prisma.comment.update({ where: { id }, data: { deletedAt: new Date() } });
    } catch (error) {
      console.log("Lỗi khi update:", error);
      return null;
    }
  }

  async remove(id) {
    await prisma.comment.delete({ where: { id } });
    return null;
  }
}

module.exports = new CommentService();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd blog-api && npx vitest run src/service/__tests__/comment.service.test.js`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
cd blog-api
git add -A
git commit -m "feat: port comment.service to Prisma"
```

---

## Task 12: Messenger service

**Files:**
- Modify: `blog-api/src/service/messenger.service.js`
- Test: `blog-api/src/service/__tests__/messenger.service.test.js`

**Interfaces:**
- Consumes: `prisma`, `createUser`, `resetDb`, `serializeUser` (Task 2).
- Produces: same method names as before (`getConversations`, `getMessages`, `sendMessage`, `getOrCreateDirect`).

- [ ] **Step 1: Write the failing test**

```js
const { describe, it, expect, beforeEach, afterAll } = require("vitest");
const prisma = require("@/db/prisma");
const { resetDb } = require("@/test/resetDb");
const { createUser } = require("@/test/factories");
const messengerService = require("@/service/messenger.service");

describe("messenger.service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("getOrCreateDirect creates a 2-member conversation once, reuses it on the second call", async () => {
    const alice = await createUser({ username: "alice" });
    const bob = await createUser({ username: "bob" });

    const first = await messengerService.getOrCreateDirect(alice, bob.id);
    expect(first.members).toHaveLength(2);

    const second = await messengerService.getOrCreateDirect(alice, bob.id);
    expect(second.id).toBe(first.id);
  });

  it("sendMessage requires membership and updates last_message_at", async () => {
    const alice = await createUser({ username: "alice" });
    const bob = await createUser({ username: "bob" });
    const outsider = await createUser({ username: "carol" });
    const conv = await messengerService.getOrCreateDirect(alice, bob.id);

    const msg = await messengerService.sendMessage(conv.id, alice, "hi bob");
    expect(msg.content).toBe("hi bob");
    expect(msg.user.id).toBe(alice.id);

    await expect(messengerService.sendMessage(conv.id, outsider, "hi")).rejects.toThrow("Conversation not found");
  });

  it("getMessages returns messages ordered oldest-first with a flat user", async () => {
    const alice = await createUser({ username: "alice" });
    const bob = await createUser({ username: "bob" });
    const conv = await messengerService.getOrCreateDirect(alice, bob.id);
    await messengerService.sendMessage(conv.id, alice, "first");
    await messengerService.sendMessage(conv.id, bob, "second");

    const messages = await messengerService.getMessages(conv.id, alice);

    expect(messages.map((m) => m.content)).toEqual(["first", "second"]);
    expect(messages[1].user.username).toBe("bob");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd blog-api && npx vitest run src/service/__tests__/messenger.service.test.js`
Expected: FAIL — `Cannot find module '@/db/models'`.

- [ ] **Step 3: Rewrite `src/service/messenger.service.js`**

```js
const prisma = require("@/db/prisma");
const { serializeUser } = require("@/utils/serializers");

const USER_SELECT = { id: true, avatar: true, username: true, fullname: true, firstName: true, lastName: true };

class MessengerService {
  async getConversations(currentUser) {
    const conversations = await prisma.conversation.findMany({
      where: { members: { some: { id: currentUser.id } } },
      include: { members: { select: USER_SELECT } },
      orderBy: { lastMessageAt: "desc" },
    });

    return Promise.all(
      conversations.map(async (conv) => {
        const lastMsg = await prisma.message.findFirst({
          where: { conversationId: conv.id, deletedAt: null },
          include: { user: { select: USER_SELECT } },
          orderBy: { createdAt: "desc" },
        });

        return {
          id: conv.id,
          name: conv.name,
          avatar: conv.avatar,
          last_message_at: conv.lastMessageAt,
          members: conv.members.map(serializeUser),
          last_message: lastMsg
            ? { id: lastMsg.id, content: lastMsg.content, createdAt: lastMsg.createdAt, user: serializeUser(lastMsg.user) }
            : null,
        };
      })
    );
  }

  async getMessages(conversationId, currentUser) {
    const conv = await prisma.conversation.findFirst({
      where: { id: conversationId, members: { some: { id: currentUser.id } } },
    });
    if (!conv) throw new Error("Conversation not found");

    const messages = await prisma.message.findMany({
      where: { conversationId, deletedAt: null },
      include: { user: { select: USER_SELECT } },
      orderBy: { createdAt: "asc" },
    });

    return messages.map((m) => ({
      id: m.id,
      content: m.content,
      type: m.type,
      createdAt: m.createdAt,
      user: serializeUser(m.user),
    }));
  }

  async sendMessage(conversationId, currentUser, content) {
    const conv = await prisma.conversation.findFirst({
      where: { id: conversationId, members: { some: { id: currentUser.id } } },
    });
    if (!conv) throw new Error("Conversation not found");

    const message = await prisma.message.create({
      data: { conversationId, userId: currentUser.id, type: "text", content },
    });

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });

    const populated = await prisma.message.findUnique({
      where: { id: message.id },
      include: { user: { select: USER_SELECT } },
    });

    return {
      id: populated.id,
      content: populated.content,
      type: populated.type,
      createdAt: populated.createdAt,
      user: serializeUser(populated.user),
    };
  }

  async getOrCreateDirect(currentUser, targetUserId) {
    const existing = await prisma.conversation.findFirst({
      where: {
        AND: [
          { members: { some: { id: currentUser.id } } },
          { members: { some: { id: targetUserId } } },
          { members: { every: { id: { in: [currentUser.id, targetUserId] } } } },
        ],
      },
      include: { members: { select: USER_SELECT } },
    });

    if (existing) {
      return {
        id: existing.id,
        name: existing.name,
        avatar: existing.avatar,
        last_message_at: existing.lastMessageAt,
        members: existing.members.map(serializeUser),
      };
    }

    const conv = await prisma.conversation.create({
      data: {
        createdBy: currentUser.id,
        lastMessageAt: new Date(),
        members: { connect: [{ id: currentUser.id }, { id: targetUserId }] },
      },
    });

    const populated = await prisma.conversation.findUnique({
      where: { id: conv.id },
      include: { members: { select: USER_SELECT } },
    });

    return {
      id: populated.id,
      name: populated.name,
      avatar: populated.avatar,
      last_message_at: populated.lastMessageAt,
      members: populated.members.map(serializeUser),
    };
  }
}

module.exports = new MessengerService();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd blog-api && npx vitest run src/service/__tests__/messenger.service.test.js`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
cd blog-api
git add -A
git commit -m "feat: port messenger.service to Prisma"
```

---

## Task 13: Auth service, checkAuth/optionalAuth, socket layer

**Files:**
- Modify: `blog-api/src/service/auth.service.js`
- Modify: `blog-api/src/controllers/auth.controller.js` (`me` handler serializes; register's direct `Queue.create` uses Prisma)
- Modify: `blog-api/src/middlewares/checkAuth.js`
- Modify: `blog-api/src/middlewares/optionalAuth.js`
- Modify: `blog-api/src/socket/index.js`
- Test: `blog-api/src/service/__tests__/auth.service.test.js`

**Interfaces:**
- Consumes: `prisma`, `createUser`, `resetDb`, `refreshTokenService` (Task 3), `serializeUser` (Task 2).
- Produces: same method names as before on `auth.service.js`. `req.user` (attached by `checkAuth`/`optionalAuth`) is now a Prisma `User` row (with `.setting` included) instead of a Mongoose document — every controller that reads `req.user.id`/`.username`/etc. already works since Prisma rows expose plain properties the same way.

- [ ] **Step 1: Write the failing test**

```js
const { describe, it, expect, beforeEach, afterAll } = require("vitest");
const prisma = require("@/db/prisma");
const { resetDb } = require("@/test/resetDb");
const { createUser } = require("@/test/factories");
const { hash } = require("@/utils/bcrypt");
const authService = require("@/service/auth.service");

describe("auth.service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("register maps first_name/last_name and hashes the password", async () => {
    const { userId, token } = await authService.register({
      first_name: "Alice",
      last_name: "Nguyen",
      email: "alice@example.com",
      password: "Password1",
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user.firstName).toBe("Alice");
    expect(user.password).not.toBe("Password1");
    expect(token.token).toBeTruthy();
  });

  it("login returns a token plus a refresh_token for correct credentials", async () => {
    await createUser({ email: "bob@example.com", password: await hash("Password1") });

    const result = await authService.login({ email: "bob@example.com", password: "Password1" });

    expect(result.token).toBeTruthy();
    expect(result.refresh_token).toBeTruthy();
  });

  it("login rejects a wrong password", async () => {
    await createUser({ email: "carol@example.com", password: await hash("Password1") });
    await expect(
      authService.login({ email: "carol@example.com", password: "wrong" })
    ).rejects.toThrow("Thông tin đăng nhập không hợp lệ");
  });

  it("refreshAccessToken rotates the refresh token", async () => {
    const user = await createUser();
    const refreshTokenService = require("@/service/refreshToken.service");
    const rt = await refreshTokenService.createRefreshToken(user.id);

    const result = await authService.refreshAccessToken(rt.token);

    expect(result.refresh_token).not.toBe(rt.token);
    const oldToken = await prisma.refreshToken.findUnique({ where: { id: rt.id } });
    expect(oldToken).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd blog-api && npx vitest run src/service/__tests__/auth.service.test.js`
Expected: FAIL — `Cannot find module '@/db/models'`.

- [ ] **Step 3: Rewrite `src/service/auth.service.js`**

```js
const prisma = require("@/db/prisma");
const { hash, compare } = require("@/utils/bcrypt");
const jwtService = require("@/service/jwt.service");
const refreshTokenService = require("@/service/refreshToken.service");

const register = async (data) => {
  const user = await prisma.user.create({
    data: {
      email: data.email,
      firstName: data.first_name,
      lastName: data.last_name,
      password: await hash(data.password),
    },
  });

  const userId = user.id;
  const token = jwtService.generateAccessToken(userId);
  return { userId, token };
};

const login = async ({ email, password }) => {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    throw new Error("Thông tin đăng nhập không hợp lệ");
  }

  const isValid = await compare(password, user.password);
  if (!isValid) {
    throw new Error("Thông tin đăng nhập không hợp lệ");
  }

  const tokenData = jwtService.generateAccessToken(user.id);
  const refreshToken = await refreshTokenService.createRefreshToken(user.id);
  return {
    ...tokenData,
    refresh_token: refreshToken.token,
  };
};

const getProfile = async (fullname) => {
  const [firstName, ...rest] = fullname.split(" ");
  const lastName = rest.join(" ");

  const user = await prisma.user.findFirst({
    where: {
      firstName: { contains: firstName, mode: "insensitive" },
      lastName: { contains: lastName, mode: "insensitive" },
    },
  });

  if (!user) {
    const error = new Error("Không tìm thấy người dùng");
    error.status = 404;
    throw error;
  }

  const { password, twoFactorSecret, ...safeUser } = user;
  return safeUser;
};

const forGotPassWord = async (email) => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new Error("Không tìm thấy người dùng với email này");
  }

  await prisma.user.update({ where: { id: user.id }, data: { verifiedAt: null } });
  await prisma.queue.create({
    data: { type: "sendVerifyEmailJob", payload: { userId: user.id } },
  });
};

const resetPassword = async (data, currentUser) => {
  if (currentUser && currentUser.id) {
    const userWithPassword = await prisma.user.findUnique({ where: { id: currentUser.id } });

    if (!userWithPassword || !userWithPassword.password) {
      throw new Error("Không thể tìm thấy mật khẩu người dùng để so sánh.");
    }

    if (!data.currentPassword) {
      throw new Error("Vui lòng nhập mật khẩu hiện tại.");
    }

    const isValid = await compare(data.currentPassword, userWithPassword.password);
    if (!isValid) {
      throw new Error("Mật khẩu hiện tại bạn đã nhập không đúng.");
    }

    const isSameAsOld = await compare(data.newPassword, userWithPassword.password);
    if (isSameAsOld) {
      throw new Error("Vui lòng chọn mật khẩu khác với mật khẩu hiện tại.");
    }

    await prisma.user.update({
      where: { id: currentUser.id },
      data: { password: await hash(data.newPassword) },
    });
    return;
  }

  const { userId, password } = data;
  if (!userId || !password) {
    throw new Error("userID or password is missing");
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new Error("Invalid user");
  }

  await prisma.user.update({ where: { id: userId }, data: { password: await hash(password) } });
};

const verifyEmail = async (token) => {
  try {
    const { userId } = jwtService.verifyAccessToken(token, process.env.MAIL_JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new Error("User không tồn tại");
    }
    if (user.verifiedAt) {
      return "verified";
    }
    await prisma.user.update({ where: { id: userId }, data: { verifiedAt: new Date() } });
  } catch (error) {
    throw new Error(error);
  }
};

const verifyToken = async (token) => {
  try {
    return jwtService.verifyAccessToken(token, process.env.MAIL_JWT_SECRET);
  } catch (error) {
    throw new Error(error);
  }
};

const refreshAccessToken = async (refreshTokenString) => {
  const refreshToken = await refreshTokenService.findValidRefreshToken(refreshTokenString);
  if (!refreshToken) {
    throw new Error("Refresh token không hợp lệ");
  }

  const tokenData = jwtService.generateAccessToken(refreshToken.userId);
  await refreshTokenService.deleteRefreshToken(refreshToken);

  const newRefreshToken = await refreshTokenService.createRefreshToken(refreshToken.userId);

  return {
    ...tokenData,
    refresh_token: newRefreshToken.token,
  };
};

module.exports = {
  register,
  login,
  getProfile,
  forGotPassWord,
  resetPassword,
  verifyEmail,
  verifyToken,
  refreshAccessToken,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd blog-api && npx vitest run src/service/__tests__/auth.service.test.js`
Expected: 4 passed.

- [ ] **Step 5: Update `src/controllers/auth.controller.js`**

```js
const response = require("@/utils/response");
const authService = require("@/service/auth.service");
const prisma = require("@/db/prisma");
const { serializeUser } = require("@/utils/serializers");

const register = async (req, res) => {
  try {
    const { userId, token } = await authService.register(req.body);

    await prisma.queue.create({
      data: { type: "sendVerifyEmailJob", payload: { userId } },
    });

    response.succsess(res, 200, token);
  } catch (error) {
    response.error(res, 400, error.message);
  }
};

const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    const userData = await authService.login({ email, password });

    return response.succsess(res, 200, userData);
  } catch (error) {
    response.error(res, 401, error.message);
  }
};

const me = async (req, res) => {
  try {
    if (!req.user) {
      return response.error(res, 401, "Token invalid");
    }

    return response.succsess(res, 200, serializeUser(req.user));
  } catch (error) {
    return response.error(res, 500, "Internal server error");
  }
};
const refreshToken = async (req, res) => {
  try {
    const tokenData = await authService.refreshAccessToken(
      req.body.refresh_token
    );
    response.succsess(res, 200, tokenData);
  } catch (error) {
    response.error(res, 403, error.message);
  }
};

const verifyEmail = async (req, res) => {
  try {
    const check = await authService.verifyEmail(req.body.email);
    if (check === "verified") {
      return res.json({
        status: true,
      });
    }
    res.status(201).send("");
  } catch (error) {
    throw new Error("Token không tồn tại");
  }
};

const verifyToken = async (req, res) => {
  try {
    const verify = await authService.verifyToken(req.body.token);
    res.status(201).json({
      data: verify,
    });
  } catch (error) {
    throw new Error("Token không tồn tại");
  }
};
const forGotPassWord = async (req, res) => {
  try {
    await authService.forGotPassWord(req.body.email);
    res.status(201).send("");
  } catch (error) {
    throw new Error("Email không tồn tại");
  }
};

const resetPassword = async (req, res) => {
  try {
    await authService.resetPassword(req.body, req.user);
    res.status(201).send("");
  } catch (error) {
    response.error(res, 400, error.message);
  }
};

module.exports = {
  register,
  login,
  me,
  verifyEmail,
  verifyToken,
  forGotPassWord,
  resetPassword,
  refreshToken,
};
```

- [ ] **Step 6: Update `src/middlewares/checkAuth.js`**

```js
const response = require("@/utils/response");
const prisma = require("@/db/prisma");
const jwtService = require("@/service/jwt.service");

async function checkAuth(req, res, next) {
  try {
    const token = req.headers?.authorization?.replace("Bearer ", "");

    if (!token) {
      return response.error(res, 401, "Token không được cung cấp");
    }

    const payload = jwtService.verifyAccessToken(token);

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { setting: true },
    });

    if (!user) {
      return response.error(res, 401, "User không tồn tại");
    }

    req.user = user;
    next();
  } catch (error) {
    return response.error(res, 401, "Token không hợp lệ");
  }
}

module.exports = checkAuth;
```

- [ ] **Step 7: Update `src/middlewares/optionalAuth.js`**

```js
const prisma = require("@/db/prisma");
const jwtService = require("@/service/jwt.service");

async function optionalAuth(req, res, next) {
  try {
    const token = req.headers?.authorization?.replace("Bearer ", "");
    if (!token) return next();

    const payload = jwtService.verifyAccessToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { setting: true },
    });
    if (user) req.user = user;
  } catch {
    // token invalid — proceed as guest
  }
  next();
}

module.exports = optionalAuth;
```

- [ ] **Step 8: Update `src/socket/index.js`**

```js
const jwtService = require("@/service/jwt.service");
const prisma = require("@/db/prisma");
const messengerService = require("@/service/messenger.service");
const emitter = require("@/utils/emitter");

module.exports = (io) => {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("No token"));

      const payload = jwtService.verifyAccessToken(token);
      const user = await prisma.user.findUnique({ where: { id: payload.userId } });
      if (!user) return next(new Error("User not found"));

      socket.user = user;
      next();
    } catch {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.user.username} (${socket.id})`);

    socket.join(`user:${socket.user.id}`);

    socket.on("join_conversation", (conversationId) => {
      socket.join(`conv:${conversationId}`);
    });

    socket.on("leave_conversation", (conversationId) => {
      socket.leave(`conv:${conversationId}`);
    });

    socket.on("send_message", async ({ conversationId, content }, callback) => {
      try {
        if (!content?.trim()) return;

        const message = await messengerService.sendMessage(
          conversationId,
          socket.user,
          content.trim()
        );

        const payload = { conversationId, message };

        io.to(`conv:${conversationId}`).emit("new_message", payload);

        io.to(`conv:${conversationId}`).emit("conversation_updated", {
          conversationId,
          last_message: message,
          last_message_at: message.createdAt,
        });

        const conv = await prisma.conversation.findUnique({
          where: { id: conversationId },
          include: { members: { select: { id: true } } },
        });

        if (conv?.members) {
          const sender = {
            id: socket.user.id,
            username: socket.user.username,
            fullname: socket.user.fullname,
            first_name: socket.user.firstName,
            last_name: socket.user.lastName,
            avatar: socket.user.avatar,
          };
          conv.members.forEach((member) => {
            if (member.id !== socket.user.id) {
              io.to(`user:${member.id}`).emit("notification:new_message", {
                conversationId,
                message,
                sender,
              });
            }
          });
        }

        if (callback) callback({ ok: true, message });
      } catch (err) {
        if (callback) callback({ ok: false, error: err.message });
      }
    });

    socket.on("typing", ({ conversationId }) => {
      socket.to(`conv:${conversationId}`).emit("user_typing", {
        conversationId,
        user: {
          id: socket.user.id,
          username: socket.user.username,
          fullname: socket.user.fullname,
          first_name: socket.user.firstName,
          last_name: socket.user.lastName,
        },
      });
    });

    socket.on("stop_typing", ({ conversationId }) => {
      socket.to(`conv:${conversationId}`).emit("user_stop_typing", {
        conversationId,
        userId: socket.user.id,
      });
    });

    socket.on("disconnect", () => {
      console.log(`Socket disconnected: ${socket.user.username}`);
    });
  });

  const forwardNotif = ({ toUserId, notification }) => {
    io.to(`user:${toUserId}`).emit("notification:new", notification);
  };
  emitter.on("notification:follow", forwardNotif);
  emitter.on("notification:post_like", forwardNotif);
  emitter.on("notification:post_comment", forwardNotif);
};
```

- [ ] **Step 9: Boot the server manually and confirm it starts (no automated test — this is the first point since Task 1 the whole app can run)**

Run: `cd blog-api && node server.js`
Expected: prints `Server running on port 3000` with no `Cannot find module` errors. Stop it with Ctrl+C once confirmed.

- [ ] **Step 10: Commit**

```bash
cd blog-api
git add -A
git commit -m "feat: port auth.service, checkAuth/optionalAuth, and socket layer to Prisma; server boots again"
```

---

## Task 14: Seed script

**Files:**
- Modify: `blog-api/src/db/seed.js`

**Interfaces:**
- Consumes: `prisma`, `topicsService`/`bcrypt`/`slugify`/`faker` (all unchanged).
- Produces: same console output shape and same rough data volume as before (3 users, 5 topics, 8 tags, 15 posts, comments+replies, likes, bookmarks, follows, 1 conversation + 3 messages).

- [ ] **Step 1: Rewrite `src/db/seed.js`**

No automated test for this file — it's a one-shot data-seeding script, run and eyeballed like before (it wasn't unit-tested previously either).

```js
require("module-alias/register");
require("dotenv").config();

const bcrypt = require("bcrypt");
const slugify = require("slugify");
const { faker } = require("@faker-js/faker");
const prisma = require("@/db/prisma");

const TOPICS = [
  { name: "Technology", slug: "technology" },
  { name: "Lifestyle", slug: "lifestyle" },
  { name: "Programming", slug: "programming" },
  { name: "Design", slug: "design" },
  { name: "Career", slug: "career" },
];

const thumbUrl = (i) => `uploads/thumbnails/${(i % 10) + 1}.svg`;

const TAGS = ["javascript", "nodejs", "react", "postgresql", "css", "ux", "tips", "tools"];

const POST_TITLES = [
  "Getting Started with PostgreSQL and Prisma",
  "10 JavaScript Tips You Probably Didn't Know",
  "Building a REST API with Express and Node.js",
  "How to Design a Clean UI from Scratch",
  "My Journey from Junior to Senior Developer",
  "React Hooks: A Complete Guide for Beginners",
  "Why I Switched from MongoDB to PostgreSQL",
  "CSS Grid vs Flexbox: When to Use Which",
  "How I Manage My Time as a Freelance Developer",
  "Understanding Async/Await in JavaScript",
  "5 VS Code Extensions That Changed My Workflow",
  "The Art of Writing Clean Code",
  "Setting Up CI/CD for Your Node.js App",
  "Lessons Learned After 3 Years of Full-Stack Dev",
  "Prisma Migrations: A Practical Guide",
];

function makeSlug(title, idx) {
  return slugify(title, { lower: true, strict: true }) + (idx > 0 ? `-${idx}` : "");
}

function makeContent(title) {
  const paragraphs = Array.from({ length: faker.number.int({ min: 3, max: 6 }) }, () =>
    `<p>${faker.lorem.paragraph(faker.number.int({ min: 3, max: 7 }))}</p>`
  );
  return `<h1>${title}</h1>\n${paragraphs.join("\n")}`;
}

async function seed() {
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.queue.deleteMany();
  await prisma.bookmark.deleteMany();
  await prisma.follow.deleteMany();
  await prisma.like.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.post.deleteMany();
  await prisma.userSetting.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.topic.deleteMany();
  await prisma.user.deleteMany();
  console.log("Cleared all tables");

  const passwordHash = await bcrypt.hash("123456", 10);

  const users = await Promise.all([
    prisma.user.create({
      data: {
        firstName: "Alice", lastName: "Nguyen", email: "alice@example.com",
        username: "alice", fullname: "Alice Nguyen", password: passwordHash,
        avatar: `https://i.pravatar.cc/150?u=alice`, verifiedAt: new Date(),
        title: "Full-Stack Developer", about: faker.lorem.sentences(2),
      },
    }),
    prisma.user.create({
      data: {
        firstName: "Bob", lastName: "Tran", email: "bob@example.com",
        username: "bob", fullname: "Bob Tran", password: passwordHash,
        avatar: `https://i.pravatar.cc/150?u=bob`, verifiedAt: new Date(),
        title: "UI/UX Designer", about: faker.lorem.sentences(2),
      },
    }),
    prisma.user.create({
      data: {
        firstName: "Carol", lastName: "Le", email: "carol@example.com",
        username: "carol", fullname: "Carol Le", password: passwordHash,
        avatar: `https://i.pravatar.cc/150?u=carol`, verifiedAt: new Date(),
        title: "Backend Engineer", about: faker.lorem.sentences(2),
      },
    }),
  ]);
  console.log(`Created ${users.length} users`);

  const topics = await Promise.all(
    TOPICS.map((t, i) =>
      prisma.topic.create({
        data: { ...t, image: thumbUrl(i), description: faker.lorem.sentence(), postsCount: 0 },
      })
    )
  );
  console.log(`Created ${topics.length} topics`);

  const tags = await Promise.all(TAGS.map((name) => prisma.tag.create({ data: { name } })));
  console.log(`Created ${tags.length} tags`);

  const usedSlugs = new Set();
  const posts = [];
  for (let i = 0; i < POST_TITLES.length; i++) {
    const title = POST_TITLES[i];
    let slug = makeSlug(title, 0);
    let counter = 1;
    while (usedSlugs.has(slug)) slug = makeSlug(title, counter++);
    usedSlugs.add(slug);

    const author = users[i % users.length];
    const postTopics = faker.helpers.arrayElements(topics, faker.number.int({ min: 1, max: 2 }));
    const postTags = faker.helpers.arrayElements(tags, faker.number.int({ min: 1, max: 3 }));

    const post = await prisma.post.create({
      data: {
        userId: author.id,
        title,
        slug,
        description: faker.lorem.sentences(2),
        content: makeContent(title),
        thumbnail: thumbUrl(i),
        status: "published",
        visibility: "public",
        publishedAt: faker.date.recent({ days: 30 }),
        viewsCount: faker.number.int({ min: 50, max: 2000 }),
        likesCount: 0,
        topics: { connect: postTopics.map((t) => ({ id: t.id })) },
        tags: { connect: postTags.map((t) => ({ id: t.id })) },
      },
    });
    posts.push(post);
  }
  console.log(`Created ${posts.length} posts`);

  for (const user of users) {
    const count = posts.filter((p) => p.userId === user.id).length;
    await prisma.user.update({ where: { id: user.id }, data: { postsCount: count } });
  }
  for (const topic of topics) {
    const count = await prisma.post.count({ where: { topics: { some: { id: topic.id } } } });
    await prisma.topic.update({ where: { id: topic.id }, data: { postsCount: count } });
  }

  const comments = [];
  for (const post of posts.slice(0, 8)) {
    const commenters = faker.helpers.arrayElements(users, faker.number.int({ min: 1, max: 3 }));
    for (const commenter of commenters) {
      const comment = await prisma.comment.create({
        data: {
          userId: commenter.id,
          postId: post.id,
          content: faker.lorem.sentences(faker.number.int({ min: 1, max: 3 })),
          likeCount: faker.number.int({ min: 0, max: 10 }),
        },
      });
      comments.push(comment);
    }
  }
  console.log(`Created ${comments.length} comments`);

  let replyCount = 0;
  for (const comment of comments.slice(0, 5)) {
    const replier = users[faker.number.int({ min: 0, max: users.length - 1 })];
    await prisma.comment.create({
      data: {
        userId: replier.id,
        postId: comment.postId,
        parentId: comment.id,
        content: faker.lorem.sentence(),
      },
    });
    replyCount += 1;
  }
  console.log(`Created ${replyCount} replies`);

  let likeCount = 0;
  for (const post of posts) {
    const likers = faker.helpers.arrayElements(users, faker.number.int({ min: 0, max: users.length }));
    for (const liker of likers) {
      await prisma.like.create({
        data: { userId: liker.id, likeableType: "Post", likeableId: post.id },
      }).catch(() => {});
      likeCount += 1;
    }
    await prisma.post.update({
      where: { id: post.id },
      data: { likesCount: likers.length },
    });
    await prisma.user.update({
      where: { id: post.userId },
      data: { likesCount: { increment: likers.length } },
    });
  }
  console.log(`Created ${likeCount} likes`);

  for (const user of users) {
    const saved = faker.helpers.arrayElements(posts, faker.number.int({ min: 1, max: 4 }));
    for (const post of saved) {
      await prisma.bookmark.create({ data: { userId: user.id, postId: post.id } }).catch(() => {});
    }
  }
  console.log("Created bookmarks");

  await prisma.follow.create({ data: { followerId: users[0].id, followingId: users[1].id } });
  await prisma.follow.create({ data: { followerId: users[1].id, followingId: users[2].id } });
  await prisma.follow.create({ data: { followerId: users[2].id, followingId: users[0].id } });
  for (const user of users) {
    await prisma.user.update({ where: { id: user.id }, data: { followingCount: 1, followerCount: 1 } });
  }
  console.log("Created follows");

  const conv = await prisma.conversation.create({
    data: {
      name: "Alice & Bob",
      createdBy: users[0].id,
      lastMessageAt: new Date(),
      members: { connect: [{ id: users[0].id }, { id: users[1].id }] },
    },
  });
  await prisma.message.create({ data: { userId: users[0].id, conversationId: conv.id, content: "Hey, check out my new post!" } });
  await prisma.message.create({ data: { userId: users[1].id, conversationId: conv.id, content: "Looks great, very well written!" } });
  await prisma.message.create({ data: { userId: users[0].id, conversationId: conv.id, content: "Thanks! Working on part 2 now." } });
  console.log("Created conversation & messages");

  console.log("\n✅ Seed xong!");
  console.log("─────────────────────────────");
  console.log(`👤 Users   : ${users.length} (password: 123456)`);
  console.log(`📝 Posts   : ${posts.length}`);
  console.log(`💬 Comments: ${comments.length + replyCount}`);
  console.log(`❤️  Likes   : ${likeCount}`);
  console.log(`🏷  Topics  : ${topics.length}`);
  console.log(`🔖 Tags    : ${tags.length}`);
  console.log("─────────────────────────────");
  users.forEach((u) => console.log(`  ${u.email}  /  123456`));

  await prisma.$disconnect();
}

seed().catch((err) => {
  console.error("Seed error:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it against the dev database**

Run: `cd blog-api && npm run seed`
Expected: prints the same summary block as before, exits 0.

- [ ] **Step 3: Commit**

```bash
cd blog-api
git add -A
git commit -m "feat: port seed.js to Prisma"
```

---

## Task 15: Frontend cleanup + end-to-end smoke test

**Files:**
- Modify: `blog-ui/src/components/ChatWindow/ChatWindow.jsx`
- Modify: `blog-ui/src/pages/DirectMessages/DirectMessages.jsx`
- Modify: `blog-ui/src/pages/Profile/Profile.jsx`
- Modify: `blog-ui/src/pages/Topic/Topic.jsx`
- Modify: `blog-ui/src/pages/FollowingFeed/FollowingFeed.jsx`
- Modify: `blog-ui/src/pages/Search/Search.jsx`

No test framework exists in `blog-ui` either (per CLAUDE.md, only `npm run lint`); these are purely mechanical simplifications since the API's ids are always present under `.id` now — no `_id` key is ever returned. Each edit below removes a now-always-false fallback branch; behavior is unchanged (the `||` already always resolved to the right-hand side once the API stopped returning `_id`).

**Interfaces:**
- Consumes: nothing new — no backend contract changes reach these files (Task 2's `serializeUser`/`serializePost`/`serializeComment` already preserve every field name these components read).

- [ ] **Step 1: `ChatWindow.jsx`** — replace `_id` fallbacks

Line 52: `if (cancelled || !conv?._id) return;` → `if (cancelled || !conv?.id) return;`
Line 54: `const cid = conv._id.toString();` → `const cid = conv.id;`
Line 82: `if (prev.some((m) => m._id === msg._id || m.id === msg.id)) return prev;` → `if (prev.some((m) => m.id === msg.id)) return prev;`
Line 124: `if (prev.some((m) => m._id === sent._id || m.id === sent.id)) return prev;` → `if (prev.some((m) => m.id === sent.id)) return prev;`
Line 147: `const sid = msg.user?._id?.toString() || msg.user?.id;` → `const sid = msg.user?.id;`
Line 224: `key={msg._id || msg.id || i}` → `key={msg.id || i}`

- [ ] **Step 2: `DirectMessages.jsx`** — replace `_id`/`.toString()` fallbacks

Every occurrence of `(c.id || c._id?.toString())`, `(conv.id || conv._id?.toString())`, `(m.id || m._id?.toString())`, `(u.id || u._id)`, `(targetUser.id || targetUser._id?.toString())`, `(me?._id || me?.id)?.toString()`, `msg.user?.id || msg.user?._id?.toString() || msg.user_id?.toString()` simplifies to just `.id` (or `myId = me?.id`). Concretely:
- Line 33: `const getPartner = (conv, myId) => conv.members?.find((m) => (m.id || m._id?.toString()) !== myId) || conv.members?.[0];` → `conv.members?.find((m) => m.id !== myId) || conv.members?.[0];`
- Line 67: `const myId = (me?._id || me?.id)?.toString();` → `const myId = me?.id;`
- Lines 84, 103-104, 109-110, 128, 187, 190, 199-200, 248, 255, 269, 287, 311, 332, 378, 426, 499-500, 505: drop the `._id`/`?.toString()` half of every `a || b` pair, keeping only the `.id` access.

- [ ] **Step 3: `Profile.jsx`** — replace `_id` fallbacks

Line 189: `if (!user?._id) return;` → `if (!user?.id) return;`
Line 197: `const result = await fn(user._id);` → `const result = await fn(user.id);`
Line 208: `await userService.toggleFollower(user?._id);` → `await userService.toggleFollower(user?.id);`
Line 551: `userId: user.id || user._id?.toString(),` → `userId: user.id,`

- [ ] **Step 4: `Topic.jsx`** — replace `_id` fallback

Line 63: `const res = await postService.getListTopicById(topic._id || topic.id);` → `const res = await postService.getListTopicById(topic.id);`

- [ ] **Step 5: `FollowingFeed.jsx`** — replace `_id` fallbacks

Line 25: `if (!me?._id && !me?.id) {` → `if (!me?.id) {`
Line 33: `const result = await userService.getFollowingList(me._id || me.id);` → `const result = await userService.getFollowingList(me.id);`
Line 42 (effect deps): `}, [me?._id, me?.id]);` → `}, [me?.id]);`
Line 78: `key={u.id || u._id}` → `key={u.id}`

- [ ] **Step 6: `Search.jsx`** — replace `_id` fallback

Line 98: `key={u.id || u._id}` → `key={u.id}`

- [ ] **Step 7: Lint check**

Run: `cd blog-ui && npm run lint`
Expected: no new warnings/errors introduced by these edits (repo already runs `--max-warnings 0`).

- [ ] **Step 8: Full end-to-end smoke test**

Run in three terminals:
```bash
cd blog-api && npm run seed
cd blog-api && node server.js
cd blog-ui && npm run dev
```
In the browser (http://localhost:5173):
1. Log in as `alice@example.com` / `123456`.
2. View the home feed — post cards show topics, like/view counts, author avatar and name.
3. Open a post, like it, bookmark it, leave a comment, reply to that comment, like the comment.
4. Visit `alice`'s profile — stats (posts/followers/following/likes) render, follow/unfollow bob works.
5. Open Direct Messages with bob, send a message, confirm it appears without a page reload (socket).
6. Visit a Topic page — post count and post list render.
7. Use the search bar for a user and a post title.
8. Log out, register a new account, confirm the verify-email job fires (check `blog-api` console / mail catcher) and the queue worker (`npm run queue` in a fourth terminal) moves the job to `completed`.

Expected: every flow above works with no console errors referencing `_id`, `undefined`, or Prisma "Unknown argument" errors.

- [ ] **Step 9: Commit**

```bash
cd blog-ui
git add -A
git commit -m "chore: drop dead Mongo _id fallbacks now that the API always returns id"
```

---

## Self-Review Notes

- **Spec coverage:** every section of the design spec (ORM choice, UUID ids, polymorphic Like/Notification kept simple, UserSetting promoted to a real table, dead scaffold deleted, big-bang rollout, casing-preservation rule, the two approved behavior changes, FE file list) has a corresponding task above.
- **Placeholder scan:** no task step says "add error handling" or "write tests for the above" without code — every step has literal file contents or literal shell commands.
- **Type/name consistency:** `prisma`, `resetDb`, `createUser`, `serializeUser`/`serializeTopic`/`serializeTag`/`serializePost`/`serializeComment` are defined once in Tasks 1–2 and referenced by the exact same names in every later task's Interfaces block and code.
- **Known scope boundary:** Tasks 4's `queueWorker.js`/`sendVerifyEmailJob.js` and Task 14's `seed.js` are explicitly called out as not having automated tests (self-invoking infinite loop / real email side effect / one-shot data script) — this mirrors their untested status before the migration, not a new gap introduced by it.
