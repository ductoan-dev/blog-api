const {
  Post,
  Topic,
  Comment,
  User,
  UserSetting,
  Queue,
  Sequelize,
} = require("@/db/models");

class UserService {
  async getAllUser() {
    const user = await User.findAll();
    return user;
  }
  async getUserById(id) {
    const user = await User.findOne({ where: { id } });
    return user;
  }
  async canUserViewProfile(currentUser, targetUser, followingIds = []) {
    const profileVisibility = this.getUserProfileVisibility(targetUser);

    if (!currentUser) {
      return {
        canView: profileVisibility === "public",
        type: profileVisibility,
      };
    }

    if (targetUser.id === currentUser.id) {
      return {
        canView: true,
        type: "self",
      };
    }

    if (profileVisibility === "public") {
      return {
        canView: true,
        type: "public",
      };
    }

    if (profileVisibility === "followers") {
      return {
        canView: followingIds.includes(currentUser.id),
        type: "followers",
      };
    }

    if (profileVisibility === "private") {
      return {
        canView: false,
        type: "private",
      };
    }

    return {
      canView: false,
      type: "unknown",
    };
  }
  async getUserProfileVisibility(user) {
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

      const userFollowing = await User.findByPk(currentUser.id, {
        include: {
          model: User,
          as: "following",
          attributes: ["id"],
          through: { attributes: [] },
        },
      });

      if (!userFollowing || !userFollowing.following) {
        return [];
      }

      const ids = userFollowing.following.map((item) => item.id);
      return ids;
    } catch (error) {
      console.log(error);
      return [];
    }
  }

  async getUserByUsername(username, currentUser = null) {
    try {
      const user = await User.findOne({
        where: {
          username,
        },
        include: [
          {
            model: UserSetting,
            as: "settings",
            required: false,
          },
          {
            model: User,
            as: "followers",
            attributes: ["id"],
          },
        ],
      });

      if (!user) {
        throw new Error("User does not exist");
      }

      const followerIds = user?.followers.map((item) => item.id);

      const result = this.canUserViewProfile(currentUser, user, followerIds);

      if (!result.canView) {
        console.log(result);

        return {
          id: user.id,
          username: user.username,
          title: user.title,
          avatar: user.avatar,
          // fullname: user.fullname,
          canView: false,
          type: result.type,
          follower_count: user.follower_count,
          following_count: user.following_count,
        };
      }

      // Trả về user data nếu có quyền xem
      return user;
    } catch (error) {
      throw error;
    }
  }

  async toggleFollow(currentUser, userId) {
    if (!currentUser) throw new Error("Bạn phải đăng nhập để follow");
    if (currentUser.id === userId)
      throw new Error("You cannot follow yourself");

    const userFollowing = await User.findOne({
      where: { id: currentUser.id },
    });
    const userFollower = await User.findOne({
      where: { id: userId },
      include: {
        model: UserSetting,
        as: "settings",
        require: false,
      },
    });
    const hasFollowingUser = await currentUser.hasFollowing(userId);
    if (hasFollowingUser) {
      userFollowing.following_count = Math.max(
        0,
        (userFollowing.following_count ?? 0) - 1
      );
      userFollower.follower_count = Math.max(
        0,
        (userFollower.follower_count ?? 0) - 1
      );
      await userFollower.save();
      await userFollowing.save();
      return await currentUser.removeFollowing(userId);
    } else {
      userFollower.follower_count = userFollower.follower_count + 1;
      userFollowing.following_count = userFollowing.following_count + 1;
      await userFollower.save();
      await userFollowing.save();
      try {
        const settings = JSON.parse(userFollower.settings.data);
        if (settings.emailNewFollowers) {
          await Queue.create({
            type: "sendNewFollowerJob",
            payload: {
              following: userFollower,
              follower: userFollowing,
            },
          });
        }
      } catch (error) {
        console.log(error);
      }
      return await currentUser.addFollowing(userId);
    }
  }

  async checkFollowing(currentUser, userId) {
    if (!currentUser) throw new Error("Bạn phải đăng nhập để follow");

    const userFollows = await User.findAll({
      where: { id: userId },
      include: [
        {
          model: User,
          as: "followers",
          where: { id: currentUser.id },
        },
      ],
    });
    if (userFollows.length === 0) return false;

    return true;
  }

  async editProfile(avatarOrCoverPath, data, currentUser) {
    if (!currentUser) throw new Error("You must be logged to edit");

    const updateData = {};

    // Nếu có file mới thì cập nhật, không thì bỏ qua
    if (avatarOrCoverPath?.avatar?.[0]?.path) {
      updateData.avatar = avatarOrCoverPath.avatar[0].path.replace(/\\/g, "/");
    }
    if (avatarOrCoverPath?.cover_image?.[0]?.path) {
      updateData.cover_image = avatarOrCoverPath.cover_image[0].path.replace(
        /\\/g,
        "/"
      );
    }

    const newData = { ...updateData, ...data };

    try {
      return await currentUser.update(newData);
    } catch (error) {
      throw new Error(error);
    }
  }

  async setting(data, currentUser) {
    if (!currentUser) throw new Error("You must be logged to edit settings");
    const { email, ...settings } = data;
    if (email !== currentUser.email) {
      if (email && !validator.isEmail(email)) {
        throw new Error("Invalid email address");
      }
      await currentUser.update({ verified_at: null, email });

      await Queue.create({
        type: "sendVerifyEmailJob",
        payload: { userId: currentUser.id },
      });
    }
    const user = await UserSetting.findOne({
      where: {
        user_id: currentUser.id,
      },
    });
    if (user) {
      user.data = JSON.stringify(settings);
      await user.save();
    } else {
      await UserSetting.create({
        user_id: currentUser.id,
        data: JSON.stringify(settings),
      });
    }
  }
}

module.exports = new UserService();
