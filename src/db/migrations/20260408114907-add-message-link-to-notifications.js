"use strict";

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.addColumn("notifications", "message", {
            type: Sequelize.TEXT,
            allowNull: true,
            defaultValue: null,
            after: "title",
        });

        await queryInterface.addColumn("notifications", "link", {
            type: Sequelize.STRING(255),
            allowNull: true,
            defaultValue: null,
            after: "message",
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.removeColumn("notifications", "message");
        await queryInterface.removeColumn("notifications", "link");
    },
};