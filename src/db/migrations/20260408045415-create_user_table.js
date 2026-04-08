"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("users", {
    id: {
      type: Sequelize.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
      },
      first_name: {
        type: Sequelize.STRING(50),
      },
      last_name: {
        type: Sequelize.STRING(50),
      },
      email: {
        type: Sequelize.STRING(50),
        unique: true,
        defaultValue: null,
      },
      password: {
        type: Sequelize.STRING(255),
        defaultValue: null,
      },
      two_factor_enabled: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
      },
      two_factor_secret: {
        type: Sequelize.STRING,
        defaultValue: null,
      },
      username: {
        type: Sequelize.STRING(50),
        unique: true,
      },
      avatar: {
        type: Sequelize.STRING(255),
        defaultValue: null,
      },
      title: {
        type: Sequelize.STRING(100),
      },
      about: {
        type: Sequelize.TEXT,
      },
      posts_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },
      follower_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },
      following_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },
      likes_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },
      address: {
        type: Sequelize.TEXT,
      },
      website_url: {
        type: Sequelize.STRING(255),
      },
      twitter_url: {
        type: Sequelize.STRING(255),
      },
      github_url: {
        type: Sequelize.STRING(255),
      },
      linkedin_url: {
        type: Sequelize.STRING(255),
      },
      verified_at: {
        type: Sequelize.DATE,
        defaultValue: null,
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
    await queryInterface.dropTable("users");
  },
};
