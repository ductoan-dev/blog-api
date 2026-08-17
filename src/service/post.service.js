const prisma = require("@/db/prisma");
const likesService = require("@/service/like.service");
const topicsService = require("@/service/topic.service");
const usersService = require("@/service/user.service");
const slugify = require("slugify");
const emitter = require("@/utils/emitter");
const notificationService = require("@/service/notification.service");
const { serializePost } = require("@/utils/serializers");

const POST_INCLUDE = { user: true, topics: true, tags: true };

class PostsService {
  async getAll(currentUser = null) {
    const posts = await prisma.post.findMany({
      include: POST_INCLUDE,
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    });

    const mapped = posts.map(serializePost);
    const postIds = posts.map((p) => p.id);
    const result = await this.handleLikeAndBookmarkFlags(mapped, currentUser);
    return { posts: result, postIds };
  }

  canUserViewPost(post, currentUser, followingIds = []) {
    if (!currentUser) {
      return post.visibility === "public" || !post.visibility;
    }

    const postUserId = post.user?.id;

    if (postUserId === currentUser.id) return true;

    if (post.visibility === "public" || !post.visibility) return true;

    if (post.visibility === "followers") {
      return followingIds.includes(postUserId);
    }

    return false;
  }

  async getById(id) {
    const post = await prisma.post.findUnique({ where: { id }, include: POST_INCLUDE });
    if (!post) return null;
    return serializePost(post);
  }

  async getListByMe(currentUser) {
    try {
      const posts = await prisma.post.findMany({
        where: { userId: currentUser.id },
        include: POST_INCLUDE,
      });

      const mapped = posts.map(serializePost);
      return this.handleLikeAndBookmarkFlags(mapped, currentUser);
    } catch (error) {
      throw new Error("Get fail");
    }
  }

  async getByUserName(username, currentUser) {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) throw new Error("Not found user by username");

    const posts = await prisma.post.findMany({
      where: { userId: user.id, status: "published", publishedAt: { lte: new Date() } },
      include: POST_INCLUDE,
    });

    const mapped = posts.map(serializePost);

    const followingIds = await usersService.getUserFollowingIds(currentUser);
    const postVisible = mapped.filter((post) =>
      this.canUserViewPost(post, currentUser, followingIds)
    );

