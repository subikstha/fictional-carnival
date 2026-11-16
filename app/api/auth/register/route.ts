import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/connection";
import { users, notificationPreferences } from "@/lib/schema";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { username, email, password } = body;

    // 1. Validation
    if (!username || !email || !password) {
      return NextResponse.json(
        { error: "Username, email, and password are required" },
        { status: 400 },
      );
    }

    const trimmedUsername = String(username).trim();
    const trimmedEmail = String(email).trim().toLowerCase();

    if (trimmedUsername.length < 3) {
      return NextResponse.json(
        { error: "Username must be at least 3 characters long" },
        { status: 400 },
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters long" },
        { status: 400 },
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 },
      );
    }

    // 2. Check if user already exists
    const existingUser = await db.query.users.findFirst({
      where: (table, { or, eq }) =>
        or(eq(table.email, trimmedEmail), eq(table.username, trimmedUsername)),
    });

    if (existingUser) {
      const field = existingUser.email === trimmedEmail ? "Email" : "Username";
      return NextResponse.json(
        { error: `${field} is already taken` },
        { status: 409 },
      );
    }

    // 3. Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 4. Create user
    const [newUser] = await db
      .insert(users)
      .values({
        username: trimmedUsername,
        email: trimmedEmail,
        password: hashedPassword,
      })
      .returning({
        id: users.id,
        username: users.username,
        email: users.email,
        createdAt: users.createdAt,
      });

    // 5. Initialize default notification preferences for the user
    await db.insert(notificationPreferences).values({
      userId: newUser.id,
      pushEnabled: true,
      emailEnabled: true,
    });

    return NextResponse.json(
      {
        success: true,
        message: "User registered successfully",
        user: newUser,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating user:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred while creating the user" },
      { status: 500 },
    );
  }
}
