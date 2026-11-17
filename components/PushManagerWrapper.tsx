import { auth } from "@/auth";
import { PushManager } from "./PushManager";
import Link from "next/link";

const PushManagerWrapper = async () => {
  const session = await auth();
  console.log("Session in wrapper", session);
  return session ? (
    <>
      <PushManager />
    </>
  ) : (
    <>
      <h1>Please login first</h1>
      <Link href="/login">Login</Link>
    </>
  );
};

export default PushManagerWrapper;
