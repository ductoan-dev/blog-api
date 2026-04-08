"use strict";

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.addColumn("comments", "edited_at", {
            type: Sequelize.DATE,
            allowNull: true,
            after: "deleted_at",
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.removeColumn("comments", "edited_at");
    },
};