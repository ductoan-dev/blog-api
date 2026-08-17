const { defineConfig } = require("vitest/config");
const path = require("path");

module.exports = defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: [path.resolve(__dirname, "src/test/setup.js")],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
