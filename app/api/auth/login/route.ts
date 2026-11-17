import { NextResponse } from "next/server";

// NextAuth client-side signIn("credentials") is used directly via app/api/auth/[...nextauth]
export async function POST() {
  return NextResponse.json(
    { message: "Please use NextAuth signIn('credentials') directly." },
    { status: 400 },
  );
}
