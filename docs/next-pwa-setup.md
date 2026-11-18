# Next-PWA Setup & Service Worker Registration Guide

This guide covers setting up `next-pwa` in modern Next.js (App Router, Next.js 15/16), resolving TypeScript type conflicts, fixing why service workers fail to register automatically in the App Router, and implementing Web Push notification handlers.

---

## 1. TypeScript Types Setup

### The Problem with `@types/next-pwa`
If you install `@types/next-pwa`, npm pulls an outdated nested dependency on Next.js 12/13. In modern Next.js (15/16), configuration types like `i18n.domains` were updated to be `readonly`. This produces the following error on `export default withPWA(nextConfig)`:

```text
Type 'I18NDomains | undefined' is not assignable to type 'DomainLocale[] | undefined'.
The type 'I18NDomains' is 'readonly' and cannot be assigned to the mutable type 'DomainLocale[]'.
```

### The Solution: Custom Type Declaration
Instead of installing `@types/next-pwa`, uninstall it (if installed) and declare a clean type definition in `types/next-pwa.d.ts` (or `next-env.d.ts`):

```bash
npm uninstall @types/next-pwa
```

Create `types/next-pwa.d.ts`:

```typescript
// types/next-pwa.d.ts
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
    reloadOnOnline?: boolean;
    customWorkerDir?: string;
    subdomainPrefix?: string;
    fallbacks?: Record<string, string>;
    publicExcludes?: string[];
    buildExcludes?: (string | RegExp)[];
    [key: string]: unknown;
  }

  export default function withPWAInit(
    pluginOptions?: PWAConfig
  ): (nextConfig?: NextConfig) => NextConfig;
}
```

*(Alternatively, if you keep `@types/next-pwa`, you can bypass the check with `export default withPWA(nextConfig as any);`)*

---

## 2. Configure `next.config.ts`

Import `withPWAInit` and wrap your Next.js configuration:

```typescript
import type { NextConfig } from "next";
import withPWAInit from "next-pwa";

const withPWA = withPWAInit({
  dest: "public", // Service worker files will be generated into /public
  register: false, // Set to false: App Router requires manual registration (see Section 4)
  skipWaiting: true, // Activates updated service workers immediately
  disable: process.env.NODE_ENV === "development", // Disable in dev to prevent caching issues
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

## 3. Webpack Build Flag (Mandatory for Next.js 16+)

`next-pwa` is a **Webpack-only** plugin that injects `workbox-webpack-plugin`. 

Because Next.js 16 uses **Turbopack by default** for `next build`, running the standard build command will bypass Webpack, and `sw.js` will **never** be generated.

In `package.json`, update your build script to include the `--webpack` flag:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build --webpack",
  "start": "next start",
  "lint": "eslint"
}
```

---

## 4. Why `sw.js` Does NOT Auto-Register in the App Router

Even when `public/sw.js` is generated and `register: true` is configured in `next.config.ts`, you may notice that **no service worker is registered in DevTools (Application > Service Workers)**.

### Root Cause
`next-pwa` was authored when Next.js only had the **Pages Router** (`pages/`). Under the hood, `next-pwa` attempts to inject its registration script into the client bundle by looking for:

```javascript
// Inside node_modules/next-pwa/index.js
const registerJs = path.join(__dirname, 'register.js')
const entry = config.entry
config.entry = () =>
  entry().then(entries => {
    if (entries['main.js'] && !entries['main.js'].includes(registerJs)) {
      entries['main.js'].unshift(registerJs)
    }
    return entries
  })
```

In the Next.js **App Router** (`app/` directory):
- Client entry points are named `main-app.js` (not `main.js`).
- `entries['main.js']` is `undefined`.
- `next-pwa` silently skips injecting `register.js` into your bundle.
- As a result, `/sw.js` is built and accessible in `/public`, but **no browser script ever invokes `navigator.serviceWorker.register('/sw.js')`**.

---

## 5. The Solution: Explicit Client Registration

To ensure the service worker registers reliably across all App Router pages:

### Step 1: Create a Client Registration Component
Create `app/sw-register.tsx`:

```tsx
"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          console.log("Service Worker registered with scope:", registration.scope);
        })
        .catch((error) => {
          console.error("Service Worker registration failed:", error);
        });
    }
  }, []);

  return null;
}
```

