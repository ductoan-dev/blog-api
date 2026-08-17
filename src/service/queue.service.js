const { Queue } = require("@/db/models");

class QueueService {
  async findPendingJobs() {
    return await Queue.find({ status: "pending" });
  }

  async create(data) {
    return await Queue.create(data);
  }

  async update(id, data) {
    await Queue.findByIdAndUpdate(id, data);
  }

  async remove(id) {
    await Queue.findByIdAndDelete(id);
    return null;
  }
}

module.exports = new QueueService();
