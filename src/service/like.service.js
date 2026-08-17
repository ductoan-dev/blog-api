const { Like } = require("@/db/models");

class LikesService {
  async getAll(type, ids) {
    const idArray = Array.isArray(ids) ? ids : [ids];
    return await Like.find({
      likeable_type: type,
      likeable_id: { $in: idArray },
    });
  }

  async create(data) {
    return await Like.create(data);
  }

  async update(user_id, data) {
    try {
      const like = await Like.findOne({
        user_id,
        likeable_type: data.likeable_type,
        likeable_id: data.likeable_id,
      });

      if (!like) {
        throw new Error("Không tìm thấy bản ghi like");
      }

      like.is_like = data.is_like;
      await like.save();
      return like;
    } catch (error) {
      console.log("Lỗi khi update: ", error.message);
      return null;
    }
  }

  async checkLike(data) {
    return await Like.create(data);
  }

  async remove(user_id, type) {
    await Like.deleteMany({ user_id, likeable_type: type });
    return null;
  }
}

module.exports = new LikesService();