    return this.handleLikeAndBookmarkFlags(postVisible, currentUser);
  }

  handleLikeAndBookmarkFlags = async (posts, currentUser) => {
    if (!currentUser) return posts;

    const postIds = posts.map((p) => p.id);

    const [likes, bookmarks] = await Promise.all([
      likesService.getAll("Post", postIds),
      prisma.bookmark.findMany({ where: { userId: currentUser.id, postId: { in: postIds } } }),
    ]);

    const likedSet = new Set();
    likes.forEach((like) => {
      if (like.userId === currentUser.id) {
        likedSet.add(like.likeableId);
      }
    });

    const bookmarkSet = new Set(bookmarks.map((b) => b.postId));

    return posts.map((post) => ({
      ...post,
      is_like: likedSet.has(post.id),
      is_bookmark: bookmarkSet.has(post.id),
    }));
  };

  async getBySlug(slug, currentUser = null) {
    const post = await prisma.post.findUnique({ where: { slug }, include: POST_INCLUDE });
    if (!post) return null;

    const base = serializePost(post);
    const [withFlags] = await this.handleLikeAndBookmarkFlags([base], currentUser);
    return withFlags;
  }

  async getBookmarkedPostsByUser(currentUser) {
    if (!currentUser) throw new Error("You must be logged in to access this.");

    const bookmarks = await prisma.bookmark.findMany({ where: { userId: currentUser.id } });
    const postIds = bookmarks.map((b) => b.postId);

    const posts = await prisma.post.findMany({
      where: { id: { in: postIds } },
      include: POST_INCLUDE,
    });

    const mapped = posts.map(serializePost);
    return this.handleLikeAndBookmarkFlags(mapped, currentUser);
  }

  async getByTopicId(currentUser, topicId) {
    try {
      const posts = await prisma.post.findMany({
        where: {
          topics: { some: { id: topicId } },
          status: "published",
          publishedAt: { lte: new Date() },
        },
        include: POST_INCLUDE,
      });

      const mapped = posts.map(serializePost);

      const followingIds = await usersService.getUserFollowingIds(currentUser);
      const postVisible = mapped.filter((post) =>
        this.canUserViewPost(post, currentUser, followingIds)
      );

      return this.handleLikeAndBookmarkFlags(postVisible, currentUser);
    } catch (error) {
      throw new Error("TopicId invalid");
    }
  }

  async getRelatedPosts(currentPostId, currentUser) {
    const currentPost = await prisma.post.findUnique({
      where: { id: currentPostId },
      include: { topics: true },
    });

    if (!currentPost || currentPost.status !== "published" || currentPost.publishedAt > new Date()) {
      throw new Error("Post not found");
    }

    const topicIds = currentPost.topics.map((t) => t.id);

    const publishedFilter = {
      id: { not: currentPost.id },
      status: "published",
      publishedAt: { lte: new Date() },
    };

    let postByTopics = [];
    if (topicIds.length > 0) {
      postByTopics = await prisma.post.findMany({
        where: { ...publishedFilter, topics: { some: { id: { in: topicIds } } } },
        include: POST_INCLUDE,
      });
      postByTopics = shuffle(postByTopics).slice(0, 3);
    }

    let allPosts = postByTopics;

    if (postByTopics.length < 3) {
      const excludeIds = [currentPost.id, ...postByTopics.map((p) => p.id)];
      const morePosts = await prisma.post.findMany({
        where: { ...publishedFilter, id: { notIn: excludeIds } },
        include: POST_INCLUDE,
      });

      allPosts = [...postByTopics, ...shuffle(morePosts).slice(0, 3 - postByTopics.length)];
    }

    const mapped = allPosts.map(serializePost);

    const followingIds = await usersService.getUserFollowingIds(currentUser);
    const postVisible = mapped.filter((post) =>
      this.canUserViewPost(post, currentUser, followingIds)
    );

    return this.handleLikeAndBookmarkFlags(postVisible, currentUser);
  }

  async getFollowingFeed(currentUser) {
    if (!currentUser) throw new Error("You must be logged in.");

    const followingIds = await usersService.getUserFollowingIds(currentUser);
    if (!followingIds.length) return [];

    const posts = await prisma.post.findMany({
      where: {
        userId: { in: followingIds },
        status: "published",
        publishedAt: { lte: new Date() },
      },
      include: POST_INCLUDE,
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    });

    const mapped = posts.map(serializePost);

    return this.handleLikeAndBookmarkFlags(mapped, currentUser);
  }

  async viewsCount(id) {
    try {
      await prisma.post.update({ where: { id }, data: { viewsCount: { increment: 1 } } });
    } catch (error) {
      console.log("Lỗi không thấy cập nhập views", error);
    }
  }

  async toggleLike(currentUser, postId) {
    if (!currentUser)
      throw new Error("You must be logged in to like this post.");

    const existing = await prisma.like.findFirst({
      where: { likeableId: postId, userId: currentUser.id, likeableType: "Post" },
    });

    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (!post) throw new Error("Post not found");

    if (existing) {
      await prisma.like.delete({ where: { id: existing.id } });
      await prisma.post.update({
        where: { id: postId },
        data: { likesCount: Math.max(0, post.likesCount - 1) },
      });
      await prisma.user.update({
        where: { id: post.userId },
        data: { likesCount: { decrement: 1 } },
      });
      return false;
    }

    await prisma.like.create({
      data: { likeableId: postId, userId: currentUser.id, likeableType: "Post" },
    });
    await prisma.post.update({
      where: { id: postId },
      data: { likesCount: post.likesCount + 1 },
    });
    await prisma.user.update({
      where: { id: post.userId },
      data: { likesCount: { increment: 1 } },
    });

    if (post.userId !== currentUser.id) {
      try {
        const likerName =
          currentUser.fullname ||
          [currentUser.firstName, currentUser.lastName].filter(Boolean).join(" ") ||
          currentUser.username;
        const notif = await notificationService.create({
          userId: post.userId,
          type: "like",
          title: `${likerName} đã thích bài viết của bạn`,
          notifiableType: "Post",
          notifiableId: post.id,
          messageLink: `/blog/${post.slug}`,
        });
        emitter.emit("notification:post_like", {
          toUserId: post.userId,
          notification: notif,
        });
      } catch (err) {
        console.log("Like notification error:", err);
      }
    }

    return true;
  }

  async create(thumbnailPath, data, currentUser) {
    if (!currentUser) throw new Error("You must be logged to edit");

    const postData = {
      title: data.title,
      description: data.description,
      content: data.content,
      status: data.status,
      visibility: data.visibility,
      metaTitle: data.meta_title,
      metaDescription: data.meta_description,
    };

    if (thumbnailPath) {
      postData.thumbnail = thumbnailPath.path.replace(/\\/g, "/");
    }

    postData.publishedAt = data.published_at ? new Date(data.published_at) : new Date();

    const baseSlug = slugify(postData.title, { lower: true, strict: true });
    let slug = baseSlug;
    let counter = 1;
    while (await prisma.post.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${counter++}`;
    }

    const post = await prisma.post.create({
      data: { ...postData, slug, userId: currentUser.id },
    });

    const newTopics = JSON.parse(data.topics || "[]");
    await Promise.all(
      newTopics.map(async (item) => {
        const { topic } = await topicsService.findOrCreate(item);
        await prisma.topic.update({
          where: { id: topic.id },
          data: { postsCount: { increment: 1 } },
        });
        await prisma.post.update({
          where: { id: post.id },
          data: { topics: { connect: { id: topic.id } } },
        });
      })
    );

    await prisma.user.update({
      where: { id: currentUser.id },
      data: { postsCount: { increment: 1 } },
    });

    return post;
  }

  async update(id, data) {
    try {
      return await prisma.post.update({ where: { id }, data });
    } catch (error) {
      console.log("Lỗi khi update", error);
      return null;
    }
  }

  async remove(id) {
    const post = await prisma.post.findUnique({ where: { id }, include: { topics: true } });
    if (!post) return null;

    const likesToRemove = await prisma.like.count({
      where: { likeableType: "Post", likeableId: id },
    });

    await prisma.post.delete({ where: { id } });

    await prisma.user.update({
      where: { id: post.userId },
      data: {
        postsCount: { decrement: 1 },
        likesCount: { decrement: likesToRemove },
      },
    });

    await Promise.all(
      post.topics.map((topic) =>
        prisma.topic.update({ where: { id: topic.id }, data: { postsCount: { decrement: 1 } } })
      )
    );

    return null;
  }

  async search(query, currentUser = null) {
    const posts = await prisma.post.findMany({
      where: {
        status: "published",
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { content: { contains: query, mode: "insensitive" } },
        ],
      },
      include: POST_INCLUDE,
      orderBy: { publishedAt: "desc" },
    });

    const mapped = posts.map(serializePost);

    return this.handleLikeAndBookmarkFlags(mapped, currentUser);
  }
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = new PostsService();
