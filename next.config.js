/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // llamaindex has native/node deps — keep it out of the bundler
    serverComponentsExternalPackages: ["llamaindex", "@llamaindex/openai"],
    // ship the contract files with the serverless function (needed on Vercel)
    outputFileTracingIncludes: {
      "/api/query": ["./data/contracts/**/*"],
    },
  },
};
module.exports = nextConfig;
