const prisma = require("@/db/prisma");
const { resetDb } = require("@/test/resetDb");
const { createUser } = require("@/test/factories");
const messengerService = require("@/service/messenger.service");

describe("messenger.service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("getOrCreateDirect creates a 2-member conversation once, reuses it on the second call", async () => {
    const alice = await createUser({ username: "alice" });
    const bob = await createUser({ username: "bob" });

    const first = await messengerService.getOrCreateDirect(alice, bob.id);
    expect(first.members).toHaveLength(2);

    const second = await messengerService.getOrCreateDirect(alice, bob.id);
    expect(second.id).toBe(first.id);
  });

  it("sendMessage requires membership and updates last_message_at", async () => {
    const alice = await createUser({ username: "alice" });
    const bob = await createUser({ username: "bob" });
    const outsider = await createUser({ username: "carol" });
    const conv = await messengerService.getOrCreateDirect(alice, bob.id);

    const msg = await messengerService.sendMessage(conv.id, alice, "hi bob");
    expect(msg.content).toBe("hi bob");
    expect(msg.user.id).toBe(alice.id);

    await expect(messengerService.sendMessage(conv.id, outsider, "hi")).rejects.toThrow("Conversation not found");
  });

  it("getMessages returns messages ordered oldest-first with a flat user", async () => {
    const alice = await createUser({ username: "alice" });
    const bob = await createUser({ username: "bob" });
    const conv = await messengerService.getOrCreateDirect(alice, bob.id);
    await messengerService.sendMessage(conv.id, alice, "first");
    await messengerService.sendMessage(conv.id, bob, "second");

    const messages = await messengerService.getMessages(conv.id, alice);

    expect(messages.map((m) => m.content)).toEqual(["first", "second"]);
    expect(messages[1].user.username).toBe("bob");
  });
});
