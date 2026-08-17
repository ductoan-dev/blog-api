const { Post, Topic, User, Like, Bookmark } = require("@/db/models");
const likesService = require("@/service/like.service");
const topicsService = require("@/service/topic.service");
const usersService = require("@/service/user.service");
const slugify = require("slugify");
const emitter = require("@/utils/emitter");
const notificationService = require("@/service/notification.service");

class PostsService {
  async getAll(currentUser = null) {
    const posts = await Post.find()
      .populate("topics")
      .populate("user_id", "id avatar first_name last_name username fullname")
      .sort({ published_at: -1, createdAt: -1 })
      .lean();

    const mapped = posts.map((post) => ({
      ...post,
      id: post._id.toString(),
      user: post.user_id,
    }));

    const postIds = posts.map((p) => p._id);
    const result = await this.handleLikeAndBookmarkFlags(mapped, currentUser);
    return { posts: result, postIds };
  }

  canUserViewPost(post, currentUser, followingIds = []) {
    if (!currentUser) {
      return post.visibility === "public" || !post.visibility;
    }

    const postUserId = post.user_id?._id
      ? post.user_id._id.toString()
      : post.user_id?.toString();

    if (postUserId === currentUser.id) return true;

    if (post.visibility === "public" || !post.visibility) return true;

    if (post.visibility === "followers") {
      return followingIds.includes(postUserId);
    }

    return false;
  }

  async getById(id) {
    const post = await Post.findById(id)
      .populate("topics")
      .populate("user_id", "id avatar first_name last_name username fullname")
      .lean();

    if (!post) return null;
    return { ...post, id: post._id.toString(), user: post.user_id };
  }

  async getListByMe(currentUser) {
    try {
      const posts = await Post.find({ user_id: currentUser._id })
        .populate("topics")
        .populate("user_id", "id avatar first_name last_name username")
        .lean();

      const mapped = posts.map((p) => ({ ...p, id: p._id.toString(), user: p.user_id }));
      return this.handleLikeAndBookmarkFlags(mapped, currentUser);
    } catch (error) {
      throw new Error("Get fail");
    }
  }

  async getByUserName(username, currentUser) {
    const user = await User.findOne({ username });
    if (!user) throw new Error("Not found user by username");

    const posts = await Post.find({
      user_id: user._id,
      status: "published",
      published_at: { $lte: new Date() },
    })
      .populate("topics")
      .populate("user_id", "id avatar username first_name last_name")
      .lean();

    const mapped = posts.map((p) => ({ ...p, id: p._id.toString(), user: p.user_id }));

    const followingIds = await usersService.getUserFollowingIds(currentUser);
    const postVisible = mapped.filter((post) =>
      this.canUserViewPost(post, currentUser, followingIds)
    );

    return this.handleLikeAndBookmarkFlags(postVisible, currentUser);
  }

  handleLikeAndBookmarkFlags = async (posts, currentUser) => {
    if (!currentUser) return posts;

    const postIds = posts.map((p) => p._id);

    const [likes, bookmarks] = await Promise.all([
      likesService.getAll("Post", postIds),
      Bookmark.find({ user_id: currentUser._id, post_id: { $in: postIds } }),
    ]);

    const likedSet = new Set();
    likes.forEach((like) => {
      if (like.user_id.toString() === currentUser.id) {
        likedSet.add(like.likeable_id.toString());
      }
    });

    const bookmarkSet = new Set(bookmarks.map((b) => b.post_id.toString()));

    return posts.map((post) => ({
      ...post,
      is_like: likedSet.has(post._id.toString()),
      is_bookmark: bookmarkSet.has(post._id.toString()),
    }));
  };

  async getBySlug(slug, currentUser = null) {
    const post = await Post.findOne({ slug })
      .populate("topics")
      .populate("user_id", "id avatar first_name last_name username fullname")
      .lean();

    if (!post) return null;

    const base = { ...post, id: post._id.toString(), user: post.user_id };
    const [withFlags] = await this.handleLikeAndBookmarkFlags([base], currentUser);
    return withFlags;
  }

  async getBookmarkedPostsByUser(currentUser) {
    if (!currentUser) throw new Error("You must be logged in to access this.");

    const bookmarks = await Bookmark.find({ user_id: currentUser._id });
    const postIds = bookmarks.map((b) => b.post_id);

    const posts = await Post.find({ _id: { $in: postIds } })
      .populate("topics")
      .populate("user_id", "id first_name last_name avatar")
      .lean();

    const mapped = posts.map((p) => ({ ...p, user: p.user_id }));
    return this.handleLikeAndBookmarkFlags(mapped, currentUser);
  }

