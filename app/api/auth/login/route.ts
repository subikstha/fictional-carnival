import { NextResponse } from "next/server";
import { signIn } from "@/auth";
import { AuthError } from "next-auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { identifier, password } = body;

    if (!identifier || !password) {
      return NextResponse.json(
        { error: "Identifier (username/email) and password are required" },
        { status: 400 },
      );
    }

    await signIn("credentials", {
      identifier,
      password,
      redirect: false,
    });

    return NextResponse.json({
      success: true,
      message: "Logged in successfully",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      switch (error.type) {
        case "CredentialsSignin":
          return NextResponse.json(
            { error: "Invalid username/email or password" },
            { status: 401 },
          );
        default:
          return NextResponse.json(
            { error: "Authentication failed" },
            { status: 500 },
          );
      }
    }

    // Rethrow redirect error if Auth.js initiates navigation
    const errorMsg = error instanceof Error ? error.message : "";
    if (errorMsg.includes("NEXT_REDIRECT")) {
      return NextResponse.json({
        success: true,
        message: "Logged in successfully",
      });
    }

    console.error("Login route error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
