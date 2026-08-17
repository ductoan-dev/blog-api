# Migration: MongoDB/Mongoose → PostgreSQL/Prisma

Date: 2026-08-17
Scope: `blog-api` (data layer rewrite) + targeted `blog-ui` updates.

## 1. Context

`CLAUDE.md` documents `blog-api` as Sequelize 6 + MySQL, but the code
actually running today uses MongoDB via Mongoose in all 13 wired models
(`src/db/models/*.model.js`, exported from `index.js`). `package.json` has
no `sequelize`/`mysql2` dependency at all.

Leftover from an earlier, abandoned relational-migration attempt:
`src/db/migrations/` (25 files), `src/db/seeders/` (16 files), `.sequelizerc`,
`src/config/database.js` (dialect `mysql`), and one orphaned Sequelize model
file `src/db/models/user_setting.model.js` — none of this is required by
`server.js`, `src/db/seed.js`, or `package.json` scripts. It's dead code,
useful only as a hint about previously-intended relational shape (explicit
join tables, a real `UserSetting` table).

Goal: replace Mongoose/MongoDB with Prisma/PostgreSQL as the data layer,
preserving current business logic and API response shapes wherever
practical, fixing one known counter-drift bug, and updating the specific
`blog-ui` files that depend on Mongo-specific id/populate shapes.

No production data exists to preserve — current MongoDB content is dev/seed
data. The new Postgres schema is seeded fresh; no data-migration script is
needed.

## 2. Decisions

- **ORM**: Prisma (`prisma` + `@prisma/client`, Postgres via the `postgresql`
  provider — Prisma manages its own `pg`-based driver).
- **IDs**: UUID string (`@id @default(uuid())`) on every model, not
  auto-increment integer. Preserves the current `id: string` API contract
  so most FE code (which already treats ids as strings, including
  `.id || ._id` fallback sites) needs no type changes — only the removal of
  now-unnecessary Mongo-shape fallbacks.
- **Legacy scaffold**: delete `src/db/migrations/`, `src/db/seeders/`,
  `.sequelizerc`, `src/config/database.js`, and
  `src/db/models/user_setting.model.js`. Replaced by `prisma/schema.prisma`
  and `prisma/migrations/`.
- **Rollout style**: big-bang replace, not incremental/dual-write. Justified
  because there's no real production data and no zero-downtime requirement
  (personal/dev project) — a parallel-run phase would add cost with no
  corresponding risk reduction here.

## 3. Schema (Prisma models)

Derived from the 13 live Mongoose schemas (see research below each model
for field-level source). All models get `id String @id @default(uuid())`
and `createdAt`/`updatedAt` (`@default(now())` / `@updatedAt`) unless noted.

- **User**: all scalar fields from `users.model.js` (names, email, password,
  2FA fields, username, fullname, avatar, title, about, denormalized
  counters `likesCount/postsCount/followerCount/followingCount`, profile
  fields, `badges Json?`, `coverImage`, `verifiedAt DateTime?`). Relation:
  `setting UserSetting?` (see below) replaces the old `settings Json` hack.
- **UserSetting** (new real table, replacing the `user.settings =
  { data: JSON.stringify(...) }` hack): `userId String @unique`, `data
  Json`. Service layer reads/writes `data` directly — no more manual
  `JSON.stringify`/`JSON.parse`.
- **Post**: `userId`, `title`, `thumbnail`, `description`, `metaTitle`,
  `metaDescription`, `content`, `slug String @unique`, `status String
  @default("draft")`, `visibility String @default("public")`,
  `viewsCount/likesCount Int @default(0)`, `publishedAt DateTime?`.
  Relations: `topics Topic[]` and `tags Tag[]` as implicit many-to-many
  (matches current embedded-array-of-refs behavior; `tags` stays wired in
  the schema but not actively used by any service, matching today's vestigial
  state — do not build new Tag-management features).
- **Comment**: `userId`, `postId`, `parentId String?` (self-relation),
  `content`, `likeCount Int @default(0)`, `deletedAt DateTime?`, `editedAt
  DateTime?`.
- **Like** (polymorphic, app-resolved — no DB-level FK for the polymorphic
  side, matching current Mongo behavior since Prisma can't target a
  variable model): `userId`, `likeableType String` (values `"Post"` |
  `"Comment"`, validated in service code, not a DB enum — matches current
  Mongoose enum-at-app-layer strictness), `likeableId String`, `@@unique([userId, likeableType, likeableId])`.
- **Tag**: `name String @unique`.
- **Topic**: `name`, `slug String @unique`, `image`, `description`,
  `postsCount Int @default(0)`.
- **Bookmark**: `userId`, `postId`, `@@unique([userId, postId])`.
- **Follow**: `followerId`, `followingId`, `@@unique([followerId,
  followingId])`.
- **Conversation**: `name`, `avatar`, `lastMessageAt DateTime?`,
  `createdBy String`. Relation: `members User[]` implicit many-to-many
  (matches current embedded array, no extra join-row fields needed today).
- **Message**: `userId`, `conversationId`, `type String @default("text")`,
  `content`, `deletedAt DateTime?`.
- **Notification** (polymorphic, app-resolved, single-recipient — keep this
  shape, do NOT adopt the old dead scaffold's fan-out `user_notification`
  join-table design; it changes behavior beyond what this migration should
  do): `userId String?`, `type`, `title`, `notifiableType String`,
  `notifiableId String`, `messageLink String?`, `readAt DateTime?`.
