const prisma = require("@/db/prisma");

class BookmarksService {
  async toggleBookmark(currentUser, postId) {
    if (!currentUser)
      throw new Error("You must be logged in to save this post.");

    const existing = await prisma.bookmark.findFirst({
      where: { userId: currentUser.id, postId },
    });

    if (existing) {
      await prisma.bookmark.delete({ where: { id: existing.id } });
      return false;
    }

    await prisma.bookmark.create({ data: { userId: currentUser.id, postId } });
    return true;
  }

  async remove(currentUser, ids) {
    if (!currentUser)
      throw new Error("You must be logged in to remove save all post.");

    if (!Array.isArray(ids) || ids.length === 0)
      throw new Error("No bookmark IDs provided");

    return prisma.bookmark.deleteMany({ where: { id: { in: ids } } });
  }
}

module.exports = new BookmarksService();
