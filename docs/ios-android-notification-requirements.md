# iOS and Android Web Push Notification Requirements & Notes

This reference guide documents the platform-specific requirements, restrictions, and checklist items for delivering web push notifications to real Android and iOS (iPhone/iPad) devices.

---

## 1. Quick Platform Comparison Matrix

| Feature / Requirement | Android | iOS (16.4+) | Notes |
| :--- | :---: | :---: | :--- |
| **Works inside regular browser tab** | ✅ Yes | ❌ No | Apple strictly requires the PWA to be installed on the Home Screen first. |
| **Works when installed to Home Screen (PWA)** | ✅ Yes | ✅ Yes | Both platforms fully support background notifications in standalone mode. |
| **Push received when app is closed / phone locked** | ✅ Yes | ✅ Yes | Handled by OS push services (Google FCM & Apple APNs). |
| **HTTPS Requirement** | ✅ Yes (or `localhost`) | ⚠️ **Strict Public HTTPS** | iOS rejects local IP addresses (`http://192.168.x.x`). |
| **Permission Triggered by User Gesture** | Optional | ⚠️ **Mandatory** | Apple blocks automatic / on-load permission prompts. |
| **Firebase `isSupported()` in Safari tab** | Returns `true` | Returns `false` | Turns `true` only after launching from Home Screen. |
| **Badge Counter Support (`setAppBadge`)** | ✅ Supported | ✅ Supported | Updates app icon badge count in OS launcher. |

---

## 2. iOS (iPhone / iPad) Strict Requirements

Apple introduced Web Push support in **iOS 16.4 / iPadOS 16.4**. To receive push notifications on iOS, **every single one** of the following conditions must be met:

### 1. Mandatory "Add to Home Screen"
* Push notifications **do not work inside the mobile Safari browser tab**.
* The user must tap the **Share icon (`⎋`)** &rarr; select **"Add to Home Screen"** &rarr; launch the app from the resulting home screen icon.
* *Note on `isSupported()`*: Inside standard Safari, Firebase's `isSupported()` resolves to `false`. Once launched from the Home Screen, it resolves to `true`.

### 2. Mandatory User Gesture for Permission
* Apple will reject any call to `Notification.requestPermission()` that executes automatically (e.g., on page load or timer).
* It **must** be triggered by an explicit, direct user interaction (such as tapping an "Enable Notifications" button).

### 3. Strict Public HTTPS
* Apple Web Push will **not** work over unencrypted HTTP or raw local network IP addresses (e.g., `http://192.168.1.5:8009`).
* You must deploy to a public HTTPS domain (e.g., Vercel) or use an encrypted HTTPS tunnel (e.g., Cloudflare Tunnel / ngrok).

### 4. Apple Push Notification service (APNs) Delivery
* Firebase automatically bridges web push to APNs on Apple devices. 
* Notifications arrive through Apple's native notification center, lock screen, and Apple Watch (if paired).

---

## 3. Android Requirements & Considerations

Android (via Chrome, Edge, Samsung Internet, and other Chromium browsers) provides the most flexible Web Push environment.

### 1. Browser & PWA Support
* Notifications work whether the user visits via standard Chrome tabs or installs the PWA to their home screen as a WebAPK.

### 2. Android 13+ (API 33) Runtime Permission
* Starting with Android 13, push notifications require explicit user permission (the `POST_NOTIFICATIONS` runtime permission).
* Triggering `Notification.requestPermission()` prompts Android's native system dialog.

### 3. Icon Formatting (Status Bar & Tray)
* Android creates monochrome silhouette icons for the top status bar.
* **Avoid `.ico` files**: Always provide transparent PNG icons (e.g., `/icon-192x192.png`) rather than `/favicon.ico`, which can render distorted or blank on Android trays.

### 4. Battery Optimization & Doze Mode
* When an Android device is stationary and unplugged, it enters **Doze Mode**.
* Messages sent with `normal` priority may be delayed until the next maintenance window.
* Firebase Console campaigns send with **`high` priority** by default, waking the device immediately.

---

## 4. Critical Payload Parsing (Preventing Blank Notifications)

When Firebase sends notifications from the Firebase Console or backend API, the payload often contains **both** a `notification` object and a `data` object:

```json
{
  "notification": {
    "title": "Summer Sale",
    "body": "50% off all items"
  },
  "data": {
    "campaignId": "12345",
    "url": "/sale"
  }
}
```

### The Pitfall
Using `const data = payload.data || payload.notification || {};` selects `payload.data`. Because `payload.data` lacks `title` and `body`, the notification appears **blank** or with fallback text.

### The Robust Pattern for `public/firebase-messaging-sw.js`
Always inspect both objects:

```javascript
// public/firebase-messaging-sw.js
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch (err) {
    return;
  }

  // Check both notification block and data block
  const notification = payload.notification || {};
  const data = payload.data || {};

  const title = notification.title || data.title || "New Notification";
  const body = notification.body || data.body || "";

  const options = {
    body: body,
    icon: notification.icon || data.icon || "/icon-192x192.png",
    badge: "/icon-192x192.png",
    data: data,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});
```

---

## 5. Mobile Testing Checklist

Before testing on a physical iPhone or Android phone, verify:

- [ ] App is deployed to a public HTTPS domain (e.g. Vercel) or exposed via an HTTPS tunnel (`npx untun@latest tunnel http://localhost:8009`).
- [ ] Environment variables (`NEXT_PUBLIC_FIREBASE_*` and `NEXT_PUBLIC_FIREBASE_VAPID_KEY`) are configured in production.
- [ ] Built with Webpack (`npm run build` using `--webpack`) so `/sw.js` contains the Firebase `importScripts`.
- [ ] **On iOS**: Tapped **Share &rarr; Add to Home Screen** and opened the app from the Home Screen.
- [ ] User tapped the "Enable Notifications" button directly (satisfying the user gesture rule).
- [ ] Copied the generated **FCM Device Token** into Firebase Console.
- [ ] Device is **not** on silent "Do Not Disturb" / iOS Focus mode / Android Bedtime mode blocking banner alerts.
- [ ] Sent a test notification from Firebase Console while the app is in the background or device is locked.
