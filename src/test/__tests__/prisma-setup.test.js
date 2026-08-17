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
