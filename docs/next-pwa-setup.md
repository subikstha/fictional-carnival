# Next-PWA Setup & Service Worker Registration Guide

This guide walks through setting up `next-pwa` in `next.config.ts`, handling TypeScript declarations, configuring service worker registration (automatic vs. manual for Web Push), and adding custom background push notifications.

---

## 1. Install TypeScript Definitions

Because `next-pwa` is a CommonJS package that does not bundle type definitions out of the box, install the community types:

```bash
npm install -D @types/next-pwa
```

> **Alternative**: If you prefer not to install `@types/next-pwa`, add a declaration in your `next-env.d.ts` or a new `types/next-pwa.d.ts`:
> ```typescript
> declare module "next-pwa";
> ```

---

## 2. Configure `next.config.ts`

Import `withPWAInit` from `next-pwa` and wrap your existing Next.js configuration:

```typescript
import type { NextConfig } from "next";
import withPWAInit from "next-pwa";

const withPWA = withPWAInit({
  dest: "public", // Directory where sw.js and workbox assets will be output
  register: true, // Set to true for automatic registration, or false for manual control
  skipWaiting: true, // Forces waiting service workers to activate immediately
  disable: process.env.NODE_ENV === "development", // Disable PWA during development to avoid caching issues
});

const nextConfig: NextConfig = {
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
```

---

## 3. Registration Strategies

### Option A: Automatic Registration (`register: true`)

When `register: true` is configured in `withPWAInit`:
- `next-pwa` injects a script into the client bundle that registers the service worker (`/sw.js`) automatically via `workbox-window`.
- No extra clientside registration code is needed.

### Option B: Manual Registration (`register: false`)

If you are implementing **Web Push Notifications**, you often need direct access to the `ServiceWorkerRegistration` object to manage push subscriptions (`registration.pushManager.subscribe(...)`).

1. Set `register: false` in `next.config.ts`:
   ```typescript
   const withPWA = withPWAInit({
     dest: "public",
     register: false,
     skipWaiting: true,
     disable: process.env.NODE_ENV === "development",
   });
   ```

2. Register the service worker manually in a client component or hook:
   ```typescript
   "use client";

   import { useEffect } from "react";

   export function ServiceWorkerManager() {
     useEffect(() => {
       if ("serviceWorker" in navigator) {
         navigator.serviceWorker
           .register("/sw.js")
           .then((registration) => {
             console.log("Service Worker registered with scope:", registration.scope);
             // You can now access registration.pushManager
           })
           .catch((error) => {
             console.error("Service Worker registration failed:", error);
           });
       }
     }, []);

     return null;
   }
   ```

---

## 4. Custom Service Worker for Web Push

`next-pwa` automatically detects and compiles a custom worker file located at `worker/index.ts` (or `worker/index.js`) in your project root, bundling its logic into the generated `public/sw.js`.

Create `worker/index.ts`:

```typescript
// worker/index.ts
declare const self: ServiceWorkerGlobalScope;

// Handle incoming push notifications
self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || "Notification";
  const options: NotificationOptions = {
    body: data.body || "You have a new update.",
    icon: "/icon-192x192.png",
    badge: "/badge-72x72.png",
    data: data.url || "/",
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Handle notification click to focus or open window
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === urlToOpen && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});

export {};
```

---

## 5. Build, Test, and Git Ignore

### Ignore Generated Files
Add the generated files to your `.gitignore`:

```gitignore
# PWA generated service worker files
public/sw.js
public/sw.js.map
public/workbox-*.js
public/workbox-*.js.map
```

### Build & Run
Because `disable: process.env.NODE_ENV === "development"` is typically set, the service worker is only generated during production builds:

```bash
# 1. Build the production application
npm run build

# 2. Start the production server
npm run start
```

### Verification
1. Open your browser and navigate to `http://localhost:3000`.
2. Open DevTools (`F12`) and go to **Application** > **Service Workers**.
3. Verify that `/sw.js` is active and running.
