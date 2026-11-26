const { defineConfig } = require("vitest/config");
const path = require("node:path");

module.exports = defineConfig({
  test: {
    globals: true, environment: "node", fileParallelism: false,
    include: ["src/**/__tests__/ai*.test.js"],
    setupFiles: [path.resolve(__dirname, "src/test/aiSetup.js")],
    testTimeout: 20000, hookTimeout: 20000,
  },
});
