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
* **Step 11: OS App Badge API (`navigator.setAppBadge`)**  
  Display unread notification counters directly on the PWA desktop taskbar icon and mobile home screen icon.

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
        title: title,
        body: messageBody,
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

### 5.1 Create Users Endpoint (`app/api/users/route.ts`)

To allow dispatching notifications to any registered user (or multiple users at once) without requiring manual typing of email addresses, create `app/api/users/route.ts` to retrieve all registered users and their active device counts:

```typescript
// app/api/users/route.ts
import { auth } from "@/auth";
import { db } from "@/lib/connection";
import { users, deviceTokens } from "@/lib/schema";
import { count, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const allUsers = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        deviceCount: count(deviceTokens.id),
      })
      .from(users)
      .leftJoin(deviceTokens, eq(users.id, deviceTokens.userId))
      .groupBy(users.id, users.username, users.email);

    return NextResponse.json({ users: allUsers });
  } catch (error: any) {
    console.error("Error fetching users:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to fetch users" },
      { status: 500 }
    );
  }
}
```

---

### 5.2 Create Multi-User `SendNotificationForm.tsx`

Create `components/SendNotificationForm.tsx` with interactive user cards supporting multi-user selection, device status badges, select/clear all shortcuts, and batch dispatching:

```tsx
// components/SendNotificationForm.tsx
"use client";

import { useEffect, useState } from "react";

interface UserItem {
  id: string;
  username: string;
  email: string;
  deviceCount?: number;
}

interface SendNotificationFormProps {
  defaultTargetEmail?: string;
}

export function SendNotificationForm({
  defaultTargetEmail = "",
}: SendNotificationFormProps) {
  const [usersList, setUsersList] = useState<UserItem[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [selectedEmails, setSelectedEmails] = useState<string[]>([]);

  const [title, setTitle] = useState("Hello from Next.js! 🚀");
  const [body, setBody] = useState(
    "This is a targeted push notification sent by email."
  );
  const [actionUrl, setActionUrl] = useState("/user/notifications");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    success?: boolean;
    deliveredToDevices?: number;
    failedDevices?: number;
    recipientsCount?: number;
    message?: string;
    error?: string;
  } | null>(null);

  // Fetch users from database
  useEffect(() => {
    async function fetchUsers() {
      try {
        setLoadingUsers(true);
        const res = await fetch("/api/users");
        if (!res.ok) throw new Error("Failed to fetch users");
        const data = await res.json();
        const users: UserItem[] = data.users || [];
        setUsersList(users);

        if (defaultTargetEmail && users.some((u) => u.email === defaultTargetEmail)) {
          setSelectedEmails([defaultTargetEmail]);
        }
      } catch (err) {
        console.error("Error loading users:", err);
      } finally {
        setLoadingUsers(false);
      }
    }

    fetchUsers();
  }, [defaultTargetEmail]);

  const toggleUser = (email: string) => {
    setSelectedEmails((prev) =>
      prev.includes(email)
        ? prev.filter((e) => e !== email)
        : [...prev, email]
    );
  };

  const selectAll = () => setSelectedEmails(usersList.map((u) => u.email));
  const deselectAll = () => setSelectedEmails([]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedEmails.length === 0) {
      setResult({ error: "Please select at least one recipient user." });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/notifications/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetEmails: selectedEmails,
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
          recipientsCount: data.recipientsCount,
          message: data.message,
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
        {usersList.length > 0 && (
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              onClick={selectAll}
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              Select All
            </button>
            <span className="text-zinc-400">|</span>
            <button
              type="button"
              onClick={deselectAll}
              className="text-zinc-500 hover:underline"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      <p className="text-xs text-zinc-500 mb-3">
        Select one or more recipient users to send push and in-app notifications.
      </p>

      <form onSubmit={handleSend} className="space-y-4">
        {/* Recipient User Selection Cards */}
        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
            Select Recipients ({selectedEmails.length} selected)
          </label>

          {loadingUsers ? (
            <div className="p-4 text-center text-xs text-zinc-400 animate-pulse border rounded bg-white dark:bg-black">
              Loading users from database...
            </div>
          ) : usersList.length === 0 ? (
            <div className="p-4 text-center text-xs text-zinc-500 border rounded bg-white dark:bg-black">
              No registered users found in the database.
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
              {usersList.map((user) => {
                const isSelected = selectedEmails.includes(user.email);
                const hasDevices = (user.deviceCount || 0) > 0;

                return (
                  <div
                    key={user.id}
                    onClick={() => toggleUser(user.email)}
                    className={`p-2.5 rounded-md border text-left cursor-pointer transition-all flex items-center justify-between ${
                      isSelected
                        ? "border-blue-500 bg-blue-50/70 dark:bg-blue-950/40 ring-1 ring-blue-500"
                        : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black hover:border-zinc-300 dark:hover:border-zinc-700"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] text-white transition-colors flex-shrink-0 ${
                          isSelected ? "bg-blue-600" : "border border-zinc-400"
                        }`}
                      >
                        {isSelected && "✓"}
                      </div>

                      <div className="truncate">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                            {user.username}
                          </span>
                          {user.email === defaultTargetEmail && (
                            <span className="text-[10px] bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 px-1 py-0.2 rounded">
                              You
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-zinc-500 truncate">
                          {user.email}
                        </p>
                      </div>
                    </div>

                    <div className="flex-shrink-0 text-right ml-2">
                      <span
                        className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                          hasDevices
                            ? "bg-green-100 dark:bg-green-950/60 text-green-700 dark:text-green-300"
                            : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500"
                        }`}
                      >
                        {hasDevices
                          ? `${user.deviceCount} device${user.deviceCount! > 1 ? "s" : ""}`
                          : "No devices"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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
            Action URL (destination on click)
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
          disabled={loading || selectedEmails.length === 0}
          className="w-full py-2 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded transition-colors cursor-pointer"
        >
          {loading
            ? "Dispatching..."
            : `Send to ${selectedEmails.length} User${selectedEmails.length === 1 ? "" : "s"}`}
        </button>
      </form>

      {result?.success && (
        <div className="mt-4 p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 rounded text-xs text-emerald-800 dark:text-emerald-200">
          <p className="font-semibold">✓ Notification dispatched!</p>
          <p>
            Targeted {result.recipientsCount} user(s) &bull; Delivered to{" "}
            {result.deliveredToDevices} active device(s).
          </p>
          {result.message && (
            <p className="mt-1 text-zinc-600 dark:text-zinc-400">
              {result.message}
            </p>
          )}
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

> [!CAUTION]
> **Next.js 16 `cacheComponents: true` — Never Use `export const dynamic` in Route Handlers or Pages**
>
> When [`cacheComponents`](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents) is enabled in `next.config.ts`, the route segment configs `dynamic`, `revalidate`, and `fetchCache` are **completely replaced** by `"use cache"`, `cacheLife`, and `connection()`. Exporting any of them produces a hard Webpack build error:
> ```text
> Error: Route segment config "dynamic" is not compatible with `nextConfig.cacheComponents`. Please remove it.
> ```
>
> **Why this happens**: Cache Components introduces a new rendering model where Next.js prerenders every route (including `GET` Route Handlers) at build time by default. The old `dynamic = "force-dynamic"` flag is no longer recognized — it conflicts with the new validation system.

### How `connection()` Replaces `dynamic = "force-dynamic"` in Route Handlers

With `cacheComponents` enabled, Next.js attempts to **prerender every `GET` Route Handler at build time** — it runs your handler during `next build` to generate a static response. Route Handlers that call `auth()`, `cookies()`, or `headers()` (Request-time APIs) need a way to tell Next.js: *"Skip prerendering — this handler requires a live request."*

The [`connection()`](https://nextjs.org/docs/app/api-reference/functions/connection) function from `next/server` is that signal. When Next.js encounters `await connection()` during prerendering, it **immediately and cleanly aborts the prerender** before any of your application code runs. It uses an internal React mechanism to halt rendering above your handler, so it never reaches your `try/catch` blocks.

#### The Problem Without `connection()`

```
Build starts → Next.js prerenders GET handler
  → Enters your try/catch block
  → auth() calls cookies()/headers() internally
  → Next.js throws an internal prerender abort signal
  → Your catch block catches it (it looks like a regular error)
  → Handler returns a 500 JSON response
  → Next.js sees a "successful" prerender with wrong content
  → Build crashes with HANGING_PROMISE_REJECTION
```

#### The Fix With `connection()`

```
Build starts → Next.js prerenders GET handler
  → Hits await connection()
  → Next.js cleanly skips prerender (handler marked as dynamic)
  → At request time, runs the full handler normally
  → Build succeeds ✅
```

#### Correct Pattern for Dynamic Route Handlers

```typescript
// app/api/users/route.ts
import { auth } from "@/auth";
import { NextResponse, connection } from "next/server";

// ❌ NEVER do this with cacheComponents: true
// export const dynamic = "force-dynamic";

export async function GET() {
  // ✅ Signal that this handler needs a live request.
  // Place BEFORE try/catch so the prerender abort is not swallowed.
  await connection();

  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // ... database queries ...
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json({ error: "Server Error" }, { status: 500 });
  }
}
```

> [!IMPORTANT]
> **Place `await connection()` _before_ the `try/catch` block.** If `connection()` is inside the `try`, the prerender abort signal it triggers could theoretically be caught by your `catch` block in edge cases. Placing it at the top of the handler ensures Next.js cleanly skips prerendering at the framework level before your application error handling starts.

### How `<Suspense>` Replaces `dynamic = "force-dynamic"` in Pages

Pages use JSX and can leverage React's `<Suspense>` boundary instead of `connection()`. The pattern is to split the page into a synchronous static shell and an async inner component:

```tsx
// app/user/notifications/page.tsx
import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

// ❌ NEVER do this with cacheComponents: true
// export const dynamic = "force-dynamic";

// Inner async component — calls Request-time APIs
async function NotificationsContent() {
  const session = await auth();
  if (!session) redirect("/login");
  return <main>...</main>;
}

// Outer synchronous component — Next.js prerenders this into a static shell
export default function NotificationsPage() {
  return (
    <Suspense fallback={<p>Loading...</p>}>
      <NotificationsContent />
    </Suspense>
  );
}
```

The outer component is **synchronous and static** — Next.js prerenders it into an instant HTML shell. The async `NotificationsContent` (which calls `auth()`) is wrapped in `<Suspense>`, telling Next.js: *"This part is dynamic — render the fallback at build time and stream the real content at request time."*

| Mechanism | Where to use | What it does |
|:---|:---|:---|
| `await connection()` | `GET` Route Handlers (`route.ts`) | Cleanly aborts prerender; handler runs only at request time |
| `<Suspense fallback={...}>` | Pages and Layouts (`page.tsx`, `layout.tsx`) | Prerenders the shell with the fallback; streams dynamic content at request time |
| `export const instant = false` | Pages/Layouts not ready to migrate yet | Allows the page to block navigation (opt out of instant validation) without fully migrating |

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
    // 1. Locate token from user-specific key or scan for any active fcmToken_*
    const storageKey = `fcmToken_${session?.user?.name || "current"}`;
    let currentToken = localStorage.getItem(storageKey);
    const keysToRemove: string[] = [storageKey];

    if (!currentToken) {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("fcmToken_")) {
          currentToken = localStorage.getItem(key);
          keysToRemove.push(key);
          break;
        }
      }
    }

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
      // 3. Purge all stored tokens and clear session
      keysToRemove.forEach((k) => localStorage.removeItem(k));
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

### FCM Token Expiration & Rotation Lifecycle

A common question is whether FCM tokens expire. They **do not have a fixed expiration date** (unlike JWTs), but they **can and do become invalid** through several mechanisms.

#### When an FCM Token Becomes Invalid

| Scenario | Cause | Detection |
|:---|:---|:---|
| User clears browser / site data | Token destroyed along with service worker registration | Next `getToken()` returns a new token |
| User revokes notification permission | Token invalidated by the browser | `Notification.permission` reads `"default"` or `"denied"` |
| Browser profile is deleted | Token gone with the profile | No client-side detection possible |
| Firebase rotates the token | Periodic rotation (no guaranteed schedule — could be weeks or months) | Next `getToken()` returns a new token |
| App not opened for ~2 months | Firebase may garbage-collect inactive tokens | Send failure: `messaging/registration-token-not-registered` |
| Service worker is unregistered | Push subscription is severed | Next `getToken()` returns a new token |
| User uninstalls the PWA | Browser cleans up service worker and token | No client-side detection possible |

> [!NOTE]
> Firebase does **not** document a specific expiration timeframe. Tokens can remain valid for months or even years if the user keeps the app installed and the browser profile intact. The ~2 month inactivity window is an observed behavior, not an official guarantee.

#### How This App Handles Token Rotation (Already Implemented)

This project covers both sides of the lifecycle — **refresh on load** (client) and **prune on failure** (server):

**1. Client-side: Refresh on every session (`PushManager.tsx`)**

```tsx
// In PushManager.tsx useEffect:
if (currentPerm === "granted") {
  retrieveToken(); // calls getToken() on every page load
}
```

Every time the app loads and permission is `"granted"`, `getToken()` is called. If Firebase has rotated the token, `getToken()` transparently returns the new one. The result is sent to the backend via `/api/notifications/register-token`, which uses `onConflictDoUpdate` — so if the token changed, the new one replaces the old in the `deviceTokens` table.

**2. Server-side: Prune dead tokens on send failure (`/api/notifications/send`)**

```tsx
// In the send route, after sendEachForMulticast:
const failedTokens = responses
  .filter((r) => !r.success)
  .filter((r) => {
    const code = r.error?.code;
    return (
      code === "messaging/registration-token-not-registered" ||
      code === "messaging/invalid-registration-token"
    );
  })
  .map((_, i) => tokens[i]);

// Delete stale tokens from the database
if (failedTokens.length > 0) {
  await db.delete(deviceTokens).where(inArray(deviceTokens.token, failedTokens));
}
```

When Firebase returns `messaging/registration-token-not-registered` or `messaging/invalid-registration-token`, the token is automatically purged from the database, preventing wasted quota on future sends.

#### Token Lifecycle Flow

```
User opens app → getToken() called
  │
  ├── Token unchanged → backend upsert is a no-op
  │
  ├── Token was rotated by Firebase → getToken() returns NEW token
  │   └── Backend upsert replaces old token with new one ✅
  │
  ├── Token is invalid (site data cleared, SW unregistered)
  │   └── getToken() generates a brand new token
  │       └── Backend inserts the new token ✅
  │
  └── User never reopens app (~2 months)
      └── Firebase GC's the token
          └── Next send attempt returns registration-token-not-registered
              └── Server prunes the dead token from DB ✅
```

> [!TIP]
> **No additional code is needed.** The combination of calling `getToken()` on every page load and pruning dead tokens on send failure covers all token rotation and expiration scenarios. There is no `onTokenRefresh` callback to implement — in modern Firebase Web SDK (v9+), `getToken()` itself handles rotation transparently.

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

### 8.1 Create Notifications Fetch Route (`app/api/notifications/route.ts` or `/api/notifications/get`)

> [!IMPORTANT]
> **Always call `await connection()` from `next/server`** before accessing `auth()` so that Next.js 16 (with `cacheComponents: true`) cleanly skips build-time prerendering.

```typescript
// app/api/notifications/route.ts (or app/api/notifications/get/route.ts)
import { NextResponse, connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/connection";
import { notifications, users } from "@/lib/schema";
import { eq, desc, and } from "drizzle-orm";

export async function GET() {
  await connection();

  const session = await auth();
  if (!session?.user?.id && !session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Find user by session id or email
  let userId = session.user.id;
  if (!userId) {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, session.user.email!))
      .limit(1);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    userId = user.id;
  }

  const userNotifications = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(50);

  const unreadCount = userNotifications.filter((n) => !n.isRead).length;

  return NextResponse.json({
    notifications: userNotifications,
    unreadCount,
  });
}
```

### 8.2 Mark as Read Endpoints

#### Single Notification: `app/api/notifications/[id]/read/route.ts`
```typescript
// app/api/notifications/[id]/read/route.ts
import { NextResponse, connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/connection";
import { notifications } from "@/lib/schema";
import { eq, and } from "drizzle-orm";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  await db
    .update(notifications)
    .set({ isRead: true, readAt: new Date() })
    .where(
      and(
        eq(notifications.id, id),
        eq(notifications.userId, session.user.id)
      )
    );

  return NextResponse.json({ success: true });
}
```

#### Mark All as Read: `app/api/notifications/read-all/route.ts`
```typescript
// app/api/notifications/read-all/route.ts
import { NextResponse, connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/connection";
import { notifications } from "@/lib/schema";
import { eq, and } from "drizzle-orm";

export async function POST() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await db
    .update(notifications)
    .set({ isRead: true, readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, session.user.id),
        eq(notifications.isRead, false)
      )
    );

  return NextResponse.json({ success: true });
}
```

### 8.3 Notification Bell Component (`components/NotificationBell.tsx`)

A bell icon with an unread badge that opens a dropdown popover:

```tsx
// components/NotificationBell.tsx
"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import type { Notification } from "@/lib/schema";

export function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

    // Close popover when clicking outside
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const unreadCount = items.filter((n) => !n.isRead).length;

  const markAsRead = async (id: string) => {
    await fetch(`/api/notifications/${id}/read`, { method: "PATCH" });
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
    );
  };

  const markAllAsRead = async () => {
    await fetch("/api/notifications/read-all", { method: "POST" });
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
  };

  return (
    <div className="relative" ref={dropdownRef}>
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
          <span className="absolute top-1 right-1 flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-bold text-white bg-rose-600 rounded-full animate-pulse">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
            <span className="text-sm font-semibold">Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 font-medium"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
            {items.length === 0 ? (
              <p className="p-4 text-xs text-center text-zinc-500">
                No notifications yet.
              </p>
            ) : (
              items.slice(0, 10).map((item) => (
                <div
                  key={item.id}
                  className={`p-3 text-xs transition-colors ${
                    item.isRead
                      ? "bg-transparent text-zinc-500"
                      : "bg-blue-50/50 dark:bg-blue-950/20 text-zinc-800 dark:text-zinc-200"
                  }`}
                >
                  <p className="font-semibold">{item.title}</p>
                  <p className="mt-0.5 text-zinc-600 dark:text-zinc-400">{item.body}</p>
                  <div className="mt-2 flex items-center justify-between">
                    {item.actionUrl ? (
                      <Link
                        href={item.actionUrl}
                        onClick={() => markAsRead(item.id)}
                        className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
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

          <div className="p-2 border-t border-zinc-200 dark:border-zinc-800 text-center bg-zinc-50 dark:bg-zinc-950">
            <Link
              href="/user/notifications"
              onClick={() => setOpen(false)}
              className="text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 font-medium"
            >
              See all notifications &rarr;
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
```

### 8.4 Mount `<NotificationBell />` in `components/Header.tsx`

Update `components/Header.tsx` so authenticated users see the Notification Bell right next to their username and logout button:

```tsx
// components/Header.tsx
import { Suspense } from "react";
import Link from "next/link";
import { auth } from "@/auth";
import { LogoutButton } from "./LogoutButton";
import { NotificationBell } from "./NotificationBell";

async function AuthNav() {
  const session = await auth();
  const user = session?.user;

  if (user) {
    return (
      <div className="flex items-center gap-4 text-sm">
        <NotificationBell />
        <span className="text-zinc-600 dark:text-zinc-400">
          Signed in as{" "}
          <strong className="text-zinc-900 dark:text-zinc-100 font-semibold">
            {user.name || user.email}
          </strong>
        </span>
        <LogoutButton />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 text-sm">
      <Link href="/login" className="text-zinc-600 hover:text-zinc-900 font-medium">
        Log in
      </Link>
      <Link href="/signup" className="px-3 py-1.5 rounded-md bg-zinc-900 text-white font-medium">
        Sign up
      </Link>
    </div>
  );
}
```

### 8.5 Interactive Notifications Inbox (`components/NotificationsClient.tsx`)

Enhance the full page at `/user/notifications` with unread tabs, "Mark as Read", "Mark All Read", and formatted timestamps:

```tsx
// components/NotificationsClient.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Notification } from "@/lib/schema";

export default function NotificationsClient() {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const loadNotifications = async () => {
    try {
      const res = await fetch("/api/notifications");
      if (res.ok) {
        const data = await res.json();
        setItems(data.notifications || []);
      }
    } catch (err) {
      console.error("Failed to load notifications:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotifications();
  }, []);

  const markAsRead = async (id: string) => {
    await fetch(`/api/notifications/${id}/read`, { method: "PATCH" });
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
    );
  };

  const markAllAsRead = async () => {
    await fetch("/api/notifications/read-all", { method: "POST" });
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
  };

  const filteredItems = items.filter((n) =>
    filter === "unread" ? !n.isRead : true
  );
  const unreadCount = items.filter((n) => !n.isRead).length;

  if (loading) return <p className="animate-pulse text-sm text-zinc-500">Loading notifications...</p>;

  return (
    <div className="space-y-4">
      {/* Action Bar */}
      <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex gap-2">
          <button
            onClick={() => setFilter("all")}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              filter === "all"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
            }`}
          >
            All ({items.length})
          </button>
          <button
            onClick={() => setFilter("unread")}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              filter === "unread"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
            }`}
          >
            Unread ({unreadCount})
          </button>
        </div>

        {unreadCount > 0 && (
          <button
            onClick={markAllAsRead}
            className="text-xs text-blue-600 hover:underline font-medium cursor-pointer"
          >
            Mark all as read
          </button>
        )}
      </div>

      {filteredItems.length === 0 ? (
        <p className="text-sm text-zinc-500 py-8 text-center">
          {filter === "unread" ? "No unread notifications." : "No notifications found."}
        </p>
      ) : (
        <ul className="space-y-3">
          {filteredItems.map((n) => (
            <li
              key={n.id}
              className={`p-4 border rounded-lg transition-all ${
                n.isRead
                  ? "bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400"
                  : "bg-blue-50/40 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900 text-zinc-900 dark:text-zinc-100 shadow-xs"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    {!n.isRead && (
                      <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0" />
                    )}
                    <h2 className="font-semibold text-sm">{n.title}</h2>
                  </div>
                  <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">{n.body}</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {n.actionUrl && (
                    <Link
                      href={n.actionUrl}
                      onClick={() => markAsRead(n.id)}
                      className="text-xs text-blue-600 hover:underline font-medium"
                    >
                      View &rarr;
                    </Link>
                  )}
                  {!n.isRead && (
                    <button
                      onClick={() => markAsRead(n.id)}
                      className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                    >
                      Mark read
                    </button>
                  )}
                </div>
              </div>
              <p className="text-[10px] text-zinc-400 mt-3">
                {new Date(n.createdAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

---

## Step 9: User Notification Preferences & Filtering

Using the `notificationPreferences` table defined in `lib/schema.ts`:

```typescript
// lib/schema.ts
export const notificationPreferences = pgTable("notification_preferences", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  pushEnabled: boolean("push_enabled").notNull().default(true),
  emailEnabled: boolean("email_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
```

### 9.1 Preferences API Endpoint (`app/api/user/preferences/route.ts`)

```typescript
// app/api/user/preferences/route.ts
import { NextResponse, connection } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/connection";
import { notificationPreferences } from "@/lib/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get or initialize preferences
  let [prefs] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, session.user.id))
    .limit(1);

  if (!prefs) {
    [prefs] = await db
      .insert(notificationPreferences)
      .values({ userId: session.user.id, pushEnabled: true, emailEnabled: true })
      .returning();
  }

  return NextResponse.json({ preferences: prefs });
}

export async function PATCH(request: Request) {
  await connection();
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { pushEnabled, emailEnabled } = body;

  const [updated] = await db
    .insert(notificationPreferences)
    .values({
      userId: session.user.id,
      pushEnabled: pushEnabled ?? true,
      emailEnabled: emailEnabled ?? true,
    })
    .onConflictDoUpdate({
      target: notificationPreferences.userId,
      set: {
        ...(pushEnabled !== undefined && { pushEnabled }),
        ...(emailEnabled !== undefined && { emailEnabled }),
        updatedAt: new Date(),
      },
    })
    .returning();

  return NextResponse.json({ preferences: updated });
}
```

### 9.2 Filter Muted Users Before Dispatching Push (`app/api/notifications/send/route.ts`)

When dispatching, query `notificationPreferences` alongside `users`:

```typescript
// Inside app/api/notifications/send/route.ts
// 1. Check if recipient has muted push notifications
const preferences = await db
  .select({
    userId: notificationPreferences.userId,
    pushEnabled: notificationPreferences.pushEnabled,
  })
  .from(notificationPreferences)
  .where(inArray(notificationPreferences.userId, userIds));

const mutedUserIds = new Set(
  preferences.filter((p) => !p.pushEnabled).map((p) => p.userId)
);

// 2. Filter device tokens: only send push to users where push is NOT muted
const eligibleUserIds = userIds.filter((id) => !mutedUserIds.has(id));

// Tokens to multicast:
const tokenRecords = eligibleUserIds.length > 0
  ? await db
      .select({ token: deviceTokens.token })
      .from(deviceTokens)
      .where(inArray(deviceTokens.userId, eligibleUserIds))
  : [];
```
*(Notice: The in-app notification inbox insert still saves for all targeted users so they can read the notification when they open the app, while their OS desktop push is cleanly respected!)*

---

## Step 10: PWA Offline Fallback Experience

To guarantee offline PWA capabilities when internet connectivity is lost:

### 10.1 Create `app/offline/page.tsx`

```tsx
// app/offline/page.tsx
"use client";

import { useEffect, useState } from "react";

export default function OfflinePage() {
  const [isOnline, setIsOnline] = useState(false);

  useEffect(() => {
    setIsOnline(navigator.onLine);

    const handleOnline = () => {
      setIsOnline(true);
      window.location.reload();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

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
        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium transition-colors cursor-pointer"
      >
        Retry Connection
      </button>
    </div>
  );
}
```

### 10.2 Configure Fallback in `next.config.ts`

Configure `next.config.ts` with `fallbacks: { document: "/offline" }` under `withPWAInit` so `next-pwa` serves this page automatically whenever network requests fail:

```typescript
// next.config.ts
const withPWA = withPWAInit({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
  fallbacks: {
    document: "/offline", // Serves /offline whenever network fetch fails
  },
  importScripts: [
    "https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js",
    "https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js",
    "/firebase-messaging-sw.js",
  ],
});
```

---

## Step 11: OS App Badge API (`navigator.setAppBadge`)

The Web Badging API allows installed PWAs on Windows (taskbar icon), Android (launcher icon badge), and macOS (dock) to display a notification count directly on the application icon.

### 11.1 Update the Badge in Service Worker (`public/firebase-messaging-sw.js`)

When a push arrives, increment or set the badge:

```javascript
// Inside public/firebase-messaging-sw.js:
self.addEventListener("push", (event) => {
  // ... show notification logic ...

  // Update OS App Badge if supported
  if ("setAppBadge" in navigator) {
    // Increment or set to unread count if provided in payload
    const badgeCount = parseInt(data.unreadCount || "1", 10);
    navigator.setAppBadge(badgeCount).catch((err) => {
      console.warn("Failed to set app badge", err);
    });
  }
});
```

### 11.2 Clear the Badge when User Views Notifications

When the user opens the notification inbox or marks items as read:

```typescript
// Inside components/NotificationsClient.tsx or NotificationBell.tsx:
const clearBadge = () => {
  if ("clearAppBadge" in navigator) {
    navigator.clearAppBadge().catch((err) => console.warn(err));
  }
};
```
