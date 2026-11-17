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

## Upcoming Steps Preview

### Step 2 Preview: Token Store
Create an abstraction (e.g. database table or in-memory map for dev) mapping:
```json
{
  "user@example.com": [
    "fcm_token_laptop_123...",
    "fcm_token_phone_456..."
  ]
}
```

### Step 3 Preview: Client Registration
In `PushManager.tsx`:
```typescript
await fetch("/api/notifications/register-token", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: user.email, token: currentToken }),
});
```

### Step 4 Preview: Dispatch Route Handler
In `app/api/notifications/send/route.ts`:
```typescript
const tokens = await getTokensByEmail(targetEmail);
await adminMessaging.sendEachForMulticast({
  tokens,
  notification: { title, body },
});
```
