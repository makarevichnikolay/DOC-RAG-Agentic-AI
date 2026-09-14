/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // native/node-heavy deps — keep them out of the bundler, run from node_modules
    serverComponentsExternalPackages: [
      "llamaindex",
      "@llamaindex/openai",
      "@llamaindex/voyage-ai",
      "openai",
      "@anthropic-ai/sdk",
      "pg",
      "pgvector",
      "@huggingface/transformers",
      "unpdf",
      "pdf-to-img",
      "tesseract.js",
    ],
    // ship the contract files with the serverless functions (needed on Vercel)
    outputFileTracingIncludes: {
      "/api/query": ["./data/**/*"],
      "/api/portfolio": ["./data/**/*"],
      "/api/document": ["./data/**/*"],
      "/api/ingest": ["./data/**/*"],
    },
  },
};
module.exports = nextConfig;
