import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

// Cache Components is intentionally not enabled. This app renders live,
// mutable, per-request state (an in-memory store plus a role cookie), so every
// page and route handler is dynamic. See docs/design.md.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Do not let `next dev` generate tool-specific instruction files in this repo.
  agentRules: false,
  turbopack: {
    // Pin the workspace root to this directory so a lockfile in a parent
    // directory can never be mistaken for this project's.
    root: projectRoot,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
