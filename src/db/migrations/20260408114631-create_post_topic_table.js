"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable("post_topic", {
            id: {
                type: Sequelize.INTEGER({ unsigned: true }),
                autoIncrement: true,
                primaryKey: true,
            },
            post_id: {
                type: Sequelize.INTEGER({ unsigned: true }),
                allowNull: false,
                references: {
                    model: "posts",
                    key: "id",
                },
                onUpdate: "CASCADE",
                onDelete: "CASCADE",
            },
            topic_id: {
                type: Sequelize.INTEGER({ unsigned: true }),
                allowNull: false,
                references: {
                    model: "topics",
                    key: "id",
                },
                onUpdate: "CASCADE",
                onDelete: "CASCADE",
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
        await queryInterface.dropTable("post_topic");
    },
};