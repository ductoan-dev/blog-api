"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable("queue", {
            id: {
                type: Sequelize.INTEGER({ unsigned: true }),
                autoIncrement: true,
                primaryKey: true,
            },
            type: {
                type: Sequelize.STRING,
                allowNull: false,
            },
            status: {
                type: Sequelize.STRING,
                defaultValue: "pending",
            },
            payload: {
                type: Sequelize.JSON,
                allowNull: false,
            },
            max_retries: {
                type: Sequelize.INTEGER,
                defaultValue: 5,
            },
            retries_count: {
                type: Sequelize.INTEGER,
                defaultValue: 0,
            },
            retried_at: {
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
        await queryInterface.dropTable("queue");
    },
};