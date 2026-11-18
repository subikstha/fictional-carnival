const firebaseConfig = {
  apiKey: "AIzaSyDw6gEB35kN91drrtVXJ8jjytroccAUkyU",
  authDomain: "web-push-f72d9.firebaseapp.com",
  projectId: "web-push-f72d9",
  storageBucket: "web-push-f72d9.firebasestorage.app",
  messagingSenderId: "1060896211183",
  appId: "1:1060896211183:web:aa547b2d2a47b727dddb1a",
  measurementId: "G-W5HXFWJV8R",
};
console.log("config from firebase messaging sw", self.firebaseConfig);

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const messaging = firebase.messaging();

// 1. Custom Push event handler
self.addEventListener("push", (event) => {
  console.log("[SW] Push event received");

  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch (error) {
    console.error("Failed to parse push data", error);
    return;
  }

  // Extract safely from both blocks
  const notification = payload.notification || {};
  const data = payload.data || {};

  const title = notification.title || data.title || "New notification";
  const body = notification.body || data.body || "";
  const icon = notification.icon || data.icon || "/favicon.ico";

  // Merge data so actionUrl is guaranteed to be available on click
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

// 2. Notification click handler
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const payloadData = event.notification.data || {};
  const targetUrl = payloadData.actionUrl || payloadData.url || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientsArr) => {
        // If a window is already open on this origin, focus it and navigate
        for (const client of clientsArr) {
          if (client.url.startsWith(self.location.origin)) {
            client.postMessage({
              type: "FCM_ACTION",
              payload: payloadData,
            });
            if ("navigate" in client) {
              client.navigate(targetUrl);
            }
            return client.focus();
          }
        }
        // Otherwise open a new window to the target URL
        return self.clients.openWindow(targetUrl);
      }),
  );
});
