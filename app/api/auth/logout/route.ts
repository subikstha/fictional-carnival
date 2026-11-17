import { NextResponse } from "next/server";

// NextAuth client-side signOut() is used directly via app/api/auth/[...nextauth]
export async function POST() {
  return NextResponse.json(
    { message: "Please use NextAuth signOut() directly." },
    { status: 400 },
  );
}
