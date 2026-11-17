"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteToken } from "firebase/messaging";
import { getClientMessaging } from "@/lib/firebase";
import { signOut, useSession } from "next-auth/react";

export function LogoutButton() {
  const currentSession = useSession();
  const { data: sessionData } = currentSession || {};
  console.log("current session in logout button", sessionData);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogout = async () => {
    setLoading(true);
    try {
      // 1. Invalidate with Firebase and retrieve the token to unregister
      const messaging = await getClientMessaging();
      if (messaging) {
        // Attempt to unregister from our database before revoking from Google
        const registration = await navigator.serviceWorker.ready;
        const currentToken = localStorage.getItem(
          `fcmToken_${sessionData?.user?.name}`,
        );

        console.log("Current token when logging out", currentToken);
        // Or pass the known token stored in state/storage
        if (currentToken) {
          await fetch("/api/notifications/unregister-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: currentToken }),
          });
        }

        // Revoke the token on Google FCM servers
        await deleteToken(messaging);
      }
    } catch (err) {
      console.error("Error cleaning up push token on logout:", err);
    } finally {
      // 2. Clear NextAuth session and redirect
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
