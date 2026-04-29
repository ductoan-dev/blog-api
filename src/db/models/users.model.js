module.exports = (sequelize, DataTypes) => {
  const user = sequelize.define(
    "User",
    {
      first_name: {
        type: DataTypes.STRING,
      },
      last_name: {
        type: DataTypes.STRING,
      },
      email: {
        type: DataTypes.STRING,
        unique: true,
        defaultValue: null,
      },
      password: {
        type: DataTypes.STRING,
        defaultValue: null,
      },
      two_factor_enabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      two_factor_secret: {
        type: DataTypes.STRING,
        defaultValue: null,
      },
      username: {
        type: DataTypes.STRING,
        unique: true,
      },
      fullname: {
        type: DataTypes.STRING,
      },

      avatar: {
        type: DataTypes.STRING,
        defaultValue: null,
      },
      title: {
        type: DataTypes.STRING,
      },
      about: {
        type: DataTypes.TEXT,
      },
      posts_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      follower_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      following_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      likes_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      address: {
        type: DataTypes.TEXT,
      },
      website_url: {
        type: DataTypes.STRING,
      },
      twitter_url: {
        type: DataTypes.STRING,
      },
      github_url: {
        type: DataTypes.STRING,
      },
      linkedin_url: {
        type: DataTypes.STRING,
      },
      verified_at: {
        type: DataTypes.DATE,
        defaultValue: null,
      },

      location: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      skills: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      badges: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      cover_image: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      tableName: "users",
      underscored: true,
      timestamps: true,
    }
  );

  user.associate = (db) => {
    user.hasMany(db.Post, {
      foreignKey: "user_id",
      as: "posts",
    });
    user.hasMany(db.Comment, {
      foreignKey: "user_id",
      as: "comments",
    });

    user.hasMany(db.Message, {
      foreignKey: "sender_id",
      as: "messages",
    });
    user.hasMany(db.Conversation, {
      foreignKey: "created_by",
      as: "conversations",
    });

    user.hasMany(db.Like, {
      foreignKey: "user_id",
      as: "likes",
    });

    user.belongsToMany(db.Post, {
      through: "bookmarks",
      foreignKey: "user_id",
      otherKey: "post_id",
      as: "bookmarkedPosts",
    });

    user.belongsToMany(db.User, {
      through: "follows",
      as: "following",
      foreignKey: "following_id",
      otherKey: "followed_id",
    });

    user.belongsToMany(db.User, {
      through: "follows",
      as: "followers",
      foreignKey: "followed_id",
      otherKey: "following_id",
    });
    user.hasOne(db.UserSetting, {
      foreignKey: "user_id",
      as: "settings",
    });
  };

  return user;
};
