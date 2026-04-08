module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.addColumn("users", "fullname", {
            type: Sequelize.STRING,
            allowNull: true,
            after: "username",
        });
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.removeColumn("users", "fullname");
    },
};