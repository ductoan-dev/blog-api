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
