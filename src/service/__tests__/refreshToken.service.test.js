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
