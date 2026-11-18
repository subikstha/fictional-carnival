"use client";

import { useEffect, useState } from "react";
import type { Notification } from "@/lib/schema";

export default function NotificationsClient() {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadNotifications() {
      try {
        const res = await fetch("/api/notifications/get");
        if (!res.ok) throw new Error("Failed to load notifications");
        const data = await res.json();
        console.log("Data", data);
        setItems(data.notifications);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    loadNotifications();
  }, []);

  if (loading) return <p className="animate-pulse">Loading notifications...</p>;
  if (error) return <p className="text-red-500">{error}</p>;
  if (items.length === 0) return <p>No notifications to display.</p>;

  return (
    <ul className="space-y-3">
      {items.map((n) => (
        <li key={n.id} className="p-4 border rounded-lg">
          <h2 className="font-semibold text-lg">{n.title}</h2>
          <p className="text-gray-600">{n.body}</p>
          {n.actionUrl && (
            <a
              href={n.actionUrl}
              className="text-blue-500 hover:underline text-sm mt-2 inline-block"
            >
              View &rarr;
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
