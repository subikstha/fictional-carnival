import type { NextConfig } from "next";
import withPWAInit from "next-pwa";

const withPWA = withPWAInit({
  dest: "public", // Service worker files will be generated in /public,
  register: true, // Automatically register the service worker
  skipWaiting: true, // Activates updated service workerr immediately
  disable: process.env.NODE_ENV === "development", // Disable PWA during development to avoid caching headaches
  // Workbox will inject these scripts at the top of public/sw.js
  importScripts: [
    "https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js",
    "https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js",
    "/firebase-messaging-sw.js",
  ],
});

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
};

export default withPWA(nextConfig);
