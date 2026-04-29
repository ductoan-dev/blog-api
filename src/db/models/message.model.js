module.exports = (sequelize, DataTypes) => {
  const messages = sequelize.define(
    "Message",
    {
      user_id: {
        type: DataTypes.INTEGER({ unsigned: true }),
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      conversation_id: {
        type: DataTypes.INTEGER({ unsigned: true }),
        allowNull: false,
        references: {
          model: "conversations",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      type: {
        type: DataTypes.STRING(50),
        defaultValue: "text",
      },
      content: {
        type: DataTypes.TEXT,
        defaultValue: null,
      },
      deleted_at: {
        type: DataTypes.DATE,
        defaultValue: null,
      },
    },
    {
      tableName: "messages",
      underscored: true,
      timestamps: true,
    }
  );

  messages.associate = (db) => {
    messages.belongsTo(db.User, {
      foreignKey: "user_id",
      as: "user",
    });

    messages.belongsTo(db.Conversation, {
      foreignKey: "conversation_id",
      as: "conversation",
    });
  };

  return messages;
};
