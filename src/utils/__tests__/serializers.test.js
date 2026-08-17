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
