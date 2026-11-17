import admin from "firebase-admin";
import { cert, getApps } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

if (!getApps().length) {
  try {
    admin.initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // Replace escaped newlines with actual newline characters
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    });
    console.log("✅ Firebase Admin initialized successfully");
  } catch (error) {
    console.error("❌ Firebase Admin initialization error:", error);
  }
}

export const adminMessaging = getMessaging();
export default admin;
