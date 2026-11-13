declare module "next-pwa" {
  import type { NextConfig } from "next";

  export interface PWAConfig {
    dest?: string;
    disable?: boolean;
    register?: boolean;
    scope?: string;
    sw?: string;
    skipWaiting?: boolean;
    clientsClaim?: boolean;
    cleanupOutdatedCaches?: boolean;
    cacheOnFrontEndNav?: boolean;
    readOnOnline?: boolean;
    customWorkDir?: string;
    [key: string]: unknown;
  }

  export default function withPWAInit(
    pluginOptions?: PWAConfig,
  ): (nextConfig?: NextConfig) => NextConfig;
}