### Step 2: Mount it in `app/layout.tsx`
Import and include `<ServiceWorkerRegister />` inside the `<body>` of your root layout:

```tsx
// app/layout.tsx
import type { Metadata } from "next";
import { ServiceWorkerRegister } from "./sw-register";
import "./globals.css";

export const metadata: Metadata = {
  title: "Web Push App",
  description: "Next.js App with Service Worker & Web Push",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
```

---

## 6. Custom Service Worker for Web Push (`worker/index.ts`)

`next-pwa` automatically detects and compiles a custom worker file placed at `worker/index.ts` (or `worker/index.js`) in your project root, bundling it directly into `public/sw.js`.

Create `worker/index.ts`:

```typescript
// worker/index.ts
declare const self: ServiceWorkerGlobalScope;

// 1. Listen for push notifications sent from server
self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || "New Notification";
  const options: NotificationOptions = {
    body: data.body || "You have a new message.",
    icon: "/icon-192x192.png",
    badge: "/badge-72x72.png",
    data: data.url || "/",
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// 2. Handle notification clicks
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

## 7. Build, Test, and Git Ignore

### 1. Add Generated Files to `.gitignore`
Prevent generated worker files from being committed:

```gitignore
# PWA generated service worker files
public/sw.js
public/sw.js.map
public/workbox-*.js
public/workbox-*.js.map
```

### 2. Build and Test
```bash
# Build using Webpack so next-pwa runs
npm run build

# Start the production server on your port (e.g., 8009)
npm run start -- -p 8009
```

### 3. Verify in Chrome DevTools
1. Open `http://localhost:8009`.
2. Open DevTools (`F12`) &rarr; **Application** tab &rarr; **Service Workers**.
3. You will see `/sw.js` registered and active with status: **Activated and is running**.

---

## 8. Production Auto-Update & Service Worker Lifecycle Management

When you deploy a new version to production (e.g. pushing to `main`):
1. Next.js generates new JS/CSS chunk hashes and a newly hashed `/sw.js`.
2. Browsers check `/sw.js` for byte changes.
3. Without an update manager, the new service worker sits in the `waiting` state until all user tabs are closed.

### Implementation: Event-Driven Update Manager (`app/sw-register.tsx`)

In `app/sw-register.tsx`, register the worker and actively listen for updates on focus, visibility change, and intervals, showing an update prompt:

```tsx
// app/sw-register.tsx
"use client";

import { useEffect, useState, useRef } from "react";

export function ServiceWorkerRegister() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") {
      return;
    }

    let refreshing = false;

    // 1. Detect when a new service worker takes control
    const handleControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      setUpdateAvailable(true);
    };

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

    // 2. Register Service Worker
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        registrationRef.current = registration;

        if (registration.waiting) {
          setUpdateAvailable(true);
        }

        // 3. Listen for new worker installation
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              setUpdateAvailable(true);
            }
          });
        });
      })
      .catch((error) => console.error("Service worker registration failed:", error));

    // 4. Actively check for updates whenever the user returns to the tab
    const checkForUpdates = () => {
      if (registrationRef.current) {
        registrationRef.current
          .update()
          .then((reg) => {
            if (reg.waiting) setUpdateAvailable(true);
          })
          .catch((err) => console.log("[PWA] Update check error:", err));
      }
    };

    window.addEventListener("focus", checkForUpdates);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkForUpdates();
    });

    const interval = setInterval(checkForUpdates, 30 * 60 * 1000);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      window.removeEventListener("focus", checkForUpdates);
      clearInterval(interval);
    };
  }, []);

  const handleUpdate = () => {
    const reg = registrationRef.current;
    if (reg?.waiting) {
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
    }
    window.location.reload();
  };

  if (!updateAvailable) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex items-center gap-3 p-3.5 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 rounded-xl shadow-2xl border border-zinc-700 dark:border-zinc-300 text-xs animate-in slide-in-from-bottom duration-300">
      <span className="relative flex h-2.5 w-2.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
      </span>
      <span className="font-medium">New version available!</span>
      <button
        onClick={handleUpdate}
        className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-semibold transition-colors cursor-pointer"
      >
        Update Now
      </button>
      <button
        onClick={() => setUpdateAvailable(false)}
        className="text-zinc-400 hover:text-zinc-200 dark:hover:text-zinc-700 text-sm ml-1 cursor-pointer"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
```
