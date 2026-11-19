import { db } from "@/lib/connection";
import { adminMessaging } from "@/lib/firebase-admin";
import { deviceTokens, users, notifications } from "@/lib/schema";
import { inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      targetEmail,
      targetEmails,
      title,
      body: messageBody,
      actionUrl = "/user/notifications",
    } = body;

    // Normalize target emails to an array of lowercase strings
    const rawEmails: string[] = Array.isArray(targetEmails)
      ? targetEmails
      : targetEmail
        ? [targetEmail]
        : [];

    const emails = rawEmails
      .map((e) => (typeof e === "string" ? e.trim().toLowerCase() : ""))
      .filter(Boolean);

    // 1. Validate the inputs
    if (emails.length === 0 || !title || !messageBody) {
      return NextResponse.json(
        { error: "At least one target email, title, and body are required." },
        { status: 400 },
      );
    }

    // 2. Find users by the provided emails
    const matchedUsers = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(inArray(users.email, emails));

    if (!matchedUsers.length) {
      return NextResponse.json(
        { error: "No matching user(s) found for the selected email(s)." },
        { status: 404 },
      );
    }

    const userIds = matchedUsers.map((u) => u.id);

    // 3. Save in the in-app notification inbox for all targeted users
    const inboxInserts = userIds.map((uid) => ({
      userId: uid,
      title: title,
      body: messageBody,
      actionUrl: actionUrl,
    }));
    await db.insert(notifications).values(inboxInserts);

    // 4. Retrieve all device tokens that are registered for these users
    const tokenRecords = await db
      .select({ token: deviceTokens.token })
      .from(deviceTokens)
      .where(inArray(deviceTokens.userId, userIds));

    if (!tokenRecords.length) {
      return NextResponse.json({
        success: true,
        deliveredToDevices: 0,
        failedDevices: 0,
        recipientsCount: matchedUsers.length,
        message:
          "Notification saved in-app, but the selected user(s) have no registered push devices.",
      });
    }

    const tokens = tokenRecords.map((r) => r.token);

    // 5. Dispatch the push notifications to all their devices
    const response = await adminMessaging.sendEachForMulticast({
      tokens: tokens,
      // The notification block causes two notifications to arrive
      notification: {
        title: title,
        body: messageBody,
      },
      data: {
        title: title,
        body: messageBody,
        actionUrl: actionUrl,

        sentAt: new Date().toISOString(),
      },
      // webpush: {
      //   headers: {
      //     Urgency: "high",
      //   },
      //   notification: {
      //     icon: "/favicon.ico",
      //     badge: "/favicon.ico",
      //     requireInteraction: true,
      //   },
      // },
    });

    console.log("Response back from the firebase", response);

    // 6. Clean up stale/invalid tokens reported by Firebase
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

    return NextResponse.json({
      success: true,
      deliveredToDevices: response.successCount,
      failedDevices: response.failureCount,
      recipientsCount: matchedUsers.length,
    });
  } catch (error: any) {
    console.error("Error dispatching notifications", error);
    return NextResponse.json(
      { error: error.message || "Failed to send notification" },
      { status: 500 },
    );
  }
}
