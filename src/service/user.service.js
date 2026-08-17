const prisma = require("@/db/prisma");
const emitter = require("@/utils/emitter");
const notificationService = require("@/service/notification.service");
const { serializeUser } = require("@/utils/serializers");

const isEmail = (value) =>
  typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

class UserService {
  async getAllUser() {
    return prisma.user.findMany();
  }

  async getUserById(id) {
    return prisma.user.findUnique({ where: { id } });
  }

  canUserViewProfile(currentUser, targetUser, followerIds = []) {
    const profileVisibility = this.getUserProfileVisibility(targetUser);

    if (!currentUser) {
      return { canView: profileVisibility === "public", type: profileVisibility };
    }

    if (targetUser.id === currentUser.id) {
      return { canView: true, type: "self" };
    }

    if (profileVisibility === "public") {
      return { canView: true, type: "public" };
    }

    if (profileVisibility === "followers") {
      return {
        canView: followerIds.includes(currentUser.id),
        type: "followers",
      };
    }

    if (profileVisibility === "private") {
      return { canView: false, type: "private" };
    }

    return { canView: false, type: "unknown" };
  }

  getUserProfileVisibility(user) {
    return user.setting?.data?.profileVisibility || "public";
  }

  async getUserFollowingIds(currentUser) {
    if (!currentUser) return [];
    try {
      const follows = await prisma.follow.findMany({
        where: { followerId: currentUser.id },
        select: { followingId: true },
      });
      return follows.map((f) => f.followingId);
    } catch (error) {
      console.log(error);
      return [];
    }
  }

  async getUserByUsername(username, currentUser = null) {
    const user = await prisma.user.findUnique({
      where: { username },
      include: { setting: true },
    });

    if (!user) throw new Error("User does not exist");

    const followerDocs = await prisma.follow.findMany({
      where: { followingId: user.id },
      select: { followerId: true },
    });
    const followerIds = followerDocs.map((f) => f.followerId);

    const result = this.canUserViewProfile(currentUser, user, followerIds);

    if (!result.canView) {
      return {
        id: user.id,
        username: user.username,
        title: user.title,
        avatar: user.avatar,
        canView: false,
        type: result.type,
        follower_count: user.followerCount,
        following_count: user.followingCount,
      };
    }

    return serializeUser(user);
  }

  async toggleFollow(currentUser, userId) {
    if (!currentUser) throw new Error("Bạn phải đăng nhập để follow");
    if (currentUser.id === userId) throw new Error("You cannot follow yourself");

    const userFollower = await prisma.user.findUnique({
      where: { id: userId },
      include: { setting: true },
    });
    if (!userFollower) throw new Error("User not found");

    const existingFollow = await prisma.follow.findFirst({
      where: { followerId: currentUser.id, followingId: userId },
    });

    if (existingFollow) {
      await prisma.follow.delete({ where: { id: existingFollow.id } });
      await prisma.user.update({
        where: { id: currentUser.id },
        data: { followingCount: { decrement: 1 } },
      });
      await prisma.user.update({
        where: { id: userId },
        data: { followerCount: { decrement: 1 } },
      });
      return false;
    }

    await prisma.follow.create({ data: { followerId: currentUser.id, followingId: userId } });
    await prisma.user.update({
      where: { id: userId },
      data: { followerCount: { increment: 1 } },
    });
    await prisma.user.update({
      where: { id: currentUser.id },
      data: { followingCount: { increment: 1 } },
    });

    try {
      const followerName =
        currentUser.fullname ||
        [currentUser.firstName, currentUser.lastName].filter(Boolean).join(" ") ||
        currentUser.username;
      const notif = await notificationService.create({
        userId: userFollower.id,
        type: "follow",
        title: `${followerName} đã theo dõi bạn`,
        notifiableType: "User",
        notifiableId: currentUser.id,
        messageLink: `/profile/${currentUser.username}`,
      });
      emitter.emit("notification:follow", { toUserId: userFollower.id, notification: notif });
    } catch (error) {
      console.log("Follow notification error:", error);
    }

    try {
      if (userFollower.setting?.data?.emailNewFollowers) {
        await prisma.queue.create({
          data: {
            type: "sendNewFollowerJob",
            payload: { followingId: userFollower.id, followerId: currentUser.id },
          },
        });
      }
    } catch (error) {
      console.log(error);
    }

    return true;
  }

  async getFollowersList(userId) {
    const follows = await prisma.follow.findMany({
      where: { followingId: userId },
      include: { follower: true },
    });
    return follows.map((f) => serializeUser(f.follower));
  }

  async getFollowingList(userId) {
    const follows = await prisma.follow.findMany({
      where: { followerId: userId },
      include: { following: true },
    });
    return follows.map((f) => serializeUser(f.following));
  }

  async checkFollowing(currentUser, userId) {
    if (!currentUser) throw new Error("Bạn phải đăng nhập để follow");

    const follow = await prisma.follow.findFirst({
      where: { followerId: currentUser.id, followingId: userId },
    });

    return !!follow;
  }

  async editProfile(avatarOrCoverPath, data, currentUser) {
    if (!currentUser) throw new Error("You must be logged to edit");

    const updateData = {};

    if (avatarOrCoverPath?.avatar?.[0]?.path) {
      updateData.avatar = avatarOrCoverPath.avatar[0].path.replace(/\\/g, "/");
    }
    if (avatarOrCoverPath?.cover_image?.[0]?.path) {
      updateData.coverImage = avatarOrCoverPath.cover_image[0].path.replace(/\\/g, "/");
    }

    // Prisma throws on unknown keys (unlike Mongoose, which silently drops
    // fields with no matching schema path) — map explicitly instead of
    // spreading the raw multipart body.
    const allowedFields = {
      fullname: "fullname",
      first_name: "firstName",
      last_name: "lastName",
      username: "username",
      title: "title",
      about: "about",
      location: "location",
      address: "address",
      website_url: "websiteUrl",
      twitter_url: "twitterUrl",
      github_url: "githubUrl",
      linkedin_url: "linkedinUrl",
      skills: "skills",
    };

    for (const [bodyKey, prismaField] of Object.entries(allowedFields)) {
      if (data[bodyKey] !== undefined) {
        updateData[prismaField] = data[bodyKey];
      }
    }

    try {
      const updated = await prisma.user.update({ where: { id: currentUser.id }, data: updateData });
      return serializeUser(updated);
    } catch (error) {
      throw new Error(error);
    }
  }

  async setting(data, currentUser) {
    if (!currentUser) throw new Error("You must be logged to edit settings");
    const { email, ...settings } = data;

    if (email !== currentUser.email) {
      if (email && !isEmail(email)) {
        throw new Error("Invalid email address");
      }
      await prisma.user.update({
        where: { id: currentUser.id },
        data: { verifiedAt: null, email },
      });

      await prisma.queue.create({
        data: {
          type: "sendVerifyEmailJob",
          payload: { userId: currentUser.id },
        },
      });
    }

    await prisma.userSetting.upsert({
      where: { userId: currentUser.id },
      create: { userId: currentUser.id, data: settings },
      update: { data: settings },
    });
  }

  async search(query) {
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { username: { contains: query, mode: "insensitive" } },
          { fullname: { contains: query, mode: "insensitive" } },
          { firstName: { contains: query, mode: "insensitive" } },
          { lastName: { contains: query, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        avatar: true,
        username: true,
        fullname: true,
        firstName: true,
        lastName: true,
        title: true,
      },
    });
    return users.map(serializeUser);
  }
}

module.exports = new UserService();
