"use strict";

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.sequelize.query(`
      ALTER TABLE users
        ADD COLUMN location VARCHAR(255) NULL AFTER linkedin_url,
        ADD COLUMN skills TEXT NULL AFTER location,
        ADD COLUMN badges JSON NULL AFTER skills,
        ADD COLUMN cover_image VARCHAR(255) NULL AFTER badges;
    `);
    },

    down: async (queryInterface, Sequelize) => {
        await Promise.all([
            queryInterface.removeColumn("users", "location"),
            queryInterface.removeColumn("users", "skills"),
            queryInterface.removeColumn("users", "badges"),
            queryInterface.removeColumn("users", "cover_image"),
        ]);
    },
};