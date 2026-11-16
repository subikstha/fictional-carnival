"use client";

import { useEffect, useState, useCallback } from "react";
import { getToken, onMessage } from "firebase/messaging";
import { getClientMessaging } from "@/lib/firebase";

export function PushManager() {
  const [token, setToken] = useState<string | null>(null);
  const [notification, setNotification] = useState<{
    title?: string;
    body?: string;
  } | null>(null);
  const [permission, setPermission] =
    useState<NotificationPermission>("default");
  const [loading, setLoading] = useState(false);

  // Helper function to get fcm token
  const retrieveToken = useCallback(async () => {
    try {
      setLoading(true);
      const registration = await navigator.serviceWorker.ready;
      const messaging = await getClientMessaging();

      if (!messaging) return;

      const currentToken = await getToken(messaging, {
        vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
        serviceWorkerRegistration: registration,
      });

      if (currentToken) {
        console.log("FCM token got from retrive Token", currentToken);
        setToken(currentToken);
      }
    } catch (error) {
      console.error("Error retrieving token", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if ("Notification" in window) {
      const currentPerm = Notification.permission;
      setPermission(Notification.permission);

      // Auto fetch the token on refresh if already granted
      if (currentPerm === "granted") {
        retrieveToken();
      }
    }

    // Listen to foreground notifications when tab is open
    getClientMessaging().then((messaging) => {
      if (!messaging) return;
      onMessage(messaging, (payload) => {
        console.log("Foreground message received:", payload);
        setNotification({
          title: payload.notification?.title || payload.data?.title,
          body: payload.notification?.body || payload.data?.body,
        });
      });
    });
  }, [retrieveToken]);

  const handleSubscribe = async () => {
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);

      if (perm !== "granted") {
        alert("Notification permission denied");
        return;
      }

      //   1. Register sw.js manually
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      //   2. Get FCM token passing service worker registration
      const messaging = await getClientMessaging();
      if (!messaging) return;

      const currentToken = await getToken(messaging, {
        vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
        serviceWorkerRegistration: registration,
      });

      if (currentToken) {
        console.log("FCM token", currentToken);
        setToken(currentToken);
      }
    } catch (error) {
      console.error("Error retrieving token:", error);
    }
  };

  return (
    <div className="p-4 border rounded-lg bg-zinc-50 dark:bg-zinc-900 max-w-md my-4">
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

      {notification && (
        <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 rounded">
          <p className="font-semibold text-sm">{notification.title}</p>
          <p className="text-xs text-zinc-600 dark:text-zinc-300">
            {notification.body}
          </p>
        </div>
      )}
    </div>
  );
}

PushManager.displayName = "PushManager";
