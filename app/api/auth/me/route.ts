import { NextResponse, connection } from "next/server";
import { auth } from "@/auth";

export async function GET() {
  await connection();
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    user: session.user,
  });
}
