const { Post, Topic, User, Like, Sequelize, Op } = require("@/db/models");
const likesService = require("@/service/like.service");
const topicsService = require("@/service/topic.service");
const usersService = require("@/service/user.service");
const slugify = require("slugify");
class PostsService {
  async getAll() {
    const posts = await Post.findAll({
      include: [
        { model: Topic, as: "topics" },
        { model: User, as: "user" },
      ],
      order: [
        ["published_at", "DESC"],
        ["createdAt", "DESC"],
      ],
    });
    const result = posts.map((post) => {
      const postData = post.toJSON();
      if (postData.user) {
        postData.user.full_name = `${postData.user.first_name} ${postData.user.last_name}`;
      }
      return postData;
    });
    const postIds = posts.map((post) => post.id);
    return { posts: result, postIds };
  }

  canUserViewPost(post, currentUser, followingIds = []) {
    if (!currentUser) {
      return post.visibility === "public" || !post.visibility;
    }

    if (post.user_id === currentUser.id) {
      return true;
    }

    if (post.visibility === "public" || !post.visibility) {
      return true;
    }

    if (post.visibility === "followers") {
      return followingIds.includes(post.user_id);
    }

    if (post.visibility === "private") {
      return false;
    }

    return false;
  }

  async getById(id) {
    const post = await Post.findOne({
      where: { id },
      include: [
        {
          model: Topic,
          as: "topics",
        },
        {
          model: User,
          as: "user",
        },
      ],
    });
    if (post?.user) {
      post.user.full_name = `${post.user.first_name} ${post.user.last_name}`;
    }
    return post;
  }
  async getListByMe(currentUser) {
    try {
      const post = await Post.findAll({
        where: { user_id: currentUser.id },
        include: [
          {
            model: Topic,
            as: "topics",
          },
          {
            model: User,
            as: "user",
            attributes: ["id", "avatar", "first_name", "last_name", "username"],
          },
        ],
      });
      return this.handleLikeAndBookmarkFlags(post, currentUser);
    } catch (error) {
      throw new Error("Get fail");
    }
  }

  async getByUserName(username, currentUser) {
    const user = await User.findOne({
      where: {
        username,
      },
    });

    if (!user) throw new Error("Not found user by username");

    const posts = await Post.findAll({
      where: {
        user_id: user.id,
        status: "published",
        published_at: {
          [Op.lte]: new Date(),
        },
      },
      include: [
        { model: Topic, as: "topics" },
        {
          model: User,
          as: "user",
          attributes: [
            "id",
            "avatar",
            "username",
            // "fullname",
            "first_name",
            "last_name",
          ],
        },
        // {
        //   model: User,
        //   as: "usersBookmarked",
        //   attributes: ["id"],
        // },
      ],
    });

    const followingIds = await usersService.getUserFollowingIds(currentUser);

    const postVisible = posts.filter((post) =>
      this.canUserViewPost(post, currentUser, followingIds)
    );

    return this.handleLikeAndBookmarkFlags(postVisible, currentUser);
  }

  handleLikeAndBookmarkFlags = async (posts, currentUser) => {
    if (!currentUser) return posts;

    const postIds = posts.map((post) => post.id);

    const likes = await likesService.getAll("Post", postIds);

    const currentUserLikes = new Set();
    const currentUserBookmark = new Set();

    likes.forEach((like) => {
      if (like.user_id === currentUser.id) {
        currentUserLikes.add(like.likeable_id);
      }
    });

    return posts.map((post) => {
      post.usersBookmarked?.forEach((item) => {
        if (item.id === currentUser.id) currentUserBookmark.add(post.id);
      });

      return {
        ...post.toJSON(),
        is_like: currentUserLikes.has(post.id),
        is_bookmark: currentUserBookmark.has(post.id),
      };
    });
  };
  async getBySlug(slug) {
    const post = await Post.findOne({
      where: { slug },
      include: [
        { model: Topic, as: "topics" },
        { model: User, as: "user" },
      ],
    });

    if (post?.user) {
      post.user.full_name = `${post.user.first_name} ${post.user.last_name}`;
    }
    return post;
  }

  async getBookmarkedPostsByUser(currentUser) {
    if (!currentUser) throw new Error("You must be logged in to access this.");

    const user = await User.findByPk(currentUser.id, {
      include: [
        {
          model: Post,
          as: "bookmarkedPosts",
          through: {
            attributes: ["id", "createdAt", "post_id", "user_id"],
          },
          include: [
            {
              model: Topic,
              as: "topics",
            },
            {
              model: User,
              as: "user",
              attributes: ["id", "first_name", "last_name", "avatar"],
            },
            {
              model: User,
              as: "usersBookmarked",
              attributes: ["id"],
            },
          ],
        },
      ],
    });

    console.log(user?.bookmarkedPosts);

    const posts = user?.bookmarkedPosts || [];

    return this.handleLikeAndBookmarkFlags(posts, currentUser);
  }

