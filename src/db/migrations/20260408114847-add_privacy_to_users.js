"use strict";

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.addColumn("users", "privacy", {
            type: Sequelize.JSON,
            allowNull: true,
            after: "skills",
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.removeColumn("users", "privacy");
    },
};