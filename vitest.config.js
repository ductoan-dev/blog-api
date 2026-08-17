const { defineConfig } = require("vitest/config");
const path = require("path");

module.exports = defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: [path.resolve(__dirname, "src/test/setup.js")],
    testTimeout: 20000,
    hookTimeout: 20000,
    // All integration test files share one real Postgres database and use a
    // TRUNCATE-based resetDb() in beforeEach. Vitest's default is to run
    // test files concurrently in separate workers, which races multiple
    // files' truncates/inserts against each other and throws spurious FK /
    // unique-constraint errors. Running files sequentially in one process
    // keeps each file's beforeEach/test/afterEach cycle isolated in time.
    fileParallelism: false,
  },
});
