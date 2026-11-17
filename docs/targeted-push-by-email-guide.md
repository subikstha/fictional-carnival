# Targeted Push Notifications by User Email Guide

This guide details how to send push notifications from your Next.js backend targeted to a specific user by their **email address**, rather than manually pasting device tokens.

---

## Architecture Overview

Firebase Cloud Messaging (FCM) routes notifications using **Device Registration Tokens**, not user emails. To target users by email:
1. When a user logs in and allows notifications, your frontend sends their `{ email, token }` to your Next.js backend.
2. Your backend associates the email with the device token(s) in a store or database.
3. When sending a notification, your backend looks up the token(s) for that email and dispatches the message via the **Firebase Admin SDK**.

```
[User logs in: user@example.com] ──> Frontend retrieves FCM token ──> POST /api/notifications/register-token
                                                                                   │
                                                                                   ▼
                                                             Saved in Database / Store:
                                                             { "user@example.com": ["token_1", "token_2"] }
                                                                                   │
                                                                                   ▼
[Backend Dispatch Event] ──> Look up tokens for "user@example.com" ──> adminMessaging.sendEachForMulticast()
```

---

## End-to-End Implementation Roadmap

* **Step 1: Set Up Firebase Admin SDK & Service Account Credentials (Detailed Below)**  
  Install `firebase-admin`, download service account credentials from Firebase Console, store them in `.env.local`, and create a server singleton.
* **Step 2: Create a Token Store (Email &rarr; Device Tokens Mapping)**  
  Set up storage (database or local in-memory/JSON store) to maintain device tokens for each email.
* **Step 3: Update the Frontend to Register User Email & Token**  
  Call the registration API whenever a user logs in or enables push notifications.
* **Step 4: Create the Backend Dispatch Route Handler (`/api/notifications/send`)**  
  Build the API endpoint that takes `{ targetEmail, title, body }`, looks up tokens, and dispatches via Firebase Admin.
* **Step 5: Create a Test Sender UI & Verify Delivery**  
  Add a UI form to test sending targeted notifications to any email and observe delivery.

---

## Step 1: Set Up Firebase Admin SDK & Service Account

Because the browser Firebase SDK cannot send push notifications directly to other devices, the server-side **Firebase Admin SDK** is required.

### 1.1 Install `firebase-admin`

In your terminal, install the package:

```bash
npm install firebase-admin
```

---

### 1.2 Generate your Firebase Service Account Private Key

