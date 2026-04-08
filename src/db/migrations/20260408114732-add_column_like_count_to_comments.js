"use strict";

module.exports = {
    up: async (queryInterface, Sequelize) => {
        return queryInterface.addColumn("comments", "like_count", {
            type: Sequelize.INTEGER,
            allowNull: false,
            defaultValue: 0,
            after: "content",
        });
    },

    down: async (queryInterface, Sequelize) => {
        return queryInterface.removeColumn("comments", "like_count");
    },
};