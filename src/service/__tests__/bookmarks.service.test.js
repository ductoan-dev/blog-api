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