  async getByTopicId(currentUser, topicId) {
    try {
      const posts = await Post.findAll({
        where: {
          status: "published",
          published_at: {
            [Op.lte]: new Date(),
          },
        },
        include: [
          {
            model: Topic,
            as: "topics",
            where: { id: topicId },
          },
          {
            model: User,
            as: "user",
          },
          {
            model: User,
            as: "usersBookmarked",
            attributes: ["id"],
          },
        ],
      });
      const followingIds = await usersService.getUserFollowingIds(currentUser);
      const postVisible = posts.filter((post) =>
        this.canUserViewPost(post, currentUser, followingIds)
      );
      return this.handleLikeAndBookmarkFlags(postVisible, currentUser);
    } catch (error) {
      throw new Error("TopicId invalid");
    }
  }

  async getRelatedPosts(currentPostId, currentUser) {
    const currentPost = await Post.findOne({
      where: {
        id: currentPostId,
        status: "published",
        published_at: { [Op.lte]: new Date() },
      },
      include: {
        model: Topic,
        as: "topics",
        through: { attributes: [] },
      },
    });

    if (!currentPost) throw new Error("Post not found");

    const topicIds = currentPost.topics.map((item) => item.id);

    const publishedScope = {
      id: { [Op.ne]: currentPostId },
      status: "published",
      published_at: { [Op.lte]: new Date() },
    };

    const userInclude = {
      model: User,
      as: "user",
      attributes: ["id", "avatar", "first_name", "last_name"],
    };
    const bookmarkInclude = {
      model: User,
      as: "usersBookmarked",
      attributes: ["id"],
    };

    let postByTopics = [];
    if (topicIds.length > 0) {
      postByTopics = await Post.findAll({
        where: publishedScope,
        include: [
          {
            model: Topic,
            as: "topics",
            through: { attributes: [] },
            where: { id: topicIds },
            required: true,
          },
          userInclude,
          bookmarkInclude,
        ],
        limit: 3,
        order: Sequelize.literal("RAND()"),
        subQuery: false,
      });
    }

    let allPosts = postByTopics;

    if (postByTopics.length < 3) {
      const excludeIds = [currentPostId, ...postByTopics.map((p) => p.id)];

      const morePosts = await Post.findAll({
        where: {
          ...publishedScope,
          id: { [Op.notIn]: excludeIds },
        },
        include: [
          { model: Topic, as: "topics", through: { attributes: [] } },
          userInclude,
          bookmarkInclude,
        ],
        limit: 3 - postByTopics.length,
        order: Sequelize.literal("RAND()"),
      });

      allPosts = [...postByTopics, ...morePosts];
    }

    const followingIds = await usersService.getUserFollowingIds(currentUser);

    const postVisible = allPosts.filter((post) =>
      this.canUserViewPost(post, currentUser, followingIds)
    );

    return this.handleLikeAndBookmarkFlags(postVisible, currentUser);
  }

  async viewsCount(id) {
    try {
      const post = await Post.findByPk(id);
      post.views_count = post.views_count + 1;
      await post.save();
    } catch (error) {
      console.log("Lỗi không thấy cập nhập views", error);
    }
  }
  async toggleLike(currentUser, postId) {
    if (!currentUser)
      throw new Error("You must be logged in to like this post.");

    const [like, created] = await Like.findOrCreate({
      where: {
        likeable_id: postId,
        user_id: currentUser.id,
        likeable_type: "Post",
      },
    });

    const post = await Post.findByPk(postId);

    if (!post) throw new Error("Post not found");

    if (!created) {
      await like.destroy();
      post.likes_count = Math.max(0, (post.likes_count ?? 0) - 1);
      await post.save();
      return false;
    }

    post.likes_count = (post.likes_count ?? 0) + 1;
    await post.save();
    return true;
  }

  async create(thumbnailPath, data, currentUser) {
    if (!currentUser) throw new Error("You must be logged to edit");

    const updateData = {};

    if (thumbnailPath) {
      updateData.thumbnail = thumbnailPath?.path.replace(/\\/g, "/");
    }

    if (!data.published_at) {
      updateData.published_at = new Date();
    }

    const { topics, ...remain } = data;
    const newData = { ...updateData, ...remain };

    const baseSlug = slugify(newData.title, { lower: true, strict: true });
    let slug = baseSlug;
    let counter = 1;

    while (await Post.findOne({ where: { slug } })) {
      slug = `${baseSlug}-${counter++}`;
    }

    const post = await Post.create({
      ...newData,
      slug,
      user_id: currentUser.id,
    });

    const newTopics = JSON.parse(topics);
    await Promise.all(
      newTopics.map(async (item) => {
        const { topic } = await topicsService.findOrCreate(item);

        topic.posts_count = (topic.posts_count ?? 0) + 1;
        await topic.save();

        await post.addTopic(topic.id);
      })
    );

    currentUser.posts_count = currentUser.posts_count + 1;
    await currentUser.save();

    return post;
  }

  async update(id, data) {
    try {
      await Post.update(data, {
        where: { id },
      });
      return await Post.findByPk(id);
    } catch (error) {
      return console.log("Lỗi khi update", error);
    }
  }

  async remove(id) {
    await Post.destroy({
      where: { id },
    });
    return null;
  }
}
module.exports = new PostsService();
