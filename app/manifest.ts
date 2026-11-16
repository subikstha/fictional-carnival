import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Web Push PWA",
    short_name: "WebPush",
    description: "Web Push Notification & PWA App",
    start_url: "/",
    display: "standalone", // Makes the app open without browser address bar
    background_color: "#ffffff",
    theme_color: "#000000",
    icons: [
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
