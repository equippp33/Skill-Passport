import type { NextConfig } from "next";

// Validate the environment at build time rather than on the first request.
import "./src/env";

const config: NextConfig = {
  /** Hot-reload workspace packages without a separate build step. */
  transpilePackages: ["@skill-passport/shared"],

  /** Typecheck runs as its own Turborepo task, but keep builds honest too. */
  typescript: { ignoreBuildErrors: false },

  serverExternalPackages: ["postgres"],
};

export default config;
