import { auth } from "@/auth";
import { db } from "@/lib/connection";
import { users, deviceTokens } from "@/lib/schema";
import { count, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const allUsers = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        deviceCount: count(deviceTokens.id),
      })
      .from(users)
      .leftJoin(deviceTokens, eq(users.id, deviceTokens.userId))
      .groupBy(users.id, users.username, users.email);

    return NextResponse.json({ users: allUsers });
  } catch (error: any) {
    console.error("Error fetching users:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to fetch users" },
      { status: 500 },
    );
  }
}
