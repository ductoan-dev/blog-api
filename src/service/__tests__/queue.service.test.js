const prisma = require("@/db/prisma");
const { resetDb } = require("@/test/resetDb");
const queueService = require("@/service/queue.service");

describe("queue.service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a job with a plain-object JSON payload and finds it as pending", async () => {
    await queueService.create({ type: "sendVerifyEmailJob", payload: { userId: "abc" } });
    const pending = await queueService.findPendingJobs();
    expect(pending).toHaveLength(1);
    expect(pending[0].payload).toEqual({ userId: "abc" });
  });

  it("update changes the status", async () => {
    const job = await queueService.create({ type: "sendVerifyEmailJob", payload: {} });
    await queueService.update(job.id, { status: "completed" });
    const updated = await prisma.queue.findUnique({ where: { id: job.id } });
    expect(updated.status).toBe("completed");
  });

  it("remove deletes the job", async () => {
    const job = await queueService.create({ type: "sendVerifyEmailJob", payload: {} });
    await queueService.remove(job.id);
    const found = await prisma.queue.findUnique({ where: { id: job.id } });
    expect(found).toBeNull();
  });
});
