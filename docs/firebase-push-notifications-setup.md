# Firebase Push Notifications Setup Guide

This guide details how to integrate Firebase Cloud Messaging (FCM) push notifications into this Next.js app (App Router) using a unified `next-pwa` service worker.

---

## Architecture Overview

Instead of running two independent service workers (`sw.js` and `firebase-messaging-sw.js`), this setup uses `next-pwa`'s `importScripts` configuration.

When you build the application, `next-pwa` injects:

1. Firebase App Compat CDN (`firebase-app-compat.js`)
2. Firebase Messaging Compat CDN (`firebase-messaging-compat.js`)
3. Your custom worker logic (`/firebase-messaging-sw.js`)

directly into the primary service worker (`/sw.js`). A single service worker handles both PWA caching and background push notifications.

---

## Why We Need Separate `firebase.ts` and `firebase-messaging-sw.js`

A common question when configuring web push in Next.js is why Firebase must be initialized in two different files:

- `lib/firebase.ts` (Client Application)
- `public/firebase-messaging-sw.js` (Service Worker)

They exist because they execute in **two completely distinct JavaScript runtimes with divided responsibilities**:

| Dimension                 | `lib/firebase.ts` (Client App)                                                                                                                                                                                                                 | `public/firebase-messaging-sw.js` (Service Worker)                                                                                                                                                                               |
| :------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Runtime Environment**   | Main browser window thread (React / DOM context).                                                                                                                                                                                              | Background worker thread (`ServiceWorkerGlobalScope`).                                                                                                                                                                           |
| **Lifecycle**             | Runs only while the user is actively visiting a tab. Dies when all tabs close.                                                                                                                                                                 | Runs in the background independently; can wake up even when the browser tab is closed.                                                                                                                                           |
| **Available APIs**        | Has access to `window`, `document`, React state, user clicks, and browser storage.                                                                                                                                                             | **No `window` or DOM access**. Has access to Service Worker APIs (`self.registration`, `clients`).                                                                                                                               |
| **Module Format**         | Modern ES Modules (`import { initializeApp } from "firebase/app"`).                                                                                                                                                                            | Classic script loaded via `importScripts(...)` and Firebase compat CDN.                                                                                                                                                          |
| **Core Responsibilities** | 1. Prompts the user for notification permissions (`Notification.requestPermission()`).<br>2. Requests the FCM device token via `getToken()`.<br>3. Listens to notifications while the tab is **active and in the foreground** (`onMessage()`). | 1. Listens for background `push` events from Google servers.<br>2. Displays OS notifications via `self.registration.showNotification()`.<br>3. Handles notification clicks (`notificationclick`) to focus or reopen app windows. |

> **Key Takeaway**: React code in `lib/firebase.ts` cannot receive push notifications when the website is closed or minimized. Conversely, the background worker in `firebase-messaging-sw.js` cannot interact with React or prompt the user for notification permissions. Both are required to cover the full push notification lifecycle.

---

## Step 1: Firebase Console & VAPID Key Setup

### 1. Grab `firebaseConfig`

