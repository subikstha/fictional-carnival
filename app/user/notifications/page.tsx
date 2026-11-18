import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import NotificationsClient from "@/components/NotificationsClient";

async function NotificationsContent() {
  const session = await auth();
  if (!session) {
    redirect("/login");
  }

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Your Notifications</h1>
      <NotificationsClient />
    </main>
  );
}

export default function UsersNotifications() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading notifications...</p>}>
      <NotificationsContent />
    </Suspense>
  );
}
