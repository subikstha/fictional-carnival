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

Create `lib/firebase-admin.ts`. This ensures Firebase Admin initializes only once across hot reloads and Next.js serverless invocations:

```typescript
// lib/firebase-admin.ts
import admin from "firebase-admin";

if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // Replace escaped newlines with actual newline characters
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    });
    console.log("✅ Firebase Admin initialized successfully");
  } catch (error) {
    console.error("❌ Firebase Admin initialization error:", error);
  }
}

export const adminMessaging = admin.messaging();
export default admin;
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

## Upcoming Steps Preview

### Step 3 Preview: Client Registration
In `PushManager.tsx`, send the token along with the logged-in user's email:
```typescript
await fetch("/api/notifications/register-token", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: currentUser.email, token: currentToken }),
});
```

### Step 4 Preview: Dispatch Route Handler
In `app/api/notifications/send/route.ts`:
Query the user's tokens using their email address, then dispatch:
```typescript
const tokens = await getTokensByEmail(targetEmail);
await adminMessaging.sendEachForMulticast({
  tokens,
  notification: { title, body },
});
```
