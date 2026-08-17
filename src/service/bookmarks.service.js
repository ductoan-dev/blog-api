const { Bookmark } = require("@/db/models");

class BookmarksService {
  async toggleBookmark(currentUser, postId) {
    if (!currentUser)
      throw new Error("You must be logged in to save this post.");

    const existing = await Bookmark.findOne({
      user_id: currentUser._id,
      post_id: postId,
    });

    if (existing) {
      await existing.deleteOne();
      return false;
    }

    await Bookmark.create({ user_id: currentUser._id, post_id: postId });
    return true;
  }

  async remove(currentUser, ids) {
    if (!currentUser)
      throw new Error("You must be logged in to remove save all post.");

    if (!Array.isArray(ids) || ids.length === 0)
      throw new Error("No bookmark IDs provided");

    return await Bookmark.deleteMany({ _id: { $in: ids } });
  }
}

module.exports = new BookmarksService();
