import { initializeApp, getApps, getApp, cert, App } from "firebase-admin/app";
import { getMessaging, Messaging } from "firebase-admin/messaging";

function getAdminApp(): App {
  if (getApps().length > 0) {
    return getApp();
  }

  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Firebase Admin credentials missing: ensure FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY are set in .env.local"
    );
  }

  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
}

/**
 * Lazy proxy for Firebase Admin Messaging.
 * Prevents eager initialization crashes during Next.js build-time page data collection.
 */
export const adminMessaging: Messaging = new Proxy({} as Messaging, {
  get(_target, prop) {
    const messaging = getMessaging(getAdminApp());
    const value = (messaging as any)[prop];
    return typeof value === "function" ? value.bind(messaging) : value;
  },
});
