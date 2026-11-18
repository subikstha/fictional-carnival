"use client";

import { useEffect, useState } from "react";

interface UserItem {
  id: string;
  username: string;
  email: string;
  deviceCount?: number;
}

interface SendNotificationFormProps {
  defaultTargetEmail?: string;
}

export function SendNotificationForm({
  defaultTargetEmail = "",
}: SendNotificationFormProps) {
  const [usersList, setUsersList] = useState<UserItem[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [selectedEmails, setSelectedEmails] = useState<string[]>([]);

  const [title, setTitle] = useState("Hello from Next.js! 🚀");
  const [body, setBody] = useState(
    "This is a targeted push notification sent by email.",
  );
  const [actionUrl, _] = useState("/user/notifications");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    success?: boolean;
    deliveredToDevices?: number;
    failedDevices?: number;
    recipientsCount?: number;
    message?: string;
    error?: string;
  } | null>(null);

  // Fetch users from the database
  useEffect(() => {
    async function fetchUsers() {
      try {
        setLoadingUsers(true);
        const res = await fetch("/api/users");
        if (!res.ok) throw new Error("Failed to fetch users");
        const data = await res.json();
        const users: UserItem[] = data.users || [];
        setUsersList(users);

        // Pre-select default user if specified
        if (
          defaultTargetEmail &&
          users.some((u) => u.email === defaultTargetEmail)
        ) {
          setSelectedEmails([defaultTargetEmail]);
        }
      } catch (err) {
        console.error("Error loading users:", err);
      } finally {
        setLoadingUsers(false);
      }
    }

    fetchUsers();
  }, [defaultTargetEmail]);

  // Toggle user selection
  const toggleUser = (email: string) => {
    setSelectedEmails((prev) =>
      prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email],
    );
  };

  const selectAll = () => {
    setSelectedEmails(usersList.map((u) => u.email));
  };

  const deselectAll = () => {
    setSelectedEmails([]);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedEmails.length === 0) {
      setResult({ error: "Please select at least one recipient user." });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/notifications/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetEmails: selectedEmails,
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
          recipientsCount: data.recipientsCount,
          message: data.message,
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
        {usersList.length > 0 && (
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              onClick={selectAll}
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              Select All
            </button>
            <span className="text-zinc-400">|</span>
            <button
              type="button"
              onClick={deselectAll}
              className="text-zinc-500 hover:underline"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      <p className="text-xs text-zinc-500 mb-3">
        Select one or more recipient users to send push and in-app
        notifications.
      </p>

      <form onSubmit={handleSend} className="space-y-4">
        {/* Recipient User Selection Cards */}
        <div>
          <div className="flex justify-between items-center mb-1.5">
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Select Recipients ({selectedEmails.length} selected)
            </label>
          </div>

          {loadingUsers ? (
            <div className="p-4 text-center text-xs text-zinc-400 animate-pulse border rounded bg-white dark:bg-black">
              Loading users from database...
            </div>
          ) : usersList.length === 0 ? (
            <div className="p-4 text-center text-xs text-zinc-500 border rounded bg-white dark:bg-black">
              No registered users found in the database.
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
              {usersList.map((user) => {
                const isSelected = selectedEmails.includes(user.email);
                const hasDevices = (user.deviceCount || 0) > 0;

                return (
                  <div
                    key={user.id}
                    onClick={() => toggleUser(user.email)}
                    className={`p-2.5 rounded-md border text-left cursor-pointer transition-all flex items-center justify-between ${
                      isSelected
                        ? "border-blue-500 bg-blue-50/70 dark:bg-blue-950/40 ring-1 ring-blue-500"
                        : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black hover:border-zinc-300 dark:hover:border-zinc-700"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {/* Checkbox circle */}
                      <div
                        className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] text-white transition-colors flex-shrink-0 ${
                          isSelected ? "bg-blue-600" : "border border-zinc-400"
                        }`}
                      >
                        {isSelected && "✓"}
                      </div>

                      <div className="truncate">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                            {user.username}
                          </span>
                          {user.email === defaultTargetEmail && (
                            <span className="text-[10px] bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 px-1 py-0.2 rounded">
                              You
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-zinc-500 truncate">
                          {user.email}
                        </p>
                      </div>
                    </div>

                    {/* Device Status Badge */}
                    <div className="flex-shrink-0 text-right ml-2">
                      <span
                        className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                          hasDevices
                            ? "bg-green-100 dark:bg-green-950/60 text-green-700 dark:text-green-300"
                            : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500"
                        }`}
                      >
                        {hasDevices
                          ? `${user.deviceCount} device${user.deviceCount! > 1 ? "s" : ""}`
                          : "No devices"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Notification Title */}
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

        {/* Notification Body */}
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

        {/* Action URL */}
        {/* <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            Action URL (destination on click)
          </label>
          <input
            type="text"
            value={actionUrl}
            onChange={(e) => setActionUrl(e.target.value)}
            className="w-full text-sm p-2 border rounded bg-white dark:bg-black border-zinc-300 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div> */}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={loading || selectedEmails.length === 0}
          className="w-full py-2 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded transition-colors cursor-pointer"
        >
          {loading
            ? "Dispatching..."
            : `Send to ${selectedEmails.length} User${selectedEmails.length === 1 ? "" : "s"}`}
        </button>
      </form>

      {/* Result Status Cards */}
      {result?.success && (
        <div className="mt-4 p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 rounded text-xs text-emerald-800 dark:text-emerald-200">
          <p className="font-semibold">✓ Notification dispatched!</p>
          <p>
            Targeted {result.recipientsCount} user(s) &bull; Delivered to{" "}
            {result.deliveredToDevices} active device(s).
          </p>
          {result.message && (
            <p className="mt-1 text-zinc-600 dark:text-zinc-400">
              {result.message}
            </p>
          )}
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
