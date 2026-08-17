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

  it("toggleFollow enqueues sendNewFollowerJob with bare ids only, no password/twoFactorSecret", async () => {
    const alice = await createUser({ username: "alice-queue" });
    const bob = await createUser({ username: "bob-queue" });
    await prisma.userSetting.create({
      data: { userId: bob.id, data: { emailNewFollowers: true } },
    });

    await userService.toggleFollow(alice, bob.id);

    const job = await prisma.queue.findFirst({ where: { type: "sendNewFollowerJob" } });
    expect(job).not.toBeNull();
    expect(job.payload).toEqual({ followingId: bob.id, followerId: alice.id });
    expect(JSON.stringify(job.payload)).not.toMatch(/password|twoFactorSecret/i);
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

    expect(updated.website_url).toBe("https://example.com");
  });

  it("editProfile returns a serialized (snake_case) user and never leaks password/twoFactorSecret", async () => {
    const user = await createUser();
    const updated = await userService.editProfile(null, { title: "New title" }, user);

    expect(updated.title).toBe("New title");
    expect(updated.password).toBeUndefined();
    expect(updated.twoFactorSecret).toBeUndefined();
    expect(updated.two_factor_secret).toBeUndefined();
    // sanity check that it went through serializeUser's snake_case shape
    expect(updated.first_name).toBe("Test");
    expect(updated.firstName).toBeUndefined();
  });

  it("getUserByUsername's full-profile branch returns a serialized (snake_case) user, not a raw Prisma row", async () => {
    const owner = await createUser({ username: "owner-full", firstName: "Owner" });

    const result = await userService.getUserByUsername("owner-full", owner);

    expect(result.first_name).toBe("Owner");
    expect(result.firstName).toBeUndefined();
    expect(result.password).toBeUndefined();
    expect(result.twoFactorSecret).toBeUndefined();
  });

  it("getFollowersList and getFollowingList return serialized (snake_case) users", async () => {
    const alice = await createUser({ username: "alice2", firstName: "Alice" });
    const bob = await createUser({ username: "bob2", firstName: "Bob" });

    await userService.toggleFollow(alice, bob.id);

    const followers = await userService.getFollowersList(bob.id);
    expect(followers[0].first_name).toBe("Alice");
    expect(followers[0].firstName).toBeUndefined();

    const following = await userService.getFollowingList(alice.id);
    expect(following[0].first_name).toBe("Bob");
    expect(following[0].firstName).toBeUndefined();
  });
});
