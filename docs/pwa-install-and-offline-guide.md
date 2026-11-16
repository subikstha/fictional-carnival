# PWA Installation & Offline Support Guide

This guide covers how to convert this Next.js app into a fully installable, offline-capable Progressive Web Application (PWA) and provides a deep dive into controlling the installation flow using the `beforeinstallprompt` event.

---

## 1. Core Requirements for an Installable PWA

For modern browsers (Chrome, Edge, Samsung Internet, Safari) to recognize an app as an installable PWA, the following criteria must be met:

1. **Web App Manifest**: A valid manifest JSON specifying app name, icons, start URL, and `display: "standalone"`.
2. **Registered Service Worker**: An active service worker with a `fetch` handler for caching and offline fallback (provided by `next-pwa`).
3. **Icons**: At least a `192x192` PNG icon and a `512x512` PNG icon.
4. **HTTPS**: Served over HTTPS (or `localhost` / `127.0.0.1` during development).

---

## 2. Step-by-Step: Making Your App Installable

### Step 1: Create the Web App Manifest

Next.js App Router has native support for manifests via `app/manifest.ts`.

Create `app/manifest.ts`:

```typescript
// app/manifest.ts
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Web Push PWA",
    short_name: "WebPush",
    description: "Web Push Notification & Offline PWA App",
    start_url: "/",
    display: "standalone", // Removes browser address bar and chrome
    background_color: "#ffffff",
    theme_color: "#000000",
    icons: [
      {
        src: "/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
```

> Next.js automatically outputs `/manifest.webmanifest` and injects `<link rel="manifest" href="/manifest.webmanifest">` into your `<head>`.

---

### Step 2: Add Icons to `public/`

Place two PNG icons inside your `public/` folder:

```text
public/
  ├── icon-192x192.png   # Home screen / taskbar icon
  └── icon-512x512.png   # Splash screen / store listing icon
```

* `purpose: "maskable"` ensures the icon adapts to circular, squircle, or rounded shapes on Android without extra whitespace.
* `purpose: "any"` is used for standard rectangular displays and desktop taskbars.

---

### Step 3: Configure Metadata in `app/layout.tsx`

Add viewport theme colors and iOS-specific PWA meta tags in `app/layout.tsx`:

