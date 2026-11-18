import { auth } from "@/auth";
import { PushManager } from "./PushManager";
import { redirect } from "next/navigation";

const PushManagerWrapper = async () => {
  const session = await auth();
  if (!session) {
    redirect("/login");
  }

  return (
    <PushManager
      email={session.user?.email as string}
      username={session?.user?.name as string}
    />
  );
};

export default PushManagerWrapper;
