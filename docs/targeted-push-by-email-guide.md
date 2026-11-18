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

* **Step 1: Set Up Firebase Admin SDK & Service Account Credentials**  
  Install `firebase-admin`, download service account credentials from Firebase Console, store them in `.env.local`, and create a server singleton.
* **Step 2: Create a Token Store (Email &rarr; Device Tokens Mapping)**  
  Set up storage (Drizzle ORM + PostgreSQL) to maintain device tokens for each email.
* **Step 3: Update the Frontend to Register User Email & Token**  
  Call the registration API whenever a user logs in or enables push notifications.
* **Step 4: Create the Backend Dispatch Route Handler (`/api/notifications/send`)**  
  Build the API endpoint that takes `{ targetEmail, title, body, actionUrl }`, looks up tokens, and dispatches via Firebase Admin.
* **Step 5: Create a Test Sender UI & Verify Delivery**  
  Add a UI form (`SendNotificationForm`) to test sending targeted notifications to any email and observe delivery.
* **Step 6: Token Unregistration on User Logout**  
  Unregister device tokens in the database and invalidate with Google FCM when users log out.
* **Step 7: Background Notification Action URL Routing & Deep Linking**  
  Handle background click events in `firebase-messaging-sw.js` to route users directly to `actionUrl`.
* **Step 8: In-App Notification Center / Inbox Bell**  
  Display the persistent notification history stored in PostgreSQL with unread badges and mark-as-read controls.
* **Step 9: User Notification Preferences & Categorization**  
  Allow users to opt into or out of specific notification categories (e.g., transactional, marketing, updates).