```typescript
// app/layout.tsx
import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegister } from "./sw-register";
import "./globals.css";

// Sets browser address bar & status bar color
export const viewport: Viewport = {
  themeColor: "#000000",
};

export const metadata: Metadata = {
  title: "Web Push PWA",
  description: "Web Push & Offline PWA",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Web Push PWA",
  },
  icons: {
    apple: "/icon-192x192.png",
  },
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

## 3. Configuring Offline Support

### How Offline Caching Works with `next-pwa`
When `next-pwa` builds with Webpack, Workbox generates caching strategies for:
* **Pre-cached assets**: HTML, client JS bundles (`/_next/static/*`), CSS, and public static images are cached upon service worker installation.
* **Runtime caching**: API calls and frontend navigations are cached according to defined strategies (NetworkFirst, StaleWhileRevalidate, CacheFirst).

### Creating an Offline Fallback Page
To display a custom fallback page when a user has no internet connection:

1. Create `app/offline/page.tsx`:
   ```tsx
   // app/offline/page.tsx
   export default function OfflinePage() {
     return (
       <div className="flex flex-col items-center justify-center min-h-screen text-center p-6">
         <h1 className="text-2xl font-bold mb-2">You are offline</h1>
         <p className="text-zinc-500 mb-4">
           Please check your internet connection to continue browsing.
         </p>
         <button
           onClick={() => window.location.reload()}
           className="px-4 py-2 bg-blue-600 text-white rounded font-medium text-sm"
         >
           Retry Connection
         </button>
       </div>
     );
   }
   ```

2. Tell `next-pwa` about the fallback in `next.config.ts`:
   ```typescript
   const withPWA = withPWAInit({
     dest: "public",
     register: false,
     skipWaiting: true,
     disable: process.env.NODE_ENV === "development",
     fallbacks: {
       document: "/offline", // Serves /offline if network fails for document requests
     },
     importScripts: [
       "https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js",
       "https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js",
       "/firebase-messaging-sw.js",
     ],
   });
   ```

---

## 4. Deep Dive: The `beforeinstallprompt` Event

### 1. What is `beforeinstallprompt`?
`beforeinstallprompt` is a browser event fired by Chromium-based browsers (Chrome, Edge, Samsung Internet, Opera) when:
1. The app meets all PWA installability requirements.
2. The user has **not** yet installed the app.
3. The app is running inside a browser tab (not in standalone installed mode).

### 2. Why Intercept It?
By default:
* **On Mobile**: The browser shows a small, disruptive "mini-infobar" at the bottom of the screen.
* **On Desktop**: It shows an easy-to-miss install icon inside the browser's URL omnibox.

Intercepting `beforeinstallprompt` gives you full control to:
* Suppress the default mini-infobar (`e.preventDefault()`).
* Stash the event in application state.
* Display your own branded **"Install App"** button, promotional banner, or settings prompt at the ideal moment.

---

### 3. The 3-Step Lifecycle

```
[Browser detects installable PWA]
             │
             ▼
1. Fires "beforeinstallprompt"
   ├── e.preventDefault() (stops default banner)
   ├── Save event to variable
   └── Show custom "Install" button in UI
             │
             ▼ (User clicks custom button)
2. Call deferredPrompt.prompt()
   └── Native OS confirmation dialog opens
             │
             ▼ (User chooses Accept or Cancel)
3. Await deferredPrompt.userChoice
   ├── { outcome: "accepted" } or { outcome: "dismissed" }
   ├── Clear stashed event
   └── Hide custom "Install" button
```

---

### 4. Implementation: Custom Install Button Component

Create `components/InstallPWA.tsx`:

```tsx
// components/InstallPWA.tsx
"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallPWA() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallable, setIsInstallable] = useState(false);

  useEffect(() => {
    // Check if the app is already running in installed standalone mode
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
    if (isStandalone) {
      return; // Already installed, do not show install button
    }

    const handleBeforeInstallPrompt = (event: Event) => {
      // 1. Prevent default mini-infobar
      event.preventDefault();

      // 2. Stash event for later user gesture
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setIsInstallable(true);
    };

    // 3. Listen for completed installation
    const handleAppInstalled = () => {
      setIsInstallable(false);
      setDeferredPrompt(null);
      console.log("PWA was installed successfully!");
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    // Show native browser install prompt
    await deferredPrompt.prompt();

    // Capture user's decision
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User ${outcome} the installation.`);

    // Clear event (it cannot be reused)
    setDeferredPrompt(null);
    setIsInstallable(false);
  };

  if (!isInstallable) return null;

  return (
    <button
      onClick={handleInstallClick}
      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm font-medium transition-colors"
    >
      📲 Install App
    </button>
  );
}
```

---

### 5. Key Event Methods and Properties

| Method / Property | Type | Description |
| :--- | :--- | :--- |
| `event.preventDefault()` | `void` | Stops the browser from showing the automated default banner or infobar. |
| `event.prompt()` | `Promise<void>` | Shows the native OS confirmation dialog. **Must be invoked as a direct result of a user gesture** (e.g., button click). |
| `event.userChoice` | `Promise<{ outcome }>` | Resolves to `{ outcome: "accepted" \| "dismissed" }` when the user responds to the prompt. |

---

### 6. Companion Events & Checks

#### The `appinstalled` Event
Fired on `window` immediately after the app installation process finishes:
```typescript
window.addEventListener("appinstalled", () => {
  console.log("App installed into OS");
  // Hide promo banners or send conversion analytics
});
```

#### Detecting Standalone Mode
To prevent showing install prompts if the app is already opened from the home screen or desktop shortcut:
```typescript
const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
```

---

### 7. Browser Support & iOS Safari Caveat

| Platform / Browser | `beforeinstallprompt` Supported? | How Installation Works |
| :--- | :---: | :--- |
| **Chrome / Edge (Desktop & Android)** |  **Yes** | Supported via `beforeinstallprompt` and URL omnibox icon. |
| **Samsung Internet / Opera** |  **Yes** | Supported via `beforeinstallprompt`. |
| **iOS / iPadOS Safari** | ❌ **No** | Apple does not support `beforeinstallprompt`. Users must tap the **Share icon (`⎋`)** &rarr; select **"Add to Home Screen"**. |
| **Firefox (Desktop)** | ❌ **No** | Does not support desktop PWA installation. |

> **Best Practice for iOS**: If you detect an iOS user agent (`/iphone|ipad|ipod/i.test(navigator.userAgent)`), show a small tip explaining: *"To install, tap the Share icon and select 'Add to Home Screen'"*.

---

## 5. Build, Test & Verify

### 1. Build Production App
```bash
npm run build
npm run start -- -p 8009
```

### 2. Verify in Chrome DevTools
1. Navigate to `http://localhost:8009`.
2. Press `F12` &rarr; go to the **Application** tab.
3. Select **Manifest** on the left:
   - Ensure `Name`, `Short name`, and `Icons` have green checkmarks with no errors.
   - Verify `Display: standalone` is active.
4. Click **"Install app"** link directly inside the Manifest panel to simulate the installation prompt.
5. In your address bar, verify the **Install icon** (monitor with a down arrow) is present.
