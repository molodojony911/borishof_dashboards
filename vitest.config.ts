import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // Пустая папка: Vitest не подмешивает корневые .env и .env.local в process.env.
  envDir: path.resolve(__dirname, "tests/hermetic-env"),
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    pool: "forks"
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  }
});
