import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 120_000, // 2 min per test — these are real integration tests
    hookTimeout: 60_000, // 1 min for setup/teardown
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true }, // Sequential: all tests share one Redis
    },
    globals: true,
  },
});
