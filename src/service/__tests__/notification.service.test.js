const prisma = require("@/db/prisma");
const { resetDb } = require("@/test/resetDb");
const { createUser } = require("@/test/factories");
const notificationService = require("@/service/notification.service");

describe("notification.service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("create returns the legacy {id,type,message,link,read,createdAt} shape", async () => {
    const user = await createUser();
    const notif = await notificationService.create({
      userId: user.id,
      type: "follow",
      title: "Alice đã theo dõi bạn",
      notifiableType: "User",
      notifiableId: user.id,
      messageLink: "/profile/alice",
    });

    expect(notif.message).toBe("Alice đã theo dõi bạn");
    expect(notif.link).toBe("/profile/alice");
    expect(notif.read).toBe(false);
  });

  it("markRead only succeeds for the notification's own user", async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const created = await notificationService.create({
      userId: owner.id, type: "follow", title: "x", notifiableType: "User", notifiableId: owner.id,
    });

    const wrongUserResult = await notificationService.markRead(created.id, stranger.id);
    expect(wrongUserResult).toBeNull();

    const rightUserResult = await notificationService.markRead(created.id, owner.id);
    expect(rightUserResult.read).toBe(true);
  });

  it("markAllRead marks every unread notification for that user", async () => {
    const user = await createUser();
    await notificationService.create({ userId: user.id, type: "follow", title: "a", notifiableType: "User", notifiableId: user.id });
    await notificationService.create({ userId: user.id, type: "like", title: "b", notifiableType: "Post", notifiableId: user.id });

    await notificationService.markAllRead(user.id);

    const all = await notificationService.getAll(user.id);
    expect(all.every((n) => n.read)).toBe(true);
  });
});
