"use client";

import { useState } from "react";

interface SendNotificationFormProps {
  defaultTargetEmail?: string;
}

export function SendNotificationForm({
  defaultTargetEmail = "",
}: SendNotificationFormProps) {
  const [targetEmail, setTargetEmail] = useState(defaultTargetEmail);
  const [title, setTitle] = useState("Hello from Next.js! 🚀");
  const [body, setBody] = useState(
    "This is a targeted push notification sent by email."
  );
  const [actionUrl, setActionUrl] = useState("/");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    success?: boolean;
    deliveredToDevices?: number;
    failedDevices?: number;
    error?: string;
  } | null>(null);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/notifications/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetEmail: targetEmail.trim().toLowerCase(),
          title,
          body,
          actionUrl,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setResult({ error: data.error || "Failed to send notification." });
      } else {
        setResult({
          success: true,
          deliveredToDevices: data.deliveredToDevices,
          failedDevices: data.failedDevices,
        });
      }
    } catch (err: any) {
      setResult({ error: err.message || "Network error occurred." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 border rounded-lg bg-zinc-50 dark:bg-zinc-900 max-w-md w-full">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold">Send Push Notification</h2>
        {defaultTargetEmail && targetEmail !== defaultTargetEmail && (
          <button
            type="button"
            onClick={() => setTargetEmail(defaultTargetEmail)}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            Use my email
          </button>
        )}
      </div>

      <p className="text-xs text-zinc-500 mb-4">
        Dispatch a push notification to all active devices registered under a
        specific user email.
      </p>

      <form onSubmit={handleSend} className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            Recipient User Email
          </label>
          <input
            type="email"
            required
            placeholder="user@example.com"
            value={targetEmail}
            onChange={(e) => setTargetEmail(e.target.value)}
            className="w-full text-sm p-2 border rounded bg-white dark:bg-black border-zinc-300 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            Notification Title
          </label>
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full text-sm p-2 border rounded bg-white dark:bg-black border-zinc-300 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            Notification Body
          </label>
          <textarea
            required
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="w-full text-sm p-2 border rounded bg-white dark:bg-black border-zinc-300 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            Action URL (on click)
          </label>
          <input
            type="text"
            value={actionUrl}
            onChange={(e) => setActionUrl(e.target.value)}
            className="w-full text-sm p-2 border rounded bg-white dark:bg-black border-zinc-300 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded transition-colors"
        >
          {loading ? "Dispatching..." : "Send Notification"}
        </button>
      </form>

      {result?.success && (
        <div className="mt-4 p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 rounded text-xs text-emerald-800 dark:text-emerald-200">
          <p className="font-semibold">✓ Notification dispatched!</p>
          <p>Delivered to {result.deliveredToDevices} device(s).</p>
          {result.failedDevices !== undefined && result.failedDevices > 0 && (
            <p className="text-amber-600 dark:text-amber-400 mt-1">
              Cleaned up {result.failedDevices} expired/invalid device token(s).
            </p>
          )}
        </div>
      )}

      {result?.error && (
        <div className="mt-4 p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 rounded text-xs text-rose-800 dark:text-rose-200">
          <p className="font-semibold">✕ Send failed:</p>
          <p>{result.error}</p>
        </div>
      )}
    </div>
  );
}
