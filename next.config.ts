import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Embedded Postgres for local development; loaded at runtime, not bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  experimental: {
    serverActions: {
      // Supplier sheets and screenshots are uploaded through a Server Action.
      bodySizeLimit: "4mb",
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
