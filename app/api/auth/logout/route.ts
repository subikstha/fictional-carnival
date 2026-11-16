import { NextResponse } from "next/server";
import { signOut } from "@/auth";

export async function POST() {
  try {
    await signOut({ redirect: false });
    return NextResponse.json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "";
    if (errorMsg.includes("NEXT_REDIRECT")) {
      return NextResponse.json({
        success: true,
        message: "Logged out successfully",
      });
    }

    console.error("Logout error:", error);
    return NextResponse.json(
      { error: "Failed to log out" },
      { status: 500 },
    );
  }
}
