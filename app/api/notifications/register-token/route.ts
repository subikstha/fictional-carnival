import { db } from "@/lib/connection";
import { deviceTokens, users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, token, deviceType = "web" } = body;

    if (!email && !token) {
      return NextResponse.json(
        { error: "Email and token are required" },
        { status: 400 },
      );
    }

    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      return NextResponse.json({
        error: "User not found",
      });
    }

    // 2. Upsert the device token:
    // If the token already exists (e.g. account switch), reassign it to this user!
    await db
      .insert(deviceTokens)
      .values({
        userId: user.id,
        token: token,
        deviceType: deviceType,
      })
      .onConflictDoUpdate({
        target: deviceTokens.token,
        set: {
          userId: user.id,
          deviceType: deviceType,
          updatedAt: new Date(),
        },
      });

    return NextResponse.json({
      success: true,
      message: `Token registered successfully for ${email}`,
    });
  } catch (error: any) {
    console.error("Error registering device token:", error);
    return NextResponse.json(
      { error: error.message || "Failed to register token" },
      { status: 500 },
    );
  }
}
