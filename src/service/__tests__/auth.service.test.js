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

  it("register re-sends the verify email and rejects with 409 when the email exists but is unverified", async () => {
    const existing = await createUser({ email: "pending@example.com", verifiedAt: null });

    await expect(
      authService.register({
        first_name: "Pending",
        last_name: "User",
        email: "pending@example.com",
        password: "Password1",
      })
    ).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/chưa xác thực/) });

    const jobs = await prisma.queue.findMany({ where: { type: "sendVerifyEmailJob" } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toEqual({ userId: existing.id });
  });

  it("register rejects with 409 and queues nothing when the email belongs to a verified user", async () => {
    await createUser({ email: "taken@example.com", verifiedAt: new Date() });

    await expect(
      authService.register({
        first_name: "Taken",
        last_name: "User",
        email: "taken@example.com",
        password: "Password1",
      })
    ).rejects.toMatchObject({ status: 409, message: "Email này đã được sử dụng" });

    expect(await prisma.queue.count()).toBe(0);
  });

  it("register drops the leading word of a multi-word first_name when generating the username", async () => {
    const { userId } = await authService.register({
      first_name: "nguyen duc",
      last_name: "toan",
      email: "ductoan1@example.com",
      password: "Password1",
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user.username).toBe("ductoan");
  });

  it("register concatenates a single-word first_name with last_name for the username", async () => {
    const { userId } = await authService.register({
      first_name: "duc",
      last_name: "toan",
      email: "ductoan2@example.com",
      password: "Password1",
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user.username).toBe("ductoan");
  });

  it("register appends an incrementing suffix when the generated username is already taken", async () => {
    await createUser({ username: "ductoan", email: "existing@example.com" });

    const { userId } = await authService.register({
      first_name: "duc",
      last_name: "toan",
      email: "ductoan3@example.com",
      password: "Password1",
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user.username).toBe("ductoan1");
  });

  it("register strips Vietnamese diacritics when generating the username", async () => {
    const { userId } = await authService.register({
      first_name: "Đức",
      last_name: "Toàn",
      email: "ductoan4@example.com",
      password: "Password1",
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user.username).toBe("ductoan");
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
