import { Suspense } from "react";
import Link from "next/link";
import { auth } from "@/auth";
import { LogoutButton } from "./LogoutButton";

async function AuthNav() {
  const session = await auth();
  const user = session?.user;

  if (user) {
    return (
      <div className="flex items-center gap-4 text-sm">
        <span className="text-zinc-600 dark:text-zinc-400">
          Signed in as{" "}
          <strong className="text-zinc-900 dark:text-zinc-100 font-semibold">
            {user.name || user.email}
          </strong>
        </span>
        <LogoutButton />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 text-sm">
      <Link
        href="/login"
        className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 font-medium transition-colors"
      >
        Log in
      </Link>
      <Link
        href="/signup"
        className="px-3 py-1.5 rounded-md bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:hover:bg-zinc-200 dark:text-zinc-900 font-medium transition-colors"
      >
        Sign up
      </Link>
    </div>
  );
}

export function Header() {
  return (
    <header className="w-full border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black px-6 py-3 flex items-center justify-between">
      <Link
        href="/"
        className="font-semibold text-lg text-zinc-900 dark:text-zinc-100 tracking-tight"
      >
        WebPush
      </Link>
      <Suspense fallback={<div className="h-8 w-32" />}>
        <AuthNav />
      </Suspense>
    </header>
  );
}
