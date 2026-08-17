const { Post, Comment, User, Queue, Like } = require("@/db/models");
const likesService = require("@/service/like.service");
const emitter = require("@/utils/emitter");
const notificationService = require("@/service/notification.service");

class CommentService {
  async getAll() {
    return await Comment.find();
  }

  async getById(id) {
    return await Comment.findById(id).populate("post_id");
  }

  async getBySlug(slug) {
    const post = await Post.findOne({ slug });
    if (!post) return null;
    return await Comment.find({ post_id: post._id }).populate("post_id");
  }

  async getAllCommentsInPost(postId, currentUser) {
    const userFields = "id avatar first_name last_name email username";

    const comments = await Comment.find({
      post_id: postId,
      deleted_at: null,
      parent_id: null,
    })
      .populate("user_id", userFields)
      .lean();

    const replies = await Comment.find({
      post_id: postId,
      deleted_at: null,
      parent_id: { $ne: null },
    })
      .populate("user_id", userFields)
      .lean();

    const replyMap = {};
    replies.forEach((r) => {
      const key = r.parent_id.toString();
      if (!replyMap[key]) replyMap[key] = [];
      replyMap[key].push(r);
    });

    const normalize = (c) => ({
      ...c,
      id: c._id.toString(),
      user: c.user_id,
      created_at: c.createdAt,
      updated_at: c.updatedAt,
    });

    const commentsWithReplies = comments.map((c) => ({
      ...normalize(c),
      replies: (replyMap[c._id.toString()] || []).map(normalize),
    }));

    return this.likeCommentFlags(commentsWithReplies, currentUser);
  }

  likeCommentFlags = async (comments, currentUser) => {
    if (!currentUser) return comments;

    const allComments = [];
    comments.forEach((comment) => {
      allComments.push(comment);
      if (comment.replies && comment.replies.length > 0) {
        allComments.push(...comment.replies);
      }
    });

    const commentIds = allComments.map((c) => c._id);
    const likes = await likesService.getAll("Comment", commentIds);

    const currentUserLikes = new Set();
    likes.forEach((like) => {
      if (like.user_id.toString() === currentUser.id) {
        currentUserLikes.add(like.likeable_id.toString());
      }
    });

    return comments.map((comment) => {
      const withFlag = {
        ...comment,
        is_like: currentUserLikes.has(comment._id.toString()),
      };

      if (withFlag.replies && withFlag.replies.length > 0) {
        withFlag.replies = withFlag.replies.map((reply) => ({
          ...reply,
          is_like: currentUserLikes.has(reply._id.toString()),
        }));
      }

      return withFlag;
    });
  };

  async toggleLike(currentUser, commentId) {
    if (!currentUser)
      throw new Error("You must be logged in to like this post.");

    const existing = await Like.findOne({
      likeable_id: commentId,
      user_id: currentUser._id,
      likeable_type: "Comment",
    });

    const comment = await Comment.findById(commentId);
    if (!comment) throw new Error("Comment not found");

    if (existing) {
      await existing.deleteOne();
      comment.like_count = Math.max(0, (comment.like_count ?? 0) - 1);
      await comment.save();
      return false;
    }

    await Like.create({
      likeable_id: commentId,
      user_id: currentUser._id,
      likeable_type: "Comment",
    });
    comment.like_count = (comment.like_count ?? 0) + 1;
    await comment.save();
    return true;
  }

  async create(currentUser, data) {
    if (!currentUser) throw new Error("Bạn phải đăng nhập để comment");

    let parentId = data.parent_id || null;
    let currentPost = null;

    try {
      currentPost = await Post.findById(data.post_id);
      if (currentPost) {
        const userPost = await User.findById(currentPost.user_id);
        const settings = userPost?.settings?.data
          ? JSON.parse(userPost.settings.data)
          : {};

        if (settings.allowComments === false) {
          throw new Error("Bạn không thể comment bài post này");
        }
      }
    } catch (error) {
      throw new Error(error.message);
    }

    if (parentId) {
      const parentComment = await Comment.findById(parentId);
      if (!parentComment) throw new Error("Parent not found");
      if (parentComment.parent_id) {
        parentId = parentComment.parent_id;
      }
    }

    const comment = await Comment.create({
      ...data,
      parent_id: parentId,
      user_id: currentUser._id,
    });

    const populated = await Comment.findById(comment._id)
      .populate("user_id", "id avatar first_name last_name email username")
      .lean();

    const result = { ...populated, user: populated.user_id, replies: [] };

    try {
      if (currentPost) {
        const userPost = await User.findById(currentPost.user_id);
        const settings = userPost?.settings?.data
          ? JSON.parse(userPost.settings.data)
          : {};
        if (
          userPost._id.toString() !== currentUser._id.toString() &&
          settings.emailNewComments
        ) {
          await Queue.create({
            type: "sendNewCommentJob",
            payload: {
              userPostId: userPost._id.toString(),
              userCommetnId: currentUser._id.toString(),
              content: data.content,
              post: currentPost.toObject(),
            },
          });
        }

        // In-app notification to post author
        if (userPost._id.toString() !== currentUser._id.toString()) {
          const commenterName =
            currentUser.fullname ||
            [currentUser.first_name, currentUser.last_name].filter(Boolean).join(" ") ||
            currentUser.username;
          const notifTitle = parentId
            ? `${commenterName} đã trả lời bình luận trong bài viết của bạn`
            : `${commenterName} đã bình luận về bài viết của bạn`;
          const notif = await notificationService.create({
            userId: userPost._id,
            type: "comment",
            title: notifTitle,
            notifiableType: "Post",
            notifiableId: currentPost._id,
            messageLink: `/blog/${currentPost.slug}`,
          });
          emitter.emit("notification:post_comment", {
            toUserId: userPost._id.toString(),
            notification: notif,
          });
        }
      }
    } catch (error) {
      console.log(error);
    }

    // Notify the direct parent comment author when this is a reply
    if (data.parent_id) {
      try {
        const parentComment = await Comment.findById(data.parent_id)
          .populate("user_id", "_id fullname first_name last_name username")
          .lean();
        if (parentComment?.user_id) {
          const parentAuthorId = parentComment.user_id._id.toString();
          const postAuthorId = currentPost?.user_id?.toString() || "";
          // Skip if the parent author is the replier or the post author (already notified above)
          if (
            parentAuthorId !== currentUser._id.toString() &&
            parentAuthorId !== postAuthorId
          ) {
            const commenterName =
              currentUser.fullname ||
              [currentUser.first_name, currentUser.last_name].filter(Boolean).join(" ") ||
              currentUser.username;
            const notif = await notificationService.create({
              userId: parentComment.user_id._id,
              type: "comment",
              title: `${commenterName} đã trả lời bình luận của bạn`,
              notifiableType: "Post",
              notifiableId: currentPost._id,
              messageLink: `/blog/${currentPost.slug}`,
            });
            emitter.emit("notification:post_comment", {
              toUserId: parentAuthorId,
              notification: notif,
            });
          }
        }
      } catch (err) {
        console.log("Reply notification error:", err);
      }
    }

    return result;
  }

  async update(id, data) {
    try {
      const comment = await Comment.findById(id).select(
        "id content deleted_at edited_at"
      );

      if (!comment) return null;
      if (comment.deleted_at) return null;

      comment.deleted_at = new Date();
      await comment.save();
      return comment;
    } catch (error) {
      console.log("Lỗi khi update:", error);
      return null;
    }
  }

  async remove(id) {
    await Comment.findByIdAndDelete(id);
    return null;
  }
}

module.exports = new CommentService();
