import { auth } from "@/auth";
import { db } from "@/lib/connection";
import { notifications } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";
import { NextResponse, connection } from "next/server";

export async function GET() {
  await connection();
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userNotifications = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, session.user.id))
      .orderBy(desc(notifications.createdAt));

    console.log("User notifications in route handler", userNotifications);

    return NextResponse.json({ notifications: userNotifications });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
