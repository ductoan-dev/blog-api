const prisma = require("@/db/prisma");

class QueueService {
  async findPendingJobs() {
    return prisma.queue.findMany({ where: { status: "pending" } });
  }

  async create(data) {
    return prisma.queue.create({ data });
  }

  async update(id, data) {
    await prisma.queue.update({ where: { id }, data });
  }

  async remove(id) {
    await prisma.queue.delete({ where: { id } });
    return null;
  }
}

module.exports = new QueueService();
