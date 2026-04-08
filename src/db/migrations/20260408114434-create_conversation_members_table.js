"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable("user_conversation", {
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
            conversation_id: {
                type: Sequelize.INTEGER({ unsigned: true }),
                allowNull: false,
                references: {
                    model: "conversations",
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

        // Add composite unique constraint
        await queryInterface.addIndex(
            "user_conversation",
            ["user_id", "conversation_id"],
            {
                unique: true,
                name: "user_conversation_user_id_conversation_id_unique",
            }
        );
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.dropTable("user_conversation");
    },
};