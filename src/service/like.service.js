const prisma = require("@/db/prisma");

class LikesService {
  async getAll(type, ids) {
    const idArray = Array.isArray(ids) ? ids : [ids];
    return prisma.like.findMany({
      where: { likeableType: type, likeableId: { in: idArray } },
    });
  }

  async create(data) {
    return prisma.like.create({
      data: {
        userId: data.user_id,
        likeableType: data.likeable_type,
        likeableId: data.likeable_id,
        isLike: data.is_like ?? false,
      },
    });
  }

  async update(userId, data) {
    try {
      const like = await prisma.like.findFirst({
        where: {
          userId,
          likeableType: data.likeable_type,
          likeableId: data.likeable_id,
        },
      });

      if (!like) {
        throw new Error("Không tìm thấy bản ghi like");
      }

      return prisma.like.update({
        where: { id: like.id },
        data: { isLike: data.is_like },
      });
    } catch (error) {
      console.log("Lỗi khi update: ", error.message);
      return null;
    }
  }

  async checkLike(data) {
    return this.create(data);
  }

  async remove(userId, type) {
    await prisma.like.deleteMany({ where: { userId, likeableType: type } });
    return null;
  }
}

module.exports = new LikesService();
