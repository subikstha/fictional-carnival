import NotificationsClient from "@/components/NotificationsClient";

export default function UsersNotifications() {
  return (
    <main className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Your Notifications</h1>
      <NotificationsClient />
    </main>
  );
}
