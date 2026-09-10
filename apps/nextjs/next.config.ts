import path from "node:path";

import type { NextConfig } from "next";

// Validate the environment at build time rather than on the first request.
import "./src/env";

const config: NextConfig = {
  /**
   * Emit a self-contained server for the container image.
   *
   * Next traces the modules actually reached and copies them, plus a
   * `server.js`, into `.next/standalone`. That is what lets the runtime
   * stage carry no `node_modules`, no pnpm and no source — a few hundred
   * megabytes of difference, and nothing in the image that is not needed to
   * serve a request.
   */
  output: "standalone",

  /**
   * Tracing starts at the repo root, not this app.
   *
   * `node-linker=hoisted` puts every dependency in the root
   * `node_modules`, so a trace rooted here would miss all of them.
   */
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),

  /** Hot-reload workspace packages without a separate build step. */
  transpilePackages: ["@skill-passport/shared"],

  /** Typecheck runs as its own Turborepo task, but keep builds honest too. */
  typescript: { ignoreBuildErrors: false },

  serverExternalPackages: ["postgres"],
};

export default config;
