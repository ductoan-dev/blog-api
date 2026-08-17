const prisma = require("@/db/prisma");
const { resetDb } = require("@/test/resetDb");
const { createUser } = require("@/test/factories");
const userService = require("@/service/user.service");

describe("user.service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("toggleFollow creates a Follow row and increments both counters, then reverses on second call", async () => {
    const alice = await createUser({ username: "alice" });
    const bob = await createUser({ username: "bob" });

    const followed = await userService.toggleFollow(alice, bob.id);
    expect(followed).toBe(true);

    const aliceAfter = await prisma.user.findUnique({ where: { id: alice.id } });
    const bobAfter = await prisma.user.findUnique({ where: { id: bob.id } });
    expect(aliceAfter.followingCount).toBe(1);
    expect(bobAfter.followerCount).toBe(1);

    const unfollowed = await userService.toggleFollow(alice, bob.id);
    expect(unfollowed).toBe(false);

    const aliceFinal = await prisma.user.findUnique({ where: { id: alice.id } });
    const bobFinal = await prisma.user.findUnique({ where: { id: bob.id } });
    expect(aliceFinal.followingCount).toBe(0);
    expect(bobFinal.followerCount).toBe(0);
  });

  it("getUserByUsername returns a limited profile when the viewer cannot see it", async () => {
    const owner = await createUser({ username: "private-owner" });
    await prisma.userSetting.create({
      data: { userId: owner.id, data: { profileVisibility: "private" } },
    });
    const stranger = await createUser({ username: "stranger" });

    const result = await userService.getUserByUsername("private-owner", stranger);

    expect(result.canView).toBe(false);
    expect(result.password).toBeUndefined();
  });

  it("setting() upserts a UserSetting row without double JSON-encoding", async () => {
    const user = await createUser();
    await userService.setting({ profileVisibility: "followers", allowComments: false }, user);

    const setting = await prisma.userSetting.findUnique({ where: { userId: user.id } });
    expect(setting.data).toEqual({ profileVisibility: "followers", allowComments: false });
  });

  it("editProfile maps known snake_case body keys and silently ignores unknown ones", async () => {
    const user = await createUser();
    const updated = await userService.editProfile(null, {
      website_url: "https://example.com",
      privacy: JSON.stringify({ ignored: true }),
    }, user);

    expect(updated.websiteUrl).toBe("https://example.com");
  });
});