1. Open the [Firebase Console](https://console.firebase.google.com/) and open your project.
2. Click the **Gear icon ⚙️** (next to *Project Overview*) &rarr; **Project settings**.
3. Select the **Service accounts** tab along the top.
4. Click **"Generate new private key"** &rarr; confirm by clicking **"Generate key"**.
5. A `.json` file will download to your machine. Open it in any text editor.

### Which fields from the JSON are actually required?
The downloaded JSON contains multiple fields (`client_id`, `auth_uri`, `token_uri`, `client_x509_cert_url`, etc.). **Only 3 fields are needed:**

| JSON Key | Environment Variable | Purpose | Note |
| :--- | :--- | :--- | :--- |
| `project_id` | `FIREBASE_PROJECT_ID` | Identifies your Firebase project | ⚠️ **Do NOT confuse with `client_id`** (the numeric ID is not used). |
| `client_email` | `FIREBASE_CLIENT_EMAIL` | Service account identity | Looks like `firebase-adminsdk-xxxxx@...iam.gserviceaccount.com`. |
| `private_key` | `FIREBASE_PRIVATE_KEY` | Secret RSA private key | Full string starting with `-----BEGIN PRIVATE KEY-----`. |

> *All other fields (`client_id`, `auth_uri`, `token_uri`, `auth_provider_x509_cert_url`, etc.) are standard Google OAuth metadata that the Firebase Admin SDK already handles internally and can be ignored.*

---

### 1.3 Configure Server Credentials in `.env.local`

Add these 3 credentials to your [.env.local](file:///F:/projects/playground/web-push/.env.local) file.

> [!CAUTION]
> Do **NOT** prefix these with `NEXT_PUBLIC_`. These are server-only secrets that grant administrative access to your Firebase project and must never be exposed to client bundles.

```env
# Server-only Firebase Admin Credentials
FIREBASE_PROJECT_ID="your-project-id"
FIREBASE_CLIENT_EMAIL="firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com"
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n"
```

*Note: Keep the quotation marks around `FIREBASE_PRIVATE_KEY` because it contains newline (`\n`) characters.*

---

### 1.4 Create the Server Singleton (`lib/firebase-admin.ts`)

Create `lib/firebase-admin.ts`. In modern versions of `firebase-admin` (v12+ / v14) and Next.js ESM / Webpack bundles, initialize using the modular `firebase-admin/app` and `firebase-admin/messaging` subpaths. 

Using a **lazy Proxy** pattern is strongly recommended for Next.js: it prevents eager top-level initialization from failing or throwing `The default Firebase app does not exist` during `next build` worker data collection:

```typescript
// lib/firebase-admin.ts
import { initializeApp, getApps, getApp, cert, App } from "firebase-admin/app";
import { getMessaging, Messaging } from "firebase-admin/messaging";

function getAdminApp(): App {
  if (getApps().length > 0) {
    return getApp();
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Firebase Admin credentials missing: ensure FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY are set in .env.local"
    );
  }

  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
}

/**
 * Lazy proxy for Firebase Admin Messaging.
 * Prevents eager initialization crashes during Next.js build-time page data collection.
 */
export const adminMessaging: Messaging = new Proxy({} as Messaging, {
  get(_target, prop) {
    const messaging = getMessaging(getAdminApp());
    const value = (messaging as any)[prop];
    return typeof value === "function" ? value.bind(messaging) : value;
  },
});
```

---

## Step 2: Create the Token Store & Registration Endpoint

Now that `firebase-admin` is set up, the database needs to store and map user accounts to their device tokens.

### 2.1 Schema Architecture (`lib/schema.ts`)
Using Drizzle ORM and PostgreSQL, the `deviceTokens` table is defined as:

```typescript
// lib/schema.ts
export const deviceTokens = pgTable(
  "device_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    deviceType: text("device_type").notNull().default("web"),
    app: text("app").notNull().default("trialapp"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("device_tokens_user_id_idx").on(table.userId)]
);
```

#### Why This Schema Design Matters:
* **`token.unique()` (Crucial)**: Guarantees that if User B logs into a browser or phone previously used by User A, the FCM token is **reassigned** to User B via an upsert. This completely prevents User A from receiving notifications intended for User B.
* **`onDelete: "cascade"`**: If a user is deleted from the `users` table, all their registered device tokens are automatically purged.
* **Index on `userId`**: Ensures rapid lookups when sending notifications to a user across multiple devices (`SELECT token FROM device_tokens WHERE user_id = ?`).

---

### 2.2 Token Registration Route Handler (`app/api/notifications/register-token/route.ts`)

Create or update `app/api/notifications/register-token/route.ts`. This endpoint finds the user by their email, and then **upserts** (`onConflictDoUpdate`) the device token:

```typescript
// app/api/notifications/register-token/route.ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/connection";
import { deviceTokens, users } from "@/lib/schema";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, token, deviceType = "web" } = body;

    if (!email || !token) {
      return NextResponse.json(
        { error: "Email and token are required" },
        { status: 400 }
      );
    }

    // 1. Look up user by email
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      return NextResponse.json(
        { error: `User with email ${email} not found` },
        { status: 404 }
      );
    }

    // 2. Upsert the device token:
    // If the token already exists (e.g. account switch), reassign it to this user!
    await db
      .insert(deviceTokens)
      .values({
        userId: user.id,
        token: token,
        deviceType: deviceType,
      })
      .onConflictDoUpdate({
        target: deviceTokens.token,
        set: {
          userId: user.id,
          deviceType: deviceType,
          updatedAt: new Date(),
        },
      });

    return NextResponse.json({
      success: true,
      message: `Token registered successfully for ${email}`,
    });
  } catch (error: any) {
    console.error("Error registering device token:", error);
    return NextResponse.json(
      { error: error.message || "Failed to register token" },
      { status: 500 }
    );
  }
}
```

---

## Step 3: Client Token Registration (`PushManager.tsx`)

In `components/PushManager.tsx`, as soon as the FCM token is retrieved and the user's email is available from the session, send both to the registration endpoint:

```typescript
// Inside components/PushManager.tsx:
const registerTokenOnBackend = async (currentToken: string, userEmail: string) => {
  try {
    await fetch("/api/notifications/register-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: userEmail,
        token: currentToken,
        deviceType: "web",
      }),
    });
    console.log("Token registered on backend for", userEmail);
  } catch (err) {
    console.error("Failed to register token on backend:", err);
  }
};
```

---

## Step 4: Backend Notification Dispatcher (`/api/notifications/send`)

The dispatch route handler accepts `{ targetEmail, title, body, actionUrl }`, finds all active device tokens for that email, sends the push to all devices, prunes invalid tokens, and records the notification in the database inbox.

Create `app/api/notifications/send/route.ts`:

```typescript
// app/api/notifications/send/route.ts
import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/connection";
import { users, deviceTokens, notifications } from "@/lib/schema";
import { adminMessaging } from "@/lib/firebase-admin";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { targetEmail, title, body: messageBody, actionUrl = "/" } = body;

    // 1. Validate inputs
    if (!targetEmail || !title || !messageBody) {
      return NextResponse.json(
        { error: "targetEmail, title, and body are required." },
        { status: 400 }
      );
    }

    // 2. Find user by email
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, targetEmail.trim().toLowerCase()))
      .limit(1);

    if (!user) {
      return NextResponse.json(
        { error: `User with email "${targetEmail}" was not found.` },
        { status: 404 }
      );
    }

    // 3. Retrieve all device tokens registered to this user
    const tokenRecords = await db
      .select({ token: deviceTokens.token })
      .from(deviceTokens)
      .where(eq(deviceTokens.userId, user.id));

    if (!tokenRecords.length) {
      return NextResponse.json(
        {
          error: "User has no registered devices. They must log in and enable notifications first.",
        },
        { status: 404 }
      );
    }

    const tokens = tokenRecords.map((r) => r.token);

    // 4. Dispatch the push notification to all devices
    const response = await adminMessaging.sendEachForMulticast({
      tokens: tokens,
      notification: {
        title: title,
        body: messageBody,
      },
      data: {
        actionUrl: actionUrl,
        sentAt: new Date().toISOString(),
      },
    });

    // 5. Clean up stale/invalid tokens reported by Firebase
    const deadTokens: string[] = [];
    response.responses.forEach((res, idx) => {
      if (!res.success) {
        const errCode = res.error?.code;
        if (
          errCode === "messaging/registration-token-not-registered" ||
          errCode === "messaging/invalid-registration-token"
        ) {
          deadTokens.push(tokens[idx]);
        }
      }
    });

    if (deadTokens.length > 0) {
      await db
        .delete(deviceTokens)
        .where(inArray(deviceTokens.token, deadTokens));
      console.log(`Cleaned up ${deadTokens.length} expired token(s)`);
    }

    // 6. Save in the in-app notification inbox
    await db.insert(notifications).values({
      userId: user.id,
      title: title,
      body: messageBody,
      actionUrl: actionUrl,
    });

    return NextResponse.json({
      success: true,
      deliveredToDevices: response.successCount,
      failedDevices: response.failureCount,
    });
  } catch (error: any) {
    console.error("Error dispatching notification:", error);
    return NextResponse.json(
      { error: error.message || "Failed to send notification" },
      { status: 500 }
    );
  }
}
```

---

## Step 5: Test Sender UI Component & Verification

Now that the `/api/notifications/send` route handler is created, build a test UI component so you can trigger targeted push notifications directly from the browser to any registered user email.

### 5.1 Create `components/SendNotificationForm.tsx`

Create `components/SendNotificationForm.tsx`. It supports an optional `defaultTargetEmail` prop so it can automatically prefill the logged-in user's email for instant self-testing, and provides a "Use my email" quick button if modified:

```tsx
"use client";

import { useState } from "react";

interface SendNotificationFormProps {
  defaultTargetEmail?: string;
}

export function SendNotificationForm({
  defaultTargetEmail = "",
}: SendNotificationFormProps) {
  const [targetEmail, setTargetEmail] = useState(defaultTargetEmail);
  const [title, setTitle] = useState("Hello from Next.js! 🚀");
  const [body, setBody] = useState(
    "This is a targeted push notification sent by email."
  );
  const [actionUrl, setActionUrl] = useState("/");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    success?: boolean;
    deliveredToDevices?: number;
    failedDevices?: number;
    error?: string;
  } | null>(null);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/notifications/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetEmail: targetEmail.trim().toLowerCase(),
          title,
          body,
          actionUrl,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setResult({ error: data.error || "Failed to send notification." });
      } else {
        setResult({
          success: true,
          deliveredToDevices: data.deliveredToDevices,
          failedDevices: data.failedDevices,
        });
      }
    } catch (err: any) {
      setResult({ error: err.message || "Network error occurred." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 border rounded-lg bg-zinc-50 dark:bg-zinc-900 max-w-md w-full">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold">Send Push Notification</h2>
        {defaultTargetEmail && targetEmail !== defaultTargetEmail && (
          <button
            type="button"
            onClick={() => setTargetEmail(defaultTargetEmail)}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            Use my email
          </button>
        )}
      </div>

      <p className="text-xs text-zinc-500 mb-4">
        Dispatch a push notification to all active devices registered under a
        specific user email.
      </p>

      <form onSubmit={handleSend} className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            Recipient User Email
          </label>
          <input
            type="email"
            required
            placeholder="user@example.com"
            value={targetEmail}
            onChange={(e) => setTargetEmail(e.target.value)}
            className="w-full text-sm p-2 border rounded bg-white dark:bg-black border-zinc-300 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            Notification Title
          </label>
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full text-sm p-2 border rounded bg-white dark:bg-black border-zinc-300 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            Notification Body
          </label>
          <textarea
            required
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="w-full text-sm p-2 border rounded bg-white dark:bg-black border-zinc-300 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            Action URL (on click)
          </label>
          <input
            type="text"
            value={actionUrl}
            onChange={(e) => setActionUrl(e.target.value)}
            className="w-full text-sm p-2 border rounded bg-white dark:bg-black border-zinc-300 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded transition-colors"
        >
          {loading ? "Dispatching..." : "Send Notification"}
        </button>
      </form>

      {result?.success && (
        <div className="mt-4 p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 rounded text-xs text-emerald-800 dark:text-emerald-200">
          <p className="font-semibold">✓ Notification dispatched!</p>
          <p>Delivered to {result.deliveredToDevices} device(s).</p>
          {result.failedDevices !== undefined && result.failedDevices > 0 && (
            <p className="text-amber-600 dark:text-amber-400 mt-1">
              Cleaned up {result.failedDevices} expired/invalid device token(s).
            </p>
          )}
        </div>
      )}

      {result?.error && (
        <div className="mt-4 p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 rounded text-xs text-rose-800 dark:text-rose-200">
          <p className="font-semibold">✕ Send failed:</p>
          <p>{result.error}</p>
        </div>
      )}
    </div>
  );
}
```

---

### 5.2 Hook up `SendNotificationForm` into `PushManager.tsx`

Hook up `SendNotificationForm` inside `components/PushManager.tsx` directly beneath the push notification permission and token card:

```tsx
// components/PushManager.tsx
import { SendNotificationForm } from "./SendNotificationForm";

export function PushManager({ email }: { email: string }) {
  // ... existing token, permission, and listener logic ...

  return (
    <div className="w-full max-w-md my-4 space-y-6">
      {/* 1. Push Permission & Token Card */}
      <div className="p-4 border rounded-lg bg-zinc-50 dark:bg-zinc-900">
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
            {token && !loading && (
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

        {/* Foreground In-App Notification Card */}
        {notification && (
          <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 rounded">
            <p className="font-semibold text-sm">{notification.title}</p>
            <p className="text-xs text-zinc-600 dark:text-zinc-300">
              {notification.body}
            </p>
          </div>
        )}
      </div>

      {/* 2. Sender Form automatically wired to current user's email */}
      <SendNotificationForm defaultTargetEmail={email} />
    </div>
  );
}
```

---

### 5.3 How to Test & What to Expect

Follow these steps to verify both foreground and background push notification behaviors:

#### Scenario A: Self-Test (Single Browser)
1. Open your browser to `http://localhost:3000` and log in with User A (`user1@example.com`).
2. Click **"Enable Notifications"** and approve the browser prompt.
3. Check the console and the database: the FCM device token is registered for `user1@example.com`.
4. In the **Send Push Notification** form, verify `user1@example.com` is prefilled.
5. Click **"Send Notification"**:
   - **Foreground test (tab is open & focused)**: Firebase client SDK receives `onMessage` &rarr; `<PushManager />` displays the blue notification banner on the screen.
   - **Background test (minimize or switch to another tab)**: Send the notification or wait for one while the tab is blurred/minimized &rarr; the Service Worker (`firebase-messaging-sw.js`) intercepts the push and Windows/macOS shows an OS desktop notification. Clicking it focuses your tab and navigates to `actionUrl`.

#### Scenario B: Multi-Device / Multi-User Test
1. Open **Chrome** and log in as `alice@example.com`. Allow notifications.
2. Open **Edge** (or Chrome Incognito) and log in as `bob@example.com`. Allow notifications.
3. In Alice's window, set the recipient email to `bob@example.com` and click **"Send Notification"**.
4. Observe:
   - Alice's screen displays: `Delivered to 1 device(s)`.
   - Bob's browser/OS receives the notification in real time.
   - Alice receives nothing (strictly targeted to Bob).

---

## Important Production Notes & Pitfalls

> [!CAUTION]
> **Next.js Build-Time Failure: `firebase-admin` Initialization in Route Handlers**:
> If you import `firebase-admin` using `import admin from "firebase-admin"` or evaluate `getMessaging()` eagerly at the module's top level, running `npm run build` will crash during page data collection:
> ```text
> ❌ Firebase Admin initialization error: TypeError: Cannot read properties of undefined (reading 'initializeApp')
> Error: Failed to collect configuration for /api/notifications/send
>   [cause]: Error: The default Firebase app does not exist. Make sure you call initializeApp() before using any of the Firebase services.
> ```
> **Why this occurs**:
> 1. **No Default ESM Export**: In modern `firebase-admin` (v12+ / v14) bundled via Webpack, `firebase-admin` does not have a default export with `initializeApp`. `admin` evaluates to `undefined`.
> 2. **Worker Page Data Collection**: During `next build`, Next.js spins up parallel worker threads (`Collecting page data using 11 workers`) and statically imports all API routes to extract metadata. Eager top-level `getMessaging()` calls execute immediately during the build when the app is uninitialized, crashing worker threads.
> 
> **How to resolve**:
> 1. Always import from official modular subpaths:
>    ```typescript
>    import { initializeApp, getApps, getApp, cert, App } from "firebase-admin/app";
>    import { getMessaging, Messaging } from "firebase-admin/messaging";
>    ```
> 2. Wrap `adminMessaging` in a **lazy Proxy** in `lib/firebase-admin.ts`. This ensures `getAdminApp()` and `getMessaging()` only execute when an actual HTTP request calls a messaging method at runtime, keeping build worker static analysis completely safe.

> [!WARNING]
> **Check Imports in `app/api/notifications/send/route.ts`**:
> Ensure that both `inArray` from `"drizzle-orm"` and `notifications` from `@/lib/schema` are properly imported:
> ```typescript
> import { eq, inArray } from "drizzle-orm";
> import { deviceTokens, users, notifications } from "@/lib/schema";
> ```
> Omitting these will throw a runtime `ReferenceError` when stale tokens are cleaned up or when notifications are inserted into the inbox table.

> [!NOTE]
> **Automatic Token Pruning**:
> When Firebase returns `messaging/registration-token-not-registered` or `messaging/invalid-registration-token`, the recipient has either uninstalled the PWA, revoked notification permissions, or cleared browser site data. The cleanup code in Step 4 automatically deletes those dead tokens from `deviceTokens`, preventing wasted multicast quota on future sends.

> [!TIP]
> **Shared Computers & Multi-User Token Reassignment**:
> Because `deviceTokens.token` is marked `.unique()`, if Bob logs into the same physical browser profile where Alice previously logged in, the `onConflictDoUpdate` clause in Step 2 updates `userId = bob.id`. Alice will no longer receive Bob's notifications on that device.

---

## Notification Payload Architecture: Foreground vs. Background

Understanding why and how push messages behave differently between open tabs and background states is critical for web push:

| Application State | Who Catches the Event? | How It Is Displayed | Handling Mechanism |
| :--- | :--- | :--- | :--- |
| **Foreground** (Tab is active and focused) | Browser Firebase SDK (`onMessage`) | In-app UI banner or custom toast | React state in `PushManager.tsx` updates `setNotification({ title, body })`. The operating system does NOT pop up a tray banner by default. |
| **Background** (Tab minimized, blurred, or closed) | Service Worker (`public/firebase-messaging-sw.js`) | Native OS desktop / mobile notification | Browser wakes `sw.js` via the `push` event and calls `self.registration.showNotification(title, options)`. |
| **Notification Clicked** | Service Worker (`public/firebase-messaging-sw.js`) | Brings tab to focus and navigates to `actionUrl` | `notificationclick` listener iterates open client windows; if a matching window exists it focuses it; otherwise it calls `clients.openWindow(actionUrl)`. |

### Dual Payload Design
In `app/api/notifications/send/route.ts`, notifications are dispatched with both `notification` and `data` blocks:
```typescript
await adminMessaging.sendEachForMulticast({
  tokens: tokens,
  notification: {
    title: title,
    body: messageBody,
  },
  data: {
    actionUrl: actionUrl,
    sentAt: new Date().toISOString(),
  },
});
```
* The `notification` block (`title`, `body`) is natively recognized by Apple APNs, Android FCM, and browser push services.
* The `data` block is used to deliver custom routing metadata (`actionUrl`, `sentAt`) that `notificationclick` uses to direct the user when they click the notification.

---

## Platform-Specific Requirements Checklist

### Apple iOS (Safari 16.4+)
* **Standalone PWA Required**: Web Push **does not work in normal Safari tabs**. The user must open Share &rarr; **"Add to Home Screen"**, then launch the installed app.
* **Explicit User Gesture**: `Notification.requestPermission()` must be invoked from a direct user action (button click event), never on initial page load.
* **HTTPS**: Strict public HTTPS is mandatory (no self-signed certificates or plain HTTP).

### Android (Chrome / Chromium)
* **Android 13+ (API 33) Runtime Permission**: The browser automatically requests the system `POST_NOTIFICATIONS` runtime permission when `Notification.requestPermission()` is resolved.
* **Heads-Up Notifications**: Ensure notification priority is high so notifications pop over active apps.

### Windows & macOS Desktop
* **System Focus Assist / Do Not Disturb**: If desktop banners do not appear while the browser is in the background, check that Windows "Focus Assist" / "Do Not Disturb" is turned off, and verify that notifications are enabled for Google Chrome / Microsoft Edge in **Windows Settings &rarr; System &rarr; Notifications**.
