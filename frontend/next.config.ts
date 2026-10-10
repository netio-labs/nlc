import { execSync } from "node:child_process";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import pkg from "./package.json" with { type: "json" };

// Single source of truth for the displayed version is package.json's `version`;
// the git short SHA pins it to the exact build. Both are inlined at build time.
const gitSha = (() => {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "dev"; // no .git in the build context (e.g. some Docker builds)
  }
})();

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_GIT_SHA: gitSha,
  },
  allowedDevOrigins: ["172.31.8.228"],
  experimental: {
    // IOU images uploaded via the Images settings page (server action) can be
    // well over 100 MB — default Server Action body limit is 1 MB.
    serverActions: {
      bodySizeLimit: "400mb",
    },
    // Requests also pass through proxy.ts (auth check on every route), which
    // separately caps request bodies at 10 MB by default — without raising
    // this too, the upload body gets truncated before it reaches the action.
    proxyClientMaxBodySize: "400mb",
  },
};

export default createNextIntlPlugin("./i18n/request.ts")(nextConfig);
