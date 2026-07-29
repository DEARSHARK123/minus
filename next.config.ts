import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Always the package directory containing this config — never the Cursor parent workspace. */
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: 'standalone',
  // load-skill.ts deliberately ignores dynamic tracing so an arbitrary skill
  // name cannot make Turbopack include the whole repository. Include the
  // bounded markdown directory explicitly for the chat API standalone bundle.
  outputFileTracingIncludes: {
    '/api/chat': ['./skills/**/*.md'],
  },
  poweredByHeader: false,
  reactStrictMode: true,
  compress: true,
  // Pin Turbopack to this package. process.cwd() fails when the IDE workspace is the parent folder.
  turbopack: {
    root: projectRoot,
    resolveAlias: {
      tailwindcss: path.join(projectRoot, "node_modules", "tailwindcss"),
    },
  },
  // Allow Playwright / agents hitting 127.0.0.1 while `next dev` binds as localhost.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  images: {
    unoptimized: true,
  },
  async headers() {
    const headers = [
      {
        key: 'X-Content-Type-Options',
        value: 'nosniff',
      },
      {
        key: 'Referrer-Policy',
        value: 'strict-origin-when-cross-origin',
      },
    ];
    // X-Frame-Options: DENY blocks iframe embedding, which local preview
    // surfaces (IDE / agent preview cards) rely on. Keep it in production only.
    if (process.env.NODE_ENV === 'production') {
      headers.unshift({
        key: 'X-Frame-Options',
        value: 'DENY',
      });
    }
    return [
      {
        source: '/:path*',
        headers,
      },
    ];
  },
};

export default nextConfig;
