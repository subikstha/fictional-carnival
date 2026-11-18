"use client";

import { useEffect, useState, useRef } from "react";

export function ServiceWorkerRegister() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") {
      return;
    }

    let refreshing = false;

    // 1. Reload the page when a new service worker takes control
    const handleControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      // Show update toast or reload
      setUpdateAvailable(true);
    };

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

    // 2. Register the Service Worker
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        registrationRef.current = registration;
        console.log("Service Worker registered with scope:", registration.scope);

        // Check if an updated worker is already waiting
        if (registration.waiting) {
          setUpdateAvailable(true);
        }

        // 3. Listen for new service worker installation
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            // If a new worker installed and there's an existing controller, an update is ready
            if (
              newWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              console.log("[PWA] New service worker version installed!");
              setUpdateAvailable(true);
            }
          });
        });
      })
      .catch((error) => {
        console.error("Service worker registration failed:", error);
      });

    // 4. Actively check for updates whenever the user returns to the tab
    const checkForUpdates = () => {
      if (registrationRef.current) {
        registrationRef.current
          .update()
          .then((reg) => {
            if (reg.waiting) {
              setUpdateAvailable(true);
            }
          })
          .catch((err) => console.log("[PWA] Update check error:", err));
      }
    };

    // Trigger update check on tab focus & visibility change
    window.addEventListener("focus", checkForUpdates);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        checkForUpdates();
      }
    });

    // Also check periodically every 30 minutes
    const interval = setInterval(checkForUpdates, 30 * 60 * 1000);

    return () => {
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        handleControllerChange
      );
      window.removeEventListener("focus", checkForUpdates);
      clearInterval(interval);
    };
  }, []);

  const handleUpdate = () => {
    const reg = registrationRef.current;
    if (reg?.waiting) {
      // Tell waiting worker to skip waiting and activate immediately
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
    }
    window.location.reload();
  };

  if (!updateAvailable) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex items-center gap-3 p-3.5 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 rounded-xl shadow-2xl border border-zinc-700 dark:border-zinc-300 text-xs animate-in slide-in-from-bottom duration-300">
      <span className="relative flex h-2.5 w-2.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
      </span>
      <span className="font-medium">New version available!</span>
      <button
        onClick={handleUpdate}
        className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-semibold transition-colors cursor-pointer"
      >
        Update Now
      </button>
      <button
        onClick={() => setUpdateAvailable(false)}
        className="text-zinc-400 hover:text-zinc-200 dark:hover:text-zinc-700 text-sm ml-1 cursor-pointer"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
