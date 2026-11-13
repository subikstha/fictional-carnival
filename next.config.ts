import type { NextConfig } from "next";
import withPWAInit from "next-pwa";

const withPWA = withPWAInit({
  dest: "public", // Service worker files will be generated in /public,
  register: true, // Automatically register the service worker
  skipWaiting: true, // Activates updated service workerr immediately
  disable: process.env.NODE_ENV === "development", // Disable PWA during development to avoid caching headaches
});

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withPWA(nextConfig);
