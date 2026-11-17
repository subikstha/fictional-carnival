import { db } from "@/lib/connection";
import { deviceTokens } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { token } = body;

    if (!token) {
      return NextResponse.json(
        { error: "Token is required to unregister" },
        { status: 500 },
      );
    }

    await db.delete(deviceTokens).where(eq(deviceTokens.token, token));
  } catch (error: any) {
    console.error("Error deleting token");
    return NextResponse.json(
      { error: "Unable to unregister token" },
      { status: 500 },
    );
  }
}