- **RefreshToken**: `userId`, `token String @unique`, `expiredAt
  DateTime?`.
- **Queue**: `type`, `status String @default("pending")`, `payload Json`
  (native Json column — matches the fact that every real call site writes
  a plain object, never a JSON string; do not resurrect the unused
  `src/utils/queue.js#dispatch` stringify helper), `maxRetries Int
  @default(5)`, `retriesCount Int @default(0)`, `retriedAt DateTime?`.

## 4. Business-logic changes (beyond a mechanical port)

Everything else is a 1:1 behavior port. Two deliberate exceptions:

1. **Fix counter drift on delete**: `post.service.js`'s `remove()` today
   never decrements `User.postsCount`, `Topic.postsCount`, or reconciles
   `User.likesCount` for likes that existed on the deleted post. The
   rewritten service must decrement these on post delete (and equivalent
   comment delete paths for `likeCount`, where applicable), since the
   service layer is being fully rewritten anyway.
2. Keep as-is (explicitly not fixing, to avoid unrelated scope creep):
   `retriesCount` still isn't incremented by the queue worker on failure;
   `Tag`/`tags` stays unwired; `notifiableType` stays a free-form string
   with no enum.

## 5. API response shape (blog-ui compatibility)

Preserve the existing normalized response shapes the Mongoose service layer
already produces — these become the contract the Prisma-backed rewrite must
match, not something to redesign:

- `id` fields as strings.
- **Casing**: Prisma schema fields are camelCase (idiomatic Prisma), but
  the denormalized counters that today reach the FE unformatted —
  `likes_count`, `views_count`, `posts_count`, `follower_count`,
  `following_count`, `like_count` — never pass through a
  normalization/flatten step in the current code (unlike Comment/
  Notification, which already have one). The rewritten service layer must
  keep emitting these exact snake_case field names in JSON responses (map
  `post.likesCount` → `likes_count` etc. at the response-building step),
  since `blog-ui` (e.g. `Profile.jsx` reading `follower_count`/
  `following_count`) reads them directly with no camelCase fallback.
- Comment responses: pre-flattened (`user`, `id`, `created_at`,
  `updated_at`, `replies[]`) — keep field names as-is (snake_case timestamps)
  to avoid unrelated FE changes.
- Notification responses: pre-normalized (`id`, `type`, `message`, `link`,
  `read`, `createdAt`) — keep as-is.
- Follow/following list responses: keep the current flattening (`{
  ...follower, id }`) rather than leaking a raw relation/join shape.
- Post responses: standardize on a single `user` key (drop the current
  duplicate `user_id`-as-populated-object timing artifact) plus `topics`
  as an array of flat topic objects with a real `id` field.
- Message responses: standardize on `user` (drop the dual
  string-vs-object `user_id` ambiguity).

## 6. blog-ui changes

Update these files to remove now-unnecessary Mongo-shape fallbacks/branches
(`_id`, `.populate()`-in-place duplication) now that the API always returns
a clean, single-shaped `id`/`user`/`topics`/`members`:

- `src/components/ChatWindow/ChatWindow.jsx`
- `src/pages/DirectMessages/DirectMessages.jsx`
- `src/components/PostCard/PostCard.jsx` (also fixes the `t.id` undefined
  topic-badge key bug, now that topics carry a real `id`)
- `src/components/PostModal/PostModal.jsx`
- `src/pages/Profile/Profile.jsx`
- `src/pages/Topic/Topic.jsx`
- `src/pages/FollowingFeed/FollowingFeed.jsx`
- `src/pages/Search/Search.jsx`

No changes expected in `services/*.js` (thin passthroughs already) or in
`CommentItem.jsx`/`CommentSection.jsx`/`NotificationDropdown.jsx` (already
consume pre-normalized shapes that aren't changing).

## 7. Environment / tooling changes

- `blog-api/.env`: replace `MONGODB_URI` with a single `DATABASE_URL`
  Postgres connection string (Prisma convention —
  `postgresql://user:pass@host:port/db`), for `development`/`test`/
  `production` the same way `CLIENT_URL` etc. are already single vars
  today. Drop the discrete `DB_*`/`PROD_DB_*` vars from `.env.example`
  entirely rather than keeping both forms.
- `package.json`: remove `mongoose`; add `prisma` (dev) + `@prisma/client`.
  Add `npx prisma migrate dev` / `npx prisma db seed` scripts.
- `server.js`: replace `mongoose.connect(...)` bootstrap with Prisma Client
  instantiation (singleton, e.g. `src/db/prisma.js`).
- `src/db/seed.js`: rewritten using Prisma Client instead of Mongoose
  models, preserving the same fake-data shape/volume it seeds today.

## 8. Out of scope

- Any change to routes, controllers' orchestration logic, auth flow, JWT
  handling, upload middleware, mailer, socket.io usage, or queue
  worker polling mechanism beyond the `payload` column type.
- Fixing the known `checkAuth`-missing routes, the `topic.service.js`
  missing `slugify`/`faker` imports, or the `validator` missing-require bug
  — unrelated to the database engine swap.
- Restoring the dead fan-out `user_notification` notification design.
- Building out real Tag management (creation UI, tagging flow) — `Tag`
  stays present but unused, matching current behavior.
