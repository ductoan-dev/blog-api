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
