"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable("topics", {
            id: {
                type: Sequelize.INTEGER({ unsigned: true }),
                autoIncrement: true,
                primaryKey: true,
            },
            name: {
                type: Sequelize.STRING(150),
                allowNull: false,
            },
            slug: {
                type: Sequelize.STRING(255),
                unique: true,
                allowNull: false,
            },
            image: {
                type: Sequelize.STRING(255),
                defaultValue: null,
            },
            description: {
                type: Sequelize.TEXT,
                defaultValue: null,
            },
            posts_count: {
                type: Sequelize.INTEGER,
                defaultValue: 0,
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
        await queryInterface.dropTable("topics");
    },
};