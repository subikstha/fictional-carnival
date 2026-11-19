# iOS, Android & Desktop Web Push Notification Requirements & Notes

This reference guide documents the platform-specific requirements, restrictions, and checklist items for delivering web push notifications to real Android, iOS (iPhone/iPad), and desktop (Windows/macOS) devices.

---

## 1. Quick Platform Comparison Matrix

| Feature / Requirement | Android | iOS (16.4+) | Desktop (Windows/macOS) | Notes |
| :--- | :---: | :---: | :---: | :--- |
| **Works inside regular browser tab** | ✅ Yes | ❌ No | ✅ Yes (Chrome, Edge, Firefox) | Apple strictly requires the PWA to be installed on the Home Screen first. |
| **Works when installed to Home Screen (PWA)** | ✅ Yes | ✅ Yes | ✅ Yes | Both platforms fully support background notifications in standalone mode. |
| **Push received when app is closed / phone locked** | ✅ Yes | ✅ Yes | ⚠️ Depends on browser | Requires browser background process (see Section 4 for Edge). |
| **HTTPS Requirement** | ✅ Yes (or `localhost`) | ⚠️ **Strict Public HTTPS** | ✅ Yes (or `localhost`) | iOS rejects local IP addresses (`http://192.168.x.x`). |
| **Permission Triggered by User Gesture** | Optional | ⚠️ **Mandatory** | Optional | Apple blocks automatic / on-load permission prompts. |
| **Firebase `isSupported()` in Safari tab** | Returns `true` | Returns `false` | Returns `true` | Turns `true` only after launching from Home Screen on iOS. |
| **Badge Counter Support (`setAppBadge`)** | ✅ Supported | ✅ Supported | ✅ Supported (Chromium) | Updates app icon badge count in OS launcher. |

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

## 4. Desktop — Microsoft Edge PWA Push (Windows)

Edge PWAs on Windows run as separate windows but still depend on the Edge browser engine under the hood. This creates several pitfalls that Chrome users never encounter.

### Why Notifications Stop When Edge / the PWA Is Closed

On desktop, **the browser's background process is the push relay**. Unlike Android (where Google Play Services has a system-level FCM daemon that is always alive) or iOS (where APNs is baked into the OS), on Windows the browser itself must stay resident in memory to receive push events and wake the service worker.

- **Chrome**: Keeps a background process running by default even after all Chrome windows are closed. Push events are delivered to the service worker transparently.
- **Edge**: **Kills all background processes by default** when the last Edge window (or PWA window) is closed. With no process running, the OS has nowhere to deliver the push event — the notification is silently lost.

#### Fix: Enable Edge Background Apps

Navigate to:

```
edge://settings/system
```

Enable **"Continue running background extensions and apps when Microsoft Edge is closed"**.

This keeps a small Edge background process alive after close, allowing the service worker to receive `push` events and call `self.registration.showNotification()`.

### Why Notification Permission Resets / Session Is Lost on Close

If `Notification.permission` reads `"default"` instead of `"granted"` after reopening the PWA, and the user is logged out, Edge is **clearing site data on close**. This wipes the session cookie, IndexedDB, and cached permission state all at once.

#### Fix: Disable Data Clearing on Close

Navigate to:

```
edge://settings/privacy
```

Scroll to **"Choose what to clear every time you close the browser"** and ensure the following are **OFF**:

| Setting | Must be | Why |
|:---|:---:|:---|
| Cookies and other site data | **OFF** | Session cookies, IndexedDB, and service worker registrations are stored here. Clearing them logs the user out and effectively unregisters push. |
| Site permissions | **OFF** | This is where the browser stores `Notification.permission = "granted"`. Clearing it resets the permission to `"default"`. |
| Cached images and files | **OFF** | Clearing this forces a full re-download of the PWA shell on next open. |

> [!CAUTION]
> Some corporate IT policies and "privacy-focused" Edge profiles enable **"Clear cookies on close"** by default. Users on managed devices may not be able to change this setting. There is no code-level workaround — if Edge clears cookies on close, the session and permission grant are gone.

### Browser Comparison: Background Push Behavior on Desktop

| Aspect | Chrome | Edge | Firefox |
|:---|:---|:---|:---|
| Background process setting | `chrome://settings/system` → "Continue running background apps when Google Chrome is closed" | `edge://settings/system` → "Continue running background extensions and apps when Microsoft Edge is closed" | **None** — no equivalent toggle exists |
| Default state | ✅ **ON by default** | ❌ **OFF by default** | N/A |
| Background process on close | ✅ Small `chrome.exe` stays resident | ❌ All `msedge.exe` processes exit (unless setting is enabled) | ❌ All `firefox.exe` processes exit |
| Push when browser is fully closed | ✅ **Yes** — delivered immediately | ❌ **No** (unless background setting is ON) | ❌ **No** — silently queued by Mozilla's push service, delivered in a batch when Firefox is next opened |
| Cookie clearing on close | Off by default | Off by default, but many users / IT policies enable it | Off by default |
| PWA process model | Standalone browser process stays alive | Depends on background apps setting above | PWAs share the main Firefox process |

> [!IMPORTANT]
> **Chrome is the only desktop browser that reliably delivers push notifications with the browser fully closed, out of the box.** Edge can match Chrome's behavior but requires the user to manually enable the background apps setting. Firefox cannot deliver push while fully closed at all — there is no setting to change this, and notifications are silently held until the user reopens Firefox.

#### Chrome Background Apps Setting

```
chrome://settings/system
```

→ **"Continue running background apps when Google Chrome is closed"** — **ON by default**

This keeps a small `chrome.exe` background process resident in memory after all Chrome windows are closed. This process receives push events from FCM and wakes the service worker to call `self.registration.showNotification()`. Because this is on by default, Chrome users rarely encounter the "no notifications when closed" issue.

If a user has manually turned this off, they will experience the same behavior as Edge — no push delivery until Chrome is reopened.

#### Firefox — No Background Process Model

Firefox does **not** keep a persistent background process on Windows or macOS. When Firefox is fully closed (no `firefox.exe` in Task Manager):

- Push messages are **queued by Mozilla's push relay service** (autopush)
- Queued notifications are **delivered in a batch** the next time Firefox launches
- There is **no user-facing setting** to change this behavior
- The `toolkit.backgroundtasks` preference handles Firefox *update checks*, not push notification delivery

This is a fundamental architectural difference — Firefox's push implementation requires the browser process to be running to receive and display notifications.

### Additional Edge / Windows Settings to Verify

1. **Windows Notifications**: Settings → System → Notifications → **Microsoft Edge** → must be **ON**
2. **Focus Assist / Do Not Disturb**: Settings → System → Focus Assist → must be **OFF** (or Edge must be in the priority list)
3. **Edge Efficiency Mode**: `edge://settings/system` → Efficiency Mode → should be **"Never"** or **"Unplugged, low battery"** only. The aggressive **"Always"** mode can suspend background service worker tasks.
4. **Edge Sleeping Tabs**: `edge://settings/system` → Sleeping Tabs → does not directly affect installed PWAs, but if the user opens the app as a tab rather than the installed PWA, it may be put to sleep after inactivity.

### Desktop Edge PWA Checklist

- [ ] `edge://settings/system` → **"Continue running background extensions and apps when Microsoft Edge is closed"** → **ON**
- [ ] `edge://settings/privacy` → **"Choose what to clear every time you close the browser"** → Cookies **OFF**, Site permissions **OFF**
- [ ] Windows Settings → System → Notifications → Microsoft Edge → **ON**
- [ ] Windows Settings → System → Focus Assist / Do Not Disturb → **OFF** or Edge in priority list
- [ ] Edge Efficiency Mode → **not set to "Always"**
- [ ] User has clicked **"Enable Notifications"** button in the app (grants `Notification.permission`)
- [ ] FCM token was successfully registered to the backend (check browser DevTools console)

---

## 5. Critical Payload Parsing (Preventing Blank Notifications)

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

## 6. Mobile Testing Checklist

Before testing on a physical iPhone or Android phone, verify:

- [ ] App is deployed to a public HTTPS domain (e.g. Vercel) or exposed via an HTTPS tunnel (`npx untun@latest tunnel http://localhost:8009`).
- [ ] Environment variables (`NEXT_PUBLIC_FIREBASE_*` and `NEXT_PUBLIC_FIREBASE_VAPID_KEY`) are configured in production.
- [ ] Built with Webpack (`npm run build` using `--webpack`) so `/sw.js` contains the Firebase `importScripts`.
- [ ] **On iOS**: Tapped **Share &rarr; Add to Home Screen** and opened the app from the Home Screen.
- [ ] User tapped the "Enable Notifications" button directly (satisfying the user gesture rule).
- [ ] Copied the generated **FCM Device Token** into Firebase Console.
- [ ] Device is **not** on silent "Do Not Disturb" / iOS Focus mode / Android Bedtime mode blocking banner alerts.
- [ ] Sent a test notification from Firebase Console while the app is in the background or device is locked.
