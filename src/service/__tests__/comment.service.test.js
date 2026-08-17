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