  async getByTopicId(currentUser, topicId) {
    try {
      const posts = await Post.find({
        topics: topicId,
        status: "published",
        published_at: { $lte: new Date() },
      })
        .populate("topics")
        .populate("user_id")
        .lean();

      const mapped = posts.map((p) => ({ ...p, user: p.user_id }));

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
    const currentPost = await Post.findOne({
      _id: currentPostId,
      status: "published",
      published_at: { $lte: new Date() },
    }).select("topics");

    if (!currentPost) throw new Error("Post not found");

    const topicIds = currentPost.topics;

    const publishedFilter = {
      _id: { $ne: currentPost._id },
      status: "published",
      published_at: { $lte: new Date() },
    };

    const populateOpts = [
      { path: "user_id", select: "id avatar first_name last_name" },
      { path: "topics" },
    ];

    let postByTopics = [];
    if (topicIds.length > 0) {
      postByTopics = await Post.find({ ...publishedFilter, topics: { $in: topicIds } })
        .populate(populateOpts)
        .lean();
      postByTopics = shuffle(postByTopics).slice(0, 3);
    }

    let allPosts = postByTopics;

    if (postByTopics.length < 3) {
      const excludeIds = [currentPost._id, ...postByTopics.map((p) => p._id)];
      const morePosts = await Post.find({
        ...publishedFilter,
        _id: { $nin: excludeIds },
      })
        .populate(populateOpts)
        .lean();

      allPosts = [...postByTopics, ...shuffle(morePosts).slice(0, 3 - postByTopics.length)];
    }

    const mapped = allPosts.map((p) => ({ ...p, user: p.user_id }));

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

    const posts = await Post.find({
      user_id: { $in: followingIds },
      status: "published",
      published_at: { $lte: new Date() },
    })
      .populate("topics")
      .populate("user_id", "id _id avatar first_name last_name username fullname")
      .sort({ published_at: -1, createdAt: -1 })
      .lean();

    const mapped = posts.map((p) => ({
      ...p,
      id: p._id.toString(),
      user: p.user_id,
    }));

    return this.handleLikeAndBookmarkFlags(mapped, currentUser);
  }

  async viewsCount(id) {
    try {
      await Post.findByIdAndUpdate(id, { $inc: { views_count: 1 } });
    } catch (error) {
      console.log("Lỗi không thấy cập nhập views", error);
    }
  }

  async toggleLike(currentUser, postId) {
    if (!currentUser)
      throw new Error("You must be logged in to like this post.");

    const existing = await Like.findOne({
      likeable_id: postId,
      user_id: currentUser._id,
      likeable_type: "Post",
    });

    const post = await Post.findById(postId);
    if (!post) throw new Error("Post not found");

    if (existing) {
      await existing.deleteOne();
      post.likes_count = Math.max(0, (post.likes_count ?? 0) - 1);
      await post.save();
      await User.findByIdAndUpdate(post.user_id, {
        $inc: { likes_count: -1 },
      });
      return false;
    }

    await Like.create({
      likeable_id: postId,
      user_id: currentUser._id,
      likeable_type: "Post",
    });
    post.likes_count = (post.likes_count ?? 0) + 1;
    await post.save();
    await User.findByIdAndUpdate(post.user_id, {
      $inc: { likes_count: 1 },
    });

    // Notify post author (skip if author liked their own post)
    if (post.user_id.toString() !== currentUser._id.toString()) {
      try {
        const likerName =
          currentUser.fullname ||
          [currentUser.first_name, currentUser.last_name].filter(Boolean).join(" ") ||
          currentUser.username;
        const notif = await notificationService.create({
          userId: post.user_id,
          type: "like",
          title: `${likerName} đã thích bài viết của bạn`,
          notifiableType: "Post",
          notifiableId: post._id,
          messageLink: `/blog/${post.slug}`,
        });
        emitter.emit("notification:post_like", {
          toUserId: post.user_id.toString(),
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

    const updateData = {};

    if (thumbnailPath) {
      updateData.thumbnail = thumbnailPath.path.replace(/\\/g, "/");
    }

    if (!data.published_at) {
      updateData.published_at = new Date();
    }

    const { topics, ...remain } = data;
    const newData = { ...updateData, ...remain };

    const baseSlug = slugify(newData.title, { lower: true, strict: true });
    let slug = baseSlug;
    let counter = 1;
    while (await Post.findOne({ slug })) {
      slug = `${baseSlug}-${counter++}`;
    }

    const post = await Post.create({
      ...newData,
      slug,
      user_id: currentUser._id,
    });

    const newTopics = JSON.parse(topics);
    await Promise.all(
      newTopics.map(async (item) => {
        const { topic } = await topicsService.findOrCreate(item);
        topic.posts_count = (topic.posts_count ?? 0) + 1;
        await topic.save();
        await Post.findByIdAndUpdate(post._id, { $addToSet: { topics: topic._id } });
      })
    );

    await User.findByIdAndUpdate(currentUser._id, { $inc: { posts_count: 1 } });

    return post;
  }

  async update(id, data) {
    try {
      return await Post.findByIdAndUpdate(id, data, { new: true });
    } catch (error) {
      console.log("Lỗi khi update", error);
      return null;
    }
  }

  async remove(id) {
    await Post.findByIdAndDelete(id);
    return null;
  }

  async search(query, currentUser = null) {
    const regex = new RegExp(query, "i");
    const posts = await Post.find({
      status: "published",
      $or: [{ title: regex }, { content: regex }],
    })
      .populate("topics")
      .populate("user_id", "id avatar first_name last_name username fullname")
      .sort({ published_at: -1 })
      .lean();

    const mapped = posts.map((post) => ({
      ...post,
      id: post._id.toString(),
      user: post.user_id,
    }));

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
