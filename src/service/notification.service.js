const { Notification } = require("@/db/models");

class NotificationService {
  async create({ userId, type, title, notifiableType, notifiableId, messageLink }) {
    const notif = await Notification.create({
      user_id: userId,
      type,
      title,
      notifiable_type: notifiableType,
      notifiable_id: notifiableId,
      message_link: messageLink || null,
      read_at: null,
    });
    return this._format(notif.toObject());
  }

  async getAll(userId) {
    const notifs = await Notification.find({ user_id: userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    return notifs.map(this._format);
  }

  async markRead(notificationId, userId) {
    const notif = await Notification.findOneAndUpdate(
      { _id: notificationId, user_id: userId },
      { read_at: new Date() },
      { new: true }
    ).lean();
    return notif ? this._format(notif) : null;
  }

  async markAllRead(userId) {
    await Notification.updateMany(
      { user_id: userId, read_at: null },
      { read_at: new Date() }
    );
  }

  _format(n) {
    return {
      id: n._id.toString(),
      type: n.type,
      message: n.title,
      link: n.message_link || null,
      read: !!n.read_at,
      createdAt: n.createdAt,
    };
  }
}

module.exports = new NotificationService();
