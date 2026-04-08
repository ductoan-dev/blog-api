"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable("likes", {
            id: {
                type: Sequelize.INTEGER({ unsigned: true }),
                autoIncrement: true,
                primaryKey: true,
            },
            user_id: {
                type: Sequelize.INTEGER({ unsigned: true }),
                allowNull: false,
                references: {
                    model: "users",
                    key: "id",
                },
                onUpdate: "CASCADE",
                onDelete: "CASCADE",
            },
            likeable_type: {
                type: Sequelize.STRING(50),
                allowNull: false,
            },
            likeable_id: {
                type: Sequelize.INTEGER({ unsigned: true }),
                allowNull: false,
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

        // Add composite unique constraint to prevent duplicate likes
        await queryInterface.addIndex(
            "likes",
            ["user_id", "likeable_type", "likeable_id"],
            {
                unique: true,
                name: "likes_user_id_likeable_type_likeable_id_unique",
            }
        );
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.dropTable("likes");
    },
};