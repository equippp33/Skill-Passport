import { fileURLToPath } from "node:url";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // See tests/stubs/server-only.ts
      "server-only": fileURLToPath(
        new URL("./tests/stubs/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    // Fills placeholder env vars BEFORE any module reads `~/env`, so tests
    // validate against the same contract as production. See tests/setup-env.ts.
    setupFiles: ["./tests/setup-env.ts"],
    include: ["tests/**/*.test.ts"],
    // Integration tests share one Postgres database; run files serially so
    // they cannot interleave writes.
    fileParallelism: false,
    // Integration tests hit Postgres, R2 and (via startAttempt) Sarvam TTS,
    // so the 5s default is too tight.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
