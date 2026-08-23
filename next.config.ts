import type { NextConfig } from "next";

const pdfWorkerFiles = ["node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"];

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: "standalone",
  serverExternalPackages: ["node:sqlite", "pdf-parse", "pg"],
  outputFileTracingIncludes: {
    "/api/resumes": pdfWorkerFiles,
    "/api/plugin/resumes": pdfWorkerFiles,
  },
  outputFileTracingExcludes: {
    "/*": [".data/**/*"],
  },
};

export default nextConfig;
