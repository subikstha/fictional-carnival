import { db } from "@/lib/connection";
import { adminMessaging } from "@/lib/firebase-admin";
import { deviceTokens, users, notifications } from "@/lib/schema";
import { eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { targetEmail, title, body: messageBody, actionUrl = "/" } = body;

    // 1. Validate the inputs
    if (!targetEmail || !title || !messageBody) {
      return NextResponse.json(
        { error: "targetEmail, title, and body are required." },
        { status: 400 },
      );
    }

    // 2. Find user by the provided email
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, targetEmail))
      .limit(1);

    if (!user) {
      return NextResponse.json(
        { error: `User with the email ${targetEmail} was not found` },
        { status: 404 },
      );
    }

    // 3. Retrieve all device tokens that are registered for this particular user
    const tokenRecords = await db
      .select({ token: deviceTokens.token })
      .from(deviceTokens)
      .where(eq(deviceTokens.userId, user.id));

    if (!tokenRecords.length) {
      return NextResponse.json(
        {
          error:
            "User has no registered devices. They must log in and enable notifications first",
        },
        { status: 404 },
      );
    }

    const tokens = tokenRecords.map((r) => r.token);
    console.log("Tokens in the backend", tokens);

    // 4. Dispatch the push notifications to all their devices
    const response = await adminMessaging.sendEachForMulticast({
      tokens: tokens,
      notification: {
        title: title,
        body: messageBody,
      },
      data: {
        actionUrl: actionUrl,
        sendAt: new Date().toISOString(),
      },
    });

    // 5. Clean up stale/invalid tokens reported by Firebase
    const deadTokens: string[] = [];
    response.responses.forEach((res, idx) => {
      if (!res.success) {
        const errCode = res.error?.code;
        if (
          errCode === "messaging/registration-token-not-registered" ||
          errCode === "messaging/invalid-registration-token"
        ) {
          deadTokens.push(tokens[idx]);
        }
      }
    });

    if (deadTokens.length > 0) {
      await db
        .delete(deviceTokens)
        .where(inArray(deviceTokens.token, deadTokens));
      console.log(`Cleaned up ${deadTokens.length} expired token(s)`);
    }

    // 6. Save in the in-app notification inbox
    await db.insert(notifications).values({
      userId: user.id,
      title: title,
      body: messageBody,
      actionUrl: actionUrl,
    });

    return NextResponse.json({
      success: true,
      deliveredToDevices: response.successCount,
      failedDevices: response.failureCount,
    });
  } catch (error: any) {
    console.error("Error dispatching notifications", error);
    return NextResponse.json(
      { error: error.message || "Failed to send notification" },
      { status: 500 },
    );
  }
}
