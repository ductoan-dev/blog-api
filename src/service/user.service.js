const { User, Queue, Follow } = require("@/db/models");
const emitter = require("@/utils/emitter");
const notificationService = require("@/service/notification.service");

const isEmail = (value) =>
  typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

class UserService {
  async getAllUser() {
    return await User.find();
  }

  async getUserById(id) {
    return await User.findById(id);
  }

  canUserViewProfile(currentUser, targetUser, followerIds = []) {
    const profileVisibility = this.getUserProfileVisibility(targetUser);

    if (!currentUser) {
      return { canView: profileVisibility === "public", type: profileVisibility };
    }

    if (targetUser._id.toString() === currentUser._id.toString()) {
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
    try {
      if (user.settings && user.settings.data) {
        const settingsData = JSON.parse(user.settings.data);
        return settingsData.profileVisibility || "public";
      }
      return "public";
    } catch (error) {
      console.log("Error parsing user settings:", error);
      return "public";
    }
  }

  async getUserFollowingIds(currentUser) {
    try {
      if (!currentUser) return [];
      const follows = await Follow.find({ follower_id: currentUser._id }).select("following_id");
      return follows.map((f) => f.following_id.toString());
    } catch (error) {
      console.log(error);
      return [];
    }
  }

  async getUserByUsername(username, currentUser = null) {
    try {
      const user = await User.findOne({ username });

      if (!user) throw new Error("User does not exist");

      const followerDocs = await Follow.find({ following_id: user._id }).select("follower_id");
      const followerIds = followerDocs.map((f) => f.follower_id.toString());

      const result = this.canUserViewProfile(currentUser, user, followerIds);

      if (!result.canView) {
        return {
          id: user.id,
          username: user.username,
          title: user.title,
          avatar: user.avatar,
          canView: false,
          type: result.type,
          follower_count: user.follower_count,
          following_count: user.following_count,
        };
      }

      return user;
    } catch (error) {
      throw error;
    }
  }

  async toggleFollow(currentUser, userId) {
    if (!currentUser) throw new Error("Bạn phải đăng nhập để follow");
    if (currentUser._id.toString() === userId.toString())
      throw new Error("You cannot follow yourself");

    const userFollowing = await User.findById(currentUser._id);
    const userFollower = await User.findById(userId);

    if (!userFollower) throw new Error("User not found");

    const existingFollow = await Follow.findOne({
      follower_id: currentUser._id,
      following_id: userId,
    });

    if (existingFollow) {
      await existingFollow.deleteOne();
      userFollowing.following_count = Math.max(0, (userFollowing.following_count ?? 0) - 1);
      userFollower.follower_count = Math.max(0, (userFollower.follower_count ?? 0) - 1);
      await userFollower.save();
      await userFollowing.save();
      return false;
    }

    await Follow.create({ follower_id: currentUser._id, following_id: userId });
    userFollower.follower_count = (userFollower.follower_count ?? 0) + 1;
    userFollowing.following_count = (userFollowing.following_count ?? 0) + 1;
    await userFollower.save();
    await userFollowing.save();

    // Create follow notification for the person being followed (userFollower)
    try {
      const followerName = userFollowing.fullname ||
        [userFollowing.first_name, userFollowing.last_name].filter(Boolean).join(" ") ||
        userFollowing.username;
      const notif = await notificationService.create({
        userId: userFollower._id,
        type: "follow",
        title: `${followerName} đã theo dõi bạn`,
        notifiableType: "User",
        notifiableId: userFollowing._id,
        messageLink: `/profile/${userFollowing.username}`,
      });
      emitter.emit("notification:follow", { toUserId: userFollower._id.toString(), notification: notif });
    } catch (error) {
      console.log("Follow notification error:", error);
    }

    try {
      const settings = userFollower.settings?.data
        ? JSON.parse(userFollower.settings.data)
        : {};
      if (settings.emailNewFollowers) {
        await Queue.create({
          type: "sendNewFollowerJob",
          payload: { following: userFollower.toObject(), follower: userFollowing.toObject() },
        });
      }
    } catch (error) {
      console.log(error);
    }

    return true;
  }

  async getFollowersList(userId) {
    const follows = await Follow.find({ following_id: userId })
      .populate("follower_id", "id _id username fullname first_name last_name avatar title")
      .lean();
    return follows.map((f) => ({ ...f.follower_id, id: f.follower_id._id.toString() }));
  }

  async getFollowingList(userId) {
    const follows = await Follow.find({ follower_id: userId })
      .populate("following_id", "id _id username fullname first_name last_name avatar title")
      .lean();
    return follows.map((f) => ({ ...f.following_id, id: f.following_id._id.toString() }));
  }

  async checkFollowing(currentUser, userId) {
    if (!currentUser) throw new Error("Bạn phải đăng nhập để follow");

    const follow = await Follow.findOne({
      follower_id: currentUser._id,
      following_id: userId,
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
      updateData.cover_image = avatarOrCoverPath.cover_image[0].path.replace(/\\/g, "/");
    }

    const newData = { ...updateData, ...data };

    try {
      return await User.findByIdAndUpdate(currentUser._id, newData, { new: true });
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
      await User.findByIdAndUpdate(currentUser._id, { verified_at: null, email });

      await Queue.create({
        type: "sendVerifyEmailJob",
        payload: { userId: currentUser._id.toString() },
      });
    }

    await User.findByIdAndUpdate(currentUser._id, {
      settings: { data: JSON.stringify(settings) },
    });
  }

  async search(query) {
    const regex = new RegExp(query, "i");
    const users = await User.find({
      $or: [
        { username: regex },
        { fullname: regex },
        { first_name: regex },
        { last_name: regex },
      ],
    })
      .select("id avatar username fullname first_name last_name title")
      .lean();

    return users.map((u) => ({ ...u, id: u._id.toString() }));
  }
}

module.exports = new UserService();
