"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable("follows", {
            id: {
                type: Sequelize.INTEGER({ unsigned: true }),
                autoIncrement: true,
                primaryKey: true,
            },
            following_id: {
                type: Sequelize.INTEGER({ unsigned: true }),
                allowNull: false,
                references: {
                    model: "users",
                    key: "id",
                },
                onUpdate: "CASCADE",
                onDelete: "CASCADE",
            },
            followed_id: {
                type: Sequelize.INTEGER({ unsigned: true }),
                allowNull: false,
                references: {
                    model: "users",
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

        // Add composite unique constraint to prevent duplicate follows
        await queryInterface.addIndex(
            "follows",
            ["following_id", "followed_id"],
            {
                unique: true,
                name: "follows_following_id_followed_id_unique",
            }
        );
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.dropTable("follows");
    },
};