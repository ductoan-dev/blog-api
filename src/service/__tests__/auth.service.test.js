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
