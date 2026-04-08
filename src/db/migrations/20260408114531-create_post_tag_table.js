"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable("post_tag", {
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
            tag_id: {
                type: Sequelize.INTEGER({ unsigned: true }),
                allowNull: false,
                references: {
                    model: "tags",
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
        await queryInterface.addIndex("post_tag", ["post_id", "tag_id"], {
            unique: true,
            name: "post_tag_post_id_tag_id_unique",
        });
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.dropTable("post_tag");
    },
};