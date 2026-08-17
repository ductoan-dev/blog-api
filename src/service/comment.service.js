const prisma = require("@/db/prisma");
const likesService = require("@/service/like.service");
const emitter = require("@/utils/emitter");
const notificationService = require("@/service/notification.service");
const { serializeComment } = require("@/utils/serializers");

const USER_SELECT = {
  id: true, avatar: true, firstName: true, lastName: true, email: true, username: true, fullname: true,
};

class CommentService {
  async getAll() {
    return prisma.comment.findMany();
  }

  async getById(id) {
    return prisma.comment.findUnique({ where: { id }, include: { post: true } });
  }

  async getBySlug(slug) {
    const post = await prisma.post.findUnique({ where: { slug } });
    if (!post) return null;
    return prisma.comment.findMany({ where: { postId: post.id }, include: { post: true } });
  }

  async getAllCommentsInPost(postId, currentUser) {
    const comments = await prisma.comment.findMany({
      where: { postId, deletedAt: null, parentId: null },
      include: { user: { select: USER_SELECT } },
    });

    const replies = await prisma.comment.findMany({
      where: { postId, deletedAt: null, parentId: { not: null } },
      include: { user: { select: USER_SELECT } },
    });

    const replyMap = {};
    replies.forEach((r) => {
      if (!replyMap[r.parentId]) replyMap[r.parentId] = [];
      replyMap[r.parentId].push(r);
    });

    const commentsWithReplies = comments.map((c) => ({
      ...c,
      replies: replyMap[c.id] || [],
    }));

    return this.likeCommentFlags(commentsWithReplies, currentUser);
  }

  likeCommentFlags = async (comments, currentUser) => {
    const allComments = [];
    comments.forEach((comment) => {
      allComments.push(comment);
      if (comment.replies && comment.replies.length > 0) {
        allComments.push(...comment.replies);
      }
    });

    let currentUserLikes = new Set();
    if (currentUser) {
      const commentIds = allComments.map((c) => c.id);
      const likes = await likesService.getAll("Comment", commentIds);
      likes.forEach((like) => {
        if (like.userId === currentUser.id) {
          currentUserLikes.add(like.likeableId);
        }
      });
    }

    return comments.map((comment) => {
      const withFlag = {
        ...comment,
        is_like: currentUserLikes.has(comment.id),
      };
      if (withFlag.replies && withFlag.replies.length > 0) {
        withFlag.replies = withFlag.replies.map((reply) => ({
          ...reply,
          is_like: currentUserLikes.has(reply.id),
        }));
      }
      return serializeComment(withFlag);
    });
  };

  async toggleLike(currentUser, commentId) {
    if (!currentUser)
      throw new Error("You must be logged in to like this post.");

    const existing = await prisma.like.findFirst({
      where: { likeableId: commentId, userId: currentUser.id, likeableType: "Comment" },
    });

    const comment = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment) throw new Error("Comment not found");

    if (existing) {
      await prisma.like.delete({ where: { id: existing.id } });
      await prisma.comment.update({
        where: { id: commentId },
        data: { likeCount: Math.max(0, comment.likeCount - 1) },
      });
      return false;
    }

    await prisma.like.create({
      data: { likeableId: commentId, userId: currentUser.id, likeableType: "Comment" },
    });
    await prisma.comment.update({
      where: { id: commentId },
      data: { likeCount: comment.likeCount + 1 },
    });
    return true;
  }

  async create(currentUser, data) {
    if (!currentUser) throw new Error("Bạn phải đăng nhập để comment");

    let parentId = data.parent_id || null;
    let currentPost = null;

    try {
      currentPost = await prisma.post.findUnique({ where: { id: data.post_id } });
      if (currentPost) {
        const userPost = await prisma.user.findUnique({
          where: { id: currentPost.userId },
          include: { setting: true },
        });
        const settings = userPost?.setting?.data || {};

        if (settings.allowComments === false) {
          throw new Error("Bạn không thể comment bài post này");
        }
      }
    } catch (error) {
      throw new Error(error.message);
    }

    if (parentId) {
      const parentComment = await prisma.comment.findUnique({ where: { id: parentId } });
      if (!parentComment) throw new Error("Parent not found");
      if (parentComment.parentId) {
        parentId = parentComment.parentId;
      }
    }

    const comment = await prisma.comment.create({
      data: {
        postId: data.post_id,
        content: data.content,
        parentId,
        userId: currentUser.id,
      },
    });

    const populated = await prisma.comment.findUnique({
      where: { id: comment.id },
      include: { user: { select: USER_SELECT } },
    });

    const result = serializeComment({ ...populated, replies: [] });

    try {
      if (currentPost) {
        const userPost = await prisma.user.findUnique({
          where: { id: currentPost.userId },
          include: { setting: true },
        });
        const settings = userPost?.setting?.data || {};
        if (userPost.id !== currentUser.id && settings.emailNewComments) {
          await prisma.queue.create({
            data: {
              type: "sendNewCommentJob",
              payload: {
                userPostId: userPost.id,
                userCommetnId: currentUser.id,
                content: data.content,
                post: currentPost,
              },
            },
          });
        }

        if (userPost.id !== currentUser.id) {
          const commenterName =
            currentUser.fullname ||
            [currentUser.firstName, currentUser.lastName].filter(Boolean).join(" ") ||
            currentUser.username;
          const notifTitle = parentId
            ? `${commenterName} đã trả lời bình luận trong bài viết của bạn`
            : `${commenterName} đã bình luận về bài viết của bạn`;
          const notif = await notificationService.create({
            userId: userPost.id,
            type: "comment",
            title: notifTitle,
            notifiableType: "Post",
            notifiableId: currentPost.id,
            messageLink: `/blog/${currentPost.slug}`,
          });
          emitter.emit("notification:post_comment", {
            toUserId: userPost.id,
            notification: notif,
          });
        }
      }
    } catch (error) {
      console.log(error);
    }

    if (data.parent_id) {
      try {
        const parentComment = await prisma.comment.findUnique({
          where: { id: data.parent_id },
          include: { user: { select: { id: true, fullname: true, firstName: true, lastName: true, username: true } } },
        });
        if (parentComment?.user) {
          const parentAuthorId = parentComment.user.id;
          const postAuthorId = currentPost?.userId || "";
          if (parentAuthorId !== currentUser.id && parentAuthorId !== postAuthorId) {
            const commenterName =
              currentUser.fullname ||
              [currentUser.firstName, currentUser.lastName].filter(Boolean).join(" ") ||
              currentUser.username;
            const notif = await notificationService.create({
              userId: parentComment.user.id,
              type: "comment",
              title: `${commenterName} đã trả lời bình luận của bạn`,
              notifiableType: "Post",
              notifiableId: currentPost.id,
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

  async update(id) {
    try {
      const comment = await prisma.comment.findUnique({ where: { id } });

      if (!comment) return null;
      if (comment.deletedAt) return null;

      return prisma.comment.update({ where: { id }, data: { deletedAt: new Date() } });
    } catch (error) {
      console.log("Lỗi khi update:", error);
      return null;
    }
  }

  async remove(id) {
    await prisma.comment.delete({ where: { id } });
    return null;
  }
}

module.exports = new CommentService();
