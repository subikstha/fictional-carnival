import { auth } from "@/auth";
import { redirect } from "next/navigation";
import NotificationsClient from "@/components/NotificationsClient";

export default async function UsersNotifications() {
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