1. Open the [Firebase Console](https://console.firebase.google.com/) and select your project.
2. Click the **Gear icon ⚙️** (Project Settings) &rarr; **General** tab.
3. Scroll down to **Your apps**, find your Web App (or click **Add app** &rarr; **Web `</>`**), and copy the `firebaseConfig` keys.

### 2. Generate the VAPID Key (Web Push Certificate)

1. In **Project Settings**, go to the **Cloud Messaging** tab.
2. Scroll down to **Web configuration** &rarr; **Web Push certificates**.
3. Click the **Generate key pair** button (if not already generated).
4. Copy the long public key string under the **Key pair** column.

### VAPID Key Requirements & Common Pitfall

> [!WARNING]
> **Do not confuse the VAPID key with the Google Analytics `measurementId`!**
>
> - **Google Analytics Measurement ID**: Starts with `G-` (e.g., `G-W5HXFWJV8R`). This is **NOT** a VAPID key.
> - **Real VAPID Key**: An elliptic curve P-256 public key encoded in URL-safe base64. It is typically ~87–88 characters long and often begins with `B` (e.g., `BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvSo4_W82Ux8...`).
>
> If an incorrect or short key (like `G-...`) is provided to `getToken()`, the browser fails when attempting to decode the 65-byte key, throwing:
> `InvalidAccessError: Failed to execute 'subscribe' on 'PushManager': The provided applicationServerKey is not valid`.

---

## Step 2: Install Firebase SDK

Install the Firebase client SDK:

```bash
npm install firebase
```

---

## Step 3: Configure Environment Variables

Create or update `.env.local` in your project root:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSy...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=1234567890
NEXT_PUBLIC_FIREBASE_APP_ID=1:1234567890:web:...
# Paste the long ~87-character key generated in Step 1:
NEXT_PUBLIC_FIREBASE_VAPID_KEY=BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvSo4_W82Ux8...
```

---

## Step 4: Create Background Service Worker Script

Create `public/firebase-messaging-sw.js`. This script runs in the service worker context when a push arrives while the app is in the background or closed.

```javascript
// public/firebase-messaging-sw.js

// 1. Firebase configuration for Service Worker context
const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID",
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const messaging = firebase.messaging();

// 2. Custom Push Event Handler (Top-level)
self.addEventListener("push", (event) => {
  console.log("🔥 [SW] Push event received");

  if (!event.data) {
    console.log("❌ [SW] Push event has no data");
    return;
  }

  let payload;
  try {
    payload = event.data.json();
    console.log("🔥 [SW] Push payload:", payload);
  } catch (error) {
    console.error("❌ [SW] Failed to parse push JSON:", error);
    return;
  }

  const data = payload.data || payload.notification || {};
  const title = data.title || "New Notification";
  const options = {
    body: data.body || "",
    icon: data.icon || "/favicon.ico",
    data: data,
  };

  event.waitUntil(
    self.registration
      .showNotification(title, options)
      .then(() => console.log("✅ [SW] Notification shown successfully"))
      .catch((err) =>
        console.error("❌ [SW] Notification display error:", err),
      ),
  );
});

// 3. Notification Click Handler (Top-level, OUTSIDE the push listener)
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const payloadData = event.notification.data;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // If app window is already open, focus it and post a message
        for (const client of clientList) {
          if (client.url.includes("/")) {
            client.postMessage({
              type: "FCM_ACTION",
              payload: payloadData,
            });
            return client.focus();
          }
        }

        // If app is closed, open a new window
        const targetUrl = payloadData?.url || "/";
        return self.clients.openWindow(targetUrl);
      }),
  );
});
```

---

## Step 5: Configure `next.config.ts`

Tell `next-pwa` to include the Firebase CDN scripts and `/firebase-messaging-sw.js` in the generated `/sw.js`:

```typescript
// next.config.ts
import type { NextConfig } from "next";
import withPWAInit from "next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  register: false, // We register manually on client to pass registration to Firebase
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
  importScripts: [
    "https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js",
    "https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js",
    "/firebase-messaging-sw.js",
  ],
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

export default withPWA(nextConfig as any);
```

---

## Step 6: Create Client Firebase Initialization

Create `lib/firebase.ts` to initialize Firebase on the browser client:

```typescript
// lib/firebase.ts
import { initializeApp, getApps, getApp } from "firebase/app";
import { getMessaging, isSupported, Messaging } from "firebase/messaging";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

let messagingPromise: Promise<Messaging | null> | null = null;

export const getClientMessaging = async (): Promise<Messaging | null> => {
  if (typeof window === "undefined") return null;
  if (!messagingPromise) {
    messagingPromise = isSupported().then((supported) =>
      supported ? getMessaging(app) : null,
    );
  }
  return messagingPromise;
};

export { app };
```

---

## Step 7: Request Permission & Obtain FCM Token

Create a UI component `components/PushManager.tsx` that:

1. Requests notification permission (`Notification.requestPermission()`).
2. Registers `/sw.js` and waits for it to be ready.
3. Retrieves the device registration token via `getToken()` with `serviceWorkerRegistration`.
4. Listens for foreground messages (`onMessage()`).

```tsx
// components/PushManager.tsx
"use client";

import { useEffect, useState } from "react";
import { getToken, onMessage } from "firebase/messaging";
import { getClientMessaging } from "@/lib/firebase";

