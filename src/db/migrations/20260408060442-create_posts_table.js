"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("posts", {
      id: {
        type: Sequelize.INTEGER.UNSIGNED, // ✅ sửa
        autoIncrement: true,
        primaryKey: true,
      },
      user_id: {
        type: Sequelize.INTEGER.UNSIGNED, // ✅ sửa
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      title: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      slug: {
        type: Sequelize.STRING(255),
        unique: true,
        allowNull: false,
      },
      thumbnail: {
        type: Sequelize.STRING(255),
        defaultValue: null,
      },
      description: {
        type: Sequelize.TEXT,
        defaultValue: null,
      },
      meta_title: {
        type: Sequelize.STRING(255),
        defaultValue: null,
      },
      meta_description: {
        type: Sequelize.TEXT,
        defaultValue: null,
      },
      content: {
        type: Sequelize.TEXT,
        defaultValue: null,
      },
      status: {
        type: Sequelize.STRING(50),
        defaultValue: "draft",
      },
      visibility: {
        type: Sequelize.STRING(50),
        defaultValue: "public",
      },
      views_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },
      likes_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },
      published_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW,
      },
      created_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW,
      },
      updated_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW,
      },
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable("posts");
  },
};
