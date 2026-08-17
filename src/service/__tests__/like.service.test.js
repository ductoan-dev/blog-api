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