export function PushManager() {
  const [token, setToken] = useState<string | null>(null);
  const [notification, setNotification] = useState<{
    title?: string;
    body?: string;
  } | null>(null);
  const [permission, setPermission] =
    useState<NotificationPermission>("default");

  useEffect(() => {
    if ("Notification" in window) {
      setPermission(Notification.permission);
    }

    // Listen to foreground notifications when tab is open and focused
    getClientMessaging().then((messaging) => {
      if (!messaging) return;
      onMessage(messaging, (payload) => {
        console.log("Foreground message received:", payload);
        setNotification({
          title: payload.notification?.title || payload.data?.title,
          body: payload.notification?.body || payload.data?.body,
        });
      });
    });
  }, []);

  const handleSubscribe = async () => {
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);

      if (perm !== "granted") {
        alert("Notification permission was denied.");
        return;
      }

      // 1. Register /sw.js
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      // 2. Get FCM token passing the existing serviceWorkerRegistration
      const messaging = await getClientMessaging();
      if (!messaging) return;

      const currentToken = await getToken(messaging, {
        vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
        serviceWorkerRegistration: registration,
      });

      if (currentToken) {
        console.log("FCM Device Token:", currentToken);
        setToken(currentToken);
      }
    } catch (error) {
      console.error("Failed to retrieve FCM token:", error);
    }
  };

  return (
    <div className="p-4 border rounded-lg bg-zinc-50 dark:bg-zinc-900 max-w-md my-4">
      <h2 className="text-lg font-semibold mb-2">Push Notifications</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
        Status: <span className="font-medium">{permission}</span>
      </p>

      {permission !== "granted" ? (
        <button
          onClick={handleSubscribe}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium"
        >
          Enable Notifications
        </button>
      ) : (
        <div>
          <p className="text-xs text-green-600 dark:text-green-400 font-semibold mb-2">
            ✓ Push notifications enabled
          </p>
          {token && (
            <div className="mt-2">
              <label className="text-xs text-zinc-500 block mb-1">
                Your FCM Token (for testing):
              </label>
              <textarea
                readOnly
                value={token}
                rows={3}
                className="w-full text-xs p-2 font-mono bg-white dark:bg-black border rounded"
                onClick={(e) => (e.target as HTMLTextAreaElement).select()}
              />
            </div>
          )}
        </div>
      )}

      {notification && (
        <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 rounded">
          <p className="font-semibold text-sm">{notification.title}</p>
          <p className="text-xs text-zinc-600 dark:text-zinc-300">
            {notification.body}
          </p>
        </div>
      )}
    </div>
  );
}
```

Mount `<PushManager />` inside `app/page.tsx` or your desired page.

---

## Step 8: Build and Run

### 1. Build using Webpack

Ensure `package.json` uses `"build": "next build --webpack"`:

```bash
npm run build
```

Verify that [public/sw.js](file:///F:/projects/playground/web-push/public/sw.js) contains:

```javascript
importScripts(
  "https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js",
  "/firebase-messaging-sw.js",
  ...
);
```

### 2. Start the Production Server

```bash
npm run start -- -p 8009
```

---

## Step 9: How to Send & Test Notifications

### 1. Obtain the FCM Device Token

1. Open `http://localhost:8009` in your browser.
2. Click **Enable Notifications** and approve the browser prompt.
3. The long **FCM Device Token** will appear in the textarea. Click to copy it.

### 2. Send a Test Push from Firebase Console

1. Open the [Firebase Console](https://console.firebase.google.com/) for your project.
2. In the left navigation menu, expand **Engage** &rarr; select **Messaging** (or **Campaigns**).
3. Click **New campaign** &rarr; select **Firebase Notification messages**.
4. Fill in:
   - **Notification title**: `Test Push Notification`
   - **Notification text**: `Hello from Firebase Cloud Messaging!`
5. On the preview panel on the right, click **Send test message**.
6. Paste your copied **FCM Device Token** into the input field.
7. Click the **`+`** icon next to the token, then click **Test**.

### 3. Verify Both Push Scenarios

#### Scenario A: Background Push (Native OS Toast)

1. **Minimize your browser window** or switch to another tab (such as the Firebase Console tab).
2. Click **Test** in Firebase Console.
3. Within 1–3 seconds, your operating system will display an OS-level notification toast in the corner of your screen.
4. Click the notification toast &rarr; the browser will automatically focus or reopen your Next.js application tab.

#### Scenario B: Foreground Notification (In-App)

1. Keep the `http://localhost:8009` tab **active, visible, and in focus**.
2. Click **Test** in Firebase Console.
3. Because the tab is currently focused, the service worker hands the message to `onMessage()` inside `components/PushManager.tsx`, and the notification banner will render directly inside your webpage.

---

## Troubleshooting Checklist

| Issue                                                                                            | Cause                                                                                   | Fix                                                                                                                                                  |
| :----------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Failed to execute 'subscribe' on 'PushManager': The provided applicationServerKey is not valid` | Using the Google Analytics `measurementId` (`G-...`) instead of a VAPID key             | Generate a real VAPID key in **Project Settings > Cloud Messaging > Web Push certificates** (~87 chars) and update `NEXT_PUBLIC_FIREBASE_VAPID_KEY`. |
| No notification toast in background                                                              | OS Focus Assist / Do Not Disturb is enabled, or notificationclick is nested inside push | Check Windows/Mac Notification & Focus Assist settings; ensure `notificationclick` is at the top level of `public/firebase-messaging-sw.js`.         |
| Service worker not generating in `/public`                                                       | Built using Turbopack instead of Webpack                                                | Ensure `package.json` build script is `"build": "next build --webpack"`.                                                                             |
| Firebase attempts to register a second service worker                                            | `getToken()` called without `serviceWorkerRegistration`                                 | Pass `{ serviceWorkerRegistration: registration }` inside `getToken()`.                                                                              |
