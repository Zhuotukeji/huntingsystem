import type { NextConfig } from "next";

const pdfWorkerFiles = ["node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"];

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["node:sqlite", "pdf-parse"],
  outputFileTracingIncludes: {
    "/api/resumes": pdfWorkerFiles,
    "/api/plugin/resumes": pdfWorkerFiles,
  },
};

export default nextConfig;