* **Step 10: PWA Offline Fallback Experience**  
  Provide a dedicated offline page when the user loses internet connectivity.

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
      webpush: {
        headers: {
          Urgency: "high", // 'very-low' | 'low' | 'normal' | 'high'
        },
        notification: {
          icon: "/favicon.ico",
          badge: "/favicon.ico",
          requireInteraction: true, // Keeps toast visible on desktop until dismissed
        },
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

### Dual Payload Design & Service Worker Extraction Pitfalls

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

#### ⚠️ Critical Service Worker Extraction Bug (`payload.data || payload.notification`)

A very common pitfall in `firebase-messaging-sw.js` is writing:

```javascript
// ❌ BROKEN: Exclusive fallback pattern
const data = payload.data || payload.notification || {};
const title = data.title || "New notification";
const body = data.body || "";
```

**Why this breaks in production**:
In JavaScript, `A || B` evaluates `A` first. Because `payload.data` is an object containing `{ actionUrl: "...", sentAt: "..." }`, it is truthy!
1. JavaScript chooses `payload.data` and **completely drops `payload.notification`**.
2. Because `payload.data` does not contain `title` or `body` (they are in `payload.notification`), `data.title` evaluates to `undefined`, falling back to `"New notification"`.
3. `data.body` evaluates to `undefined`, displaying a completely blank notification body (`""`)!

#### ✅ The Robust Payload Extraction Pattern

To safely extract from both blocks regardless of whether the message is a pure `notification`, pure `data`, or combined dual payload:

```javascript
// public/firebase-messaging-sw.js - Inside the 'push' event listener:

// 1. Separate both blocks
const notification = payload.notification || {};
const data = payload.data || {};

// 2. Chained fallback extraction (check notification first, then data, then default)
const title = notification.title || data.title || "New notification";
const body = notification.body || data.body || "";
const icon = notification.icon || data.icon || "/favicon.ico";

// 3. Merge custom data so notificationclick receives all routing metadata
const clickData = {
  ...data,
  ...notification,
  actionUrl: data.actionUrl || data.url || notification.click_action || "/",
};

const options = {
  body: body,
  icon: icon,
  badge: notification.badge || data.badge || "/favicon.ico",
  data: clickData,
};

event.waitUntil(self.registration.showNotification(title, options));
```

#### Why This Fix Works:
1. **Never Blank**: Whether the server dispatches `{ notification: { title, body } }`, `{ data: { title, body } }`, or both, the actual title and body are always found.
2. **Metadata Preserved**: Custom properties in `data` (e.g. `actionUrl`, `orderId`, `sentAt`) are merged into `event.notification.data`.
3. **Deep-Linking Alignment**: `actionUrl` is guaranteed to be available for the `notificationclick` handler instead of defaulting back to `"/"`.

---

## Platform-Specific Requirements Checklist

### Apple iOS (Safari 16.4+)
* **Standalone PWA Required**: Web Push **does not work in normal Safari tabs**. The user must open Share &rarr; **"Add to Home Screen"**, then launch the installed app.
* **Explicit User Gesture**: `Notification.requestPermission()` must be invoked from a direct user action (button click event), never on initial page load.
* **HTTPS**: Strict public HTTPS is mandatory (no self-signed certificates or plain HTTP).

### Android (Chrome / Chromium)
* **Android 13+ (API 33) Runtime Permission**: The browser automatically requests the system `POST_NOTIFICATIONS` runtime permission when `Notification.requestPermission()` is resolved.
* **Heads-Up Notifications**: Ensure notification priority is high so notifications pop over active apps.

### Windows & macOS Desktop (Closed Browser & Background Delivery)

#### Why Notifications Queue When the Browser/App is Completely Closed:
Unlike mobile platforms (Android has Google Play Services and iOS has APNs running 24/7 at the OS kernel level), desktop operating systems **do not have a native push daemon for web apps**. 

Instead, the **host browser engine (Google Chrome or Microsoft Edge) is itself the push client**.
* **When Chrome or the desktop PWA is closed with no background worker running**, the network socket to Google FCM (`mtalk.google.com:5228`) is severed.
* Firebase Cloud Messaging securely **queues** the notification in the cloud.
* The moment Chrome or the PWA window is launched, the socket reconnects, retrieves all queued messages, and your Service Worker instantly displays the notification toast.

#### Why "Continue running background apps when closed" Might Still Not Deliver When Closed:
Even if `chrome://settings/system` has **"Continue running background apps when Google Chrome is closed"** toggled ON, Chrome will only keep a background daemon alive if at least one installed extension or app explicitly registered a persistent background worker.

* **System Tray Verification**:
  1. Close all Chrome windows and close your desktop PWA.
  2. Click the `^` arrow next to your Windows clock in the system tray.
  3. If there is **no Chrome icon**, Chrome has fully exited from memory and closed the push socket.
  4. If the Chrome icon is present (*"Google Chrome is running in the background"*), the push socket is active and will receive pushes.

#### Setting High Urgency in FCM WebPush Payload:
By default, the Web Push Protocol assigns `normal` urgency to push messages. Chromium's power management can defer waking Service Workers for normal-priority messages until the browser window is focused.

To force immediate Service Worker wake-up and keep the toast visible on desktop:
```typescript
webpush: {
  headers: {
    Urgency: "high", // 'very-low' | 'low' | 'normal' | 'high'
  },
  notification: {
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    requireInteraction: true, // Desktop toast stays visible until the user dismisses it
  },
}
```

#### Windows Action Center & Focus Assist / Do Not Disturb:
Windows 10/11 frequently captures background notifications and silently deposits them into the Windows Action Center without popping up a toast banner:
1. Press **`Win + N`** to inspect the Windows Notification panel and check if the notification arrived silently.
2. In **Windows Settings &rarr; System &rarr; Notifications &rarr; Google Chrome**:
   * Verify **"Show notification banners"** is checked.
   * Verify **"Show notifications in notification center"** is checked.
   * Set priority to **"Top"** or **"High"**.
3. Ensure Windows **"Do Not Disturb"** (bell icon in taskbar) is turned **OFF**.

#### Diagnostic Test (PWA Closed vs. Chrome Open):
To verify that your PWA receives background notifications:
1. Leave a normal Chrome window open (e.g., on `google.com`), but **close your installed desktop PWA window**.
2. Dispatch a notification to your email.
3. Because the Chrome process is active, Windows will pop up the desktop notification toast for your PWA immediately, and clicking it will launch/focus the PWA.

---

## Step 6: User Logout & Token Lifecycle Management

### Does a User Still Receive Notifications After Logging Out?

**Yes.** With standard session-based auth (like NextAuth / Auth.js), logging out clears authentication cookies, but **does not stop Web Push notifications by default**.

#### Why Push Notifications Persist After Logout:
1. **Push Subscriptions Live at the OS & Browser Level**:
   * The Service Worker (`/sw.js` and `/firebase-messaging-sw.js`) and the browser push subscription operate independently of NextAuth session cookies.
   * Even when the browser tab is closed and no user session exists, the browser background daemon remains registered with Firebase Cloud Messaging (FCM).
2. **The Database Record Persists**:
   * When the user registered their device, their FCM token was stored in PostgreSQL (`deviceTokens` table) linked to their `userId`.
   * Standard logout clears the local auth session, but leaves the `deviceTokens` record untouched in the database.
3. **The Dispatch Handler Still Targets the Device**:
   * When an event calls `POST /api/notifications/send` targeting `user@example.com`, the server finds the token in `deviceTokens`, sends the message to Firebase Admin, and the device displays the notification.

#### Privacy & Security Risk on Shared Computers:
If User A logs out on a shared or public computer (e.g. library, internet cafe, office workstation), private notifications for User A will continue popping up as desktop notifications on that device until:
* User B logs in on that exact browser and enables notifications (which reassigns the token via `onConflictDoUpdate`), or
* The user manually revokes notification permissions in the browser settings.

---

### Implementing Token Unregistration on Logout

#### 6.1 Create the Unregister Route Handler (`app/api/notifications/unregister-token/route.ts`)

Create `app/api/notifications/unregister-token/route.ts` to purge the device token from the database:

```typescript
// app/api/notifications/unregister-token/route.ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/connection";
import { deviceTokens } from "@/lib/schema";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { token } = body;

    if (!token) {
      return NextResponse.json(
        { error: "Device token is required." },
        { status: 400 }
      );
    }

    await db.delete(deviceTokens).where(eq(deviceTokens.token, token));

    return NextResponse.json({
      success: true,
      message: "Device token unregistered successfully.",
    });
  } catch (error: any) {
    console.error("Error unregistering token:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to unregister token" },
      { status: 500 }
    );
  }
}
```

#### 6.2 Update the Client Logout Flow (`components/LogoutButton.tsx`)

In your logout handler, perform three cleanup tasks:
1. Delete the token from your database (`/api/notifications/unregister-token`).
2. Revoke the token from Google's FCM servers using `deleteToken(messaging)`.
3. Clear `localStorage` and sign out:

```tsx
// components/LogoutButton.tsx
"use client";

import { useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { deleteToken } from "firebase/messaging";
import { getClientMessaging } from "@/lib/firebase";

export function LogoutButton() {
  const { data: session } = useSession();
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    setLoading(true);
    const storageKey = `fcmToken_${session?.user?.name || "current"}`;
    const currentToken = localStorage.getItem(storageKey);

    try {
      if (currentToken) {
        // 1. Remove from database
        await fetch("/api/notifications/unregister-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: currentToken }),
        });

        // 2. Invalidate with Google FCM
        const messaging = await getClientMessaging();
        if (messaging) {
          await deleteToken(messaging);
        }
      }
    } catch (err) {
      console.error("Error cleaning up push token on logout:", err);
    } finally {
      // 3. Purge storage and clear session
      localStorage.removeItem(storageKey);
      await signOut({ callbackUrl: "/login" });
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleLogout}
      disabled={loading}
      className="px-3 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sm font-medium transition-colors disabled:opacity-50 cursor-pointer"
    >
      {loading ? "Logging out..." : "Log out"}
    </button>
  );
}
```

---

## Step 7: Background Notification Action URL Routing & Deep-Linking

When the application is closed or in the background, clicking an operating system notification triggers the `notificationclick` event in `public/firebase-messaging-sw.js`.

### 7.1 Align Payload Property Names
In `app/api/notifications/send/route.ts`, the dispatch route sends:
```typescript
data: {
  actionUrl: actionUrl, // e.g. "/orders/123"
  sentAt: new Date().toISOString(),
}
```
Ensure `public/firebase-messaging-sw.js` reads `payloadData?.actionUrl || payloadData?.url || "/"`:

```javascript
// public/firebase-messaging-sw.js
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const payloadData = event.notification.data || {};
  const targetUrl = payloadData.actionUrl || payloadData.url || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientsArr) => {
        // 1. If an existing window is open at the same origin, focus it and navigate
        for (const client of clientsArr) {
          if (client.url.startsWith(self.location.origin)) {
            client.postMessage({
              type: "FCM_ACTION",
              payload: payloadData,
            });
            client.navigate(targetUrl);
            return client.focus();
          }
        }
        // 2. Otherwise open a new window to the target URL
        return self.clients.openWindow(targetUrl);
      })
  );
});
```

### 7.2 Complete Robust Service Worker (`public/firebase-messaging-sw.js`)

Here is the complete, recommended Service Worker code combining proper Firebase compat initialization, dual-payload parsing, and deep-link click handling:

```javascript
// public/firebase-messaging-sw.js

// 1. Firebase configuration
const firebaseConfig = {
  apiKey: "your-api-key",
  authDomain: "your-app.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-app.firebasestorage.app",
  messagingSenderId: "your-sender-id",
  appId: "your-app-id",
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const messaging = firebase.messaging();

// 2. Push event listener (with dual payload extraction & fallback chaining)
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch (error) {
    console.error("Failed to parse push data:", error);
    return;
  }

  // Safe extraction from both blocks
  const notification = payload.notification || {};
  const data = payload.data || {};

  const title = notification.title || data.title || "New notification";
  const body = notification.body || data.body || "";
  const icon = notification.icon || data.icon || "/favicon.ico";

  const clickData = {
    ...data,
    ...notification,
    actionUrl: data.actionUrl || data.url || notification.click_action || "/",
  };

  const options = {
    body: body,
    icon: icon,
    badge: notification.badge || data.badge || "/favicon.ico",
    data: clickData,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// 3. Notification click listener (with deep-link focus & navigation)
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const payloadData = event.notification.data || {};
  const targetUrl = payloadData.actionUrl || payloadData.url || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientsArr) => {
        // Focus existing matching window if open
        for (const client of clientsArr) {
          if (client.url.startsWith(self.location.origin)) {
            client.postMessage({
              type: "FCM_ACTION",
              payload: payloadData,
            });
            client.navigate(targetUrl);
            return client.focus();
          }
        }
        // Otherwise open a new window to the target URL
        return self.clients.openWindow(targetUrl);
      })
  );
});
```

---

## Step 8: In-App Notification Center / Inbox Bell

Because `app/api/notifications/send/route.ts` records every message into the PostgreSQL `notifications` table, you can give users a persistent notification center in your header.

### 8.1 Create Notifications Fetch Route (`app/api/notifications/route.ts`)

```typescript
// app/api/notifications/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/connection";
import { notifications, users } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, session.user.email))
    .limit(1);

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const userNotifications = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, user.id))
    .orderBy(desc(notifications.createdAt))
    .limit(30);

  return NextResponse.json({ notifications: userNotifications });
}
```

### 8.2 Mark as Read Endpoint (`app/api/notifications/[id]/read/route.ts`)

```typescript
// app/api/notifications/[id]/read/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/connection";
import { notifications } from "@/lib/schema";
import { eq } from "drizzle-orm";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  await db
    .update(notifications)
    .set({ isRead: true })
    .where(eq(notifications.id, id));

  return NextResponse.json({ success: true });
}
```

### 8.3 Notification Bell Component (`components/NotificationBell.tsx`)

A bell icon with an unread badge that opens a dropdown popover:

```tsx
// components/NotificationBell.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  actionUrl: string | null;
  isRead: boolean;
  createdAt: string;
}

export function NotificationBell() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);

  const fetchNotifications = async () => {
    try {
      const res = await fetch("/api/notifications");
      if (res.ok) {
        const data = await res.json();
        setItems(data.notifications || []);
      }
    } catch (err) {
      console.error("Failed to load notifications:", err);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  const unreadCount = items.filter((n) => !n.isRead).length;

  const markAsRead = async (id: string) => {
    await fetch(`/api/notifications/${id}/read`, { method: "PATCH" });
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
    );
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        aria-label="Notifications"
      >
        <svg
          className="w-5 h-5 text-zinc-700 dark:text-zinc-300"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex items-center justify-center w-4 h-4 text-[10px] font-bold text-white bg-rose-600 rounded-full">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
            <span className="text-sm font-semibold">Notifications</span>
            {unreadCount > 0 && (
              <span className="text-xs text-zinc-500">{unreadCount} unread</span>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
            {items.length === 0 ? (
              <p className="p-4 text-xs text-center text-zinc-500">
                No notifications yet.
              </p>
            ) : (
              items.map((item) => (
                <div
                  key={item.id}
                  className={`p-3 text-xs transition-colors ${
                    item.isRead
                      ? "bg-transparent text-zinc-500"
                      : "bg-blue-50/50 dark:bg-blue-950/20 text-zinc-800 dark:text-zinc-200"
                  }`}
                >
                  <p className="font-semibold">{item.title}</p>
                  <p className="mt-0.5">{item.body}</p>
                  <div className="mt-2 flex items-center justify-between">
                    {item.actionUrl ? (
                      <Link
                        href={item.actionUrl}
                        onClick={() => markAsRead(item.id)}
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        View &rarr;
                      </Link>
                    ) : (
                      <span />
                    )}
                    {!item.isRead && (
                      <button
                        onClick={() => markAsRead(item.id)}
                        className="text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                      >
                        Mark as read
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

Mount `<NotificationBell />` inside `components/Header.tsx` next to your user greeting and logout button.

---

## Step 9: User Notification Preferences & Filtering

Using the `notificationPreferences` table defined in `lib/schema.ts`:

```typescript
export const notificationPreferences = pgTable("notification_preferences", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // 'marketing' | 'orders' | 'security'
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
```

### 9.1 Filter Before Dispatching Push
In `app/api/notifications/send/route.ts`, accept an optional `category` (e.g., `'marketing'`) and verify the recipient hasn't disabled it:

```typescript
// Inside app/api/notifications/send/route.ts:
const { targetEmail, title, body: messageBody, category = "transactional" } = body;

// Check user preferences
const [pref] = await db
  .select({ enabled: notificationPreferences.enabled })
  .from(notificationPreferences)
  .where(
    and(
      eq(notificationPreferences.userId, user.id),
      eq(notificationPreferences.type, category)
    )
  )
  .limit(1);

if (pref && !pref.enabled) {
  return NextResponse.json(
    { message: `User has muted "${category}" notifications. Skipped delivery.` },
    { status: 200 }
  );
}
```

---

## Step 10: PWA Offline Fallback Experience

To guarantee offline PWA capabilities when internet connectivity is lost:

### 10.1 Create `app/offline/page.tsx`

```tsx
// app/offline/page.tsx
export default function OfflinePage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
      <div className="p-4 bg-zinc-100 dark:bg-zinc-800 rounded-full mb-4">
        <svg
          className="w-10 h-10 text-zinc-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.828m2.829 2.828L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 4.243a9 9 0 01-12.728 0m0 0l2.829-2.828m-2.829 2.828L3 21m2.828-5.464a5 5 0 010-7.072m0 0l2.829 2.829"
          />
        </svg>
      </div>
      <h1 className="text-2xl font-bold mb-2">You are currently offline</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-sm mb-6">
        Please check your network connection. Any notifications dispatched to you will be delivered as soon as you reconnect.
      </p>
      <button
        onClick={() => window.location.reload()}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium transition-colors"
      >
        Retry Connection
      </button>
    </div>
  );
}
```

Configure `next.config.ts` with `fallbacks: { document: "/offline" }` under `withPWAInit` so `next-pwa` serves this page automatically whenever network requests fail.
