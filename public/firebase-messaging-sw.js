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

// Custom Push event handler
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

  const data = payload.data || payload.notification || {};
  const title = data.title || "New notification";

  const options = {
    body: data.body || "",
    icon: data.icon || "/favicon.ico",
    data: data,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});
// 3. Notification click handler
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const payloadData = event.notification.data;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientsArr) => {
        // If a window is already open, focus it and notify client
        for (const client of clientsArr) {
          if (client.url.includes("/")) {
            client.postMessage({
              type: "FCM_ACTION",
              payload: payloadData,
            });
            return client.focus();
          }
        }
        // Otherwise open a new window
        const targetUrl = payloadData?.url || "/";
        return self.clients.openWindow(targetUrl);
      }),
  );
});
