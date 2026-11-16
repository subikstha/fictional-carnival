# FCM Device Token Guide: Concepts, Lifecycle & Architecture

This document explains what an FCM (Firebase Cloud Messaging) Registration Token is, when and why it is required, its uniqueness rules across users and browsers, and best practices for managing tokens in production.

---

## 1. What is an FCM Token?

An **FCM Registration Token** is a unique, cryptographically generated string issued by Firebase that serves as the **digital mailing address** for a specific device, browser, and app instance.

* **The Analogy**: If a push notification is a letter, the FCM token is the exact postal address and apartment number. Without it, Firebase cannot route the message to the intended device.
* **Under the Hood**: When you call `getToken()`, the browser’s native Push Service (e.g., Google FCM endpoint for Chrome, Apple APNs for Safari, Mozilla Autopush for Firefox) creates a `PushSubscription` with public encryption keys. Firebase exchanges these details with its servers and provides a unified FCM Token string that works across all supported browsers.

---

## 2. When is the FCM Token Required?

The token participates in two distinct phases of the push notification lifecycle:

```
[Phase 1: Registration]
User clicks "Allow" ──> Browser generates FCM Token ──> Saved to your Database
                                                               │
                                                               ▼
[Phase 2: Dispatch]
Event happens (e.g. Chat/Order) ──> Backend queries DB for Token ──> Sends via Firebase
```

### Phase 1: Client Generation & Storage (Frontend &rarr; Your Database)
* **When**: Immediately after the user grants notification permission via `Notification.requestPermission()`.
* **Action**: In `components/PushManager.tsx`, calling `getToken(...)` generates the token. The frontend sends this token to your backend API to associate it with the authenticated user:
  ```typescript
  // Example frontend call after receiving currentToken:
  await fetch("/api/notifications/save-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: user.id,
      token: currentToken,
      userAgent: navigator.userAgent,
    }),
  });
  ```

### Phase 2: Server Notification Dispatch (Your Backend &rarr; Firebase Admin SDK)
* **When**: Whenever your application needs to trigger a push notification (e.g., a message arrives, an order ships, an alert fires).
* **Action**: Your backend queries the database for the user's stored token(s) and provides it to the Firebase Admin SDK:
  ```typescript
  // Example backend sending push via Firebase Admin:
  import admin from "firebase-admin";

  await admin.messaging().send({
    token: userTokenFromDatabase, // <-- REQUIRED: Tells Firebase where to route
    notification: {
      title: "Order Delivered!",
      body: "Your package has arrived at your doorstep.",
    },
    data: {
      orderId: "12345",
      url: "/orders/12345",
    },
  });
  ```

---

## 3. Token Uniqueness & Scope

The FCM token is **unique to the combination of: Device + Browser Profile + Application**.

| Scenario | Same or Different Token? | Explanation |
| :--- | :---: | :--- |
| **User A vs. User B** | **Different** | Each user device has its own unique token. |
| **Same user on Laptop vs. Phone** | **Different** | John’s laptop has **Token A**; John’s phone has **Token B**. Your database should store both tokens under John’s user ID so both devices can receive notifications. |
| **Same user on Chrome vs. Edge on the same PC** | **Different** | Every browser maintains its own separate Service Worker environment and distinct push endpoints. |
| **Normal Tab vs. Incognito / Private Window** | **Different** | Incognito windows run in an isolated sandbox with temporary, independent token storage. |
| **Two different users logging into the same browser profile** | **Same** | Because they share the same physical browser profile. When User B logs in, your backend should reassign that token to User B (or dissociate it from User A). |

---

## 4. Token Expiration, Invalidation & Rotation

FCM tokens do not have a fixed expiration date, but they **can become invalid or change** under the following conditions:

1. **User clears site data**: Clearing browser history, cookies, or site storage wipes the local push credentials.
2. **Permission revoked**: The user manually changes browser site settings from *Allowed* to *Blocked*.
3. **App uninstalled**: The user uninstalls the PWA from their desktop or mobile home screen.
4. **Periodic Firebase Rotation**: Firebase security mechanisms may occasionally refresh tokens in the background.

---

## 5. Production Best Practices

### A. Database Schema: Support Multiple Devices per User
Because a single user often accesses your app from their phone, tablet, and laptop, design your database to store **multiple tokens per user**:

```json
// Example: User document in MongoDB/PostgreSQL
{
  "userId": "user_123",
  "name": "Jane Doe",
  "pushTokens": [
    {
      "token": "fcm_token_laptop_xyz...",
      "device": "Chrome on Windows",
      "createdAt": "2026-11-13T10:00:00Z",
      "lastUsedAt": "2026-11-16T08:30:00Z"
    },
    {
      "token": "fcm_token_phone_abc...",
      "device": "PWA on Android",
      "createdAt": "2026-11-14T14:20:00Z",
      "lastUsedAt": "2026-11-16T09:15:00Z"
    }
  ]
}
```

### B. Broadcast to All User Devices with `sendEachForMulticast`
When sending a notification to a user with multiple devices:
```typescript
const tokens = user.pushTokens.map((t) => t.token);

const response = await admin.messaging().sendEachForMulticast({
  tokens: tokens,
  notification: {
    title: "New Update",
    body: "You have a new message.",
  },
});
```

### C. Automatic Cleanup of Dead / Stale Tokens
When an FCM token becomes invalid (e.g. user uninstalled the app or cleared data), Firebase returns an error with the code `messaging/registration-token-not-registered`.

Always check the response and remove expired tokens from your database:

```typescript
response.responses.forEach((res, idx) => {
  if (!res.success) {
    const error = res.error;
    if (
      error?.code === "messaging/invalid-registration-token" ||
      error?.code === "messaging/registration-token-not-registered"
    ) {
      // Remove dead token from database
      const deadToken = tokens[idx];
      removeTokenFromDatabase(user.id, deadToken);
    }
  }
});
```

### D. Always Check for Fresh Tokens on App Load
Call `getToken()` inside a `useEffect` when an authenticated user opens the app. If the token returned by Firebase differs from what your database has recorded, silently update it so your backend never holds stale addresses.
