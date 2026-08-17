const prisma = require("@/db/prisma");

class NotificationService {
  async create({ userId, type, title, notifiableType, notifiableId, messageLink }) {
    const notif = await prisma.notification.create({
      data: {
        userId,
        type,
        title,
        notifiableType,
        notifiableId,
        messageLink: messageLink || null,
        readAt: null,
      },
    });
    return this._format(notif);
  }

  async getAll(userId) {
    const notifs = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return notifs.map(this._format);
  }

  async markRead(notificationId, userId) {
    const result = await prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { readAt: new Date() },
    });
    if (result.count === 0) return null;
    const notif = await prisma.notification.findUnique({ where: { id: notificationId } });
    return this._format(notif);
  }

  async markAllRead(userId) {
    await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  _format(n) {
    return {
      id: n.id,
      type: n.type,
      message: n.title,
      link: n.messageLink || null,
      read: !!n.readAt,
      createdAt: n.createdAt,
    };
  }
}

module.exports = new NotificationService();
