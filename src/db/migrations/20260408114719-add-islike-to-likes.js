"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn("likes", "is_like", {
            type: Sequelize.BOOLEAN,
            defaultValue: false,
            after: "likeable_id",
        });
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.removeColumn("likes", "is_like");
    },
};