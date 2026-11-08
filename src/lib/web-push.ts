import "server-only";
import {
  setVapidDetails,
  sendNotification as webpushSendNotification,
  generateVAPIDKeys,
} from "web-push";

/**
 * Web Push configuration.
 *
 * VAPID (Voluntary Application Server Identification) keys are an
 * asymmetric key pair used to authenticate our server with the browser
 * push service (FCM for Chrome/Android, APNs for Safari/iOS, Mozilla
 * for Firefox). The PUBLIC key is sent to the browser, which includes
 * it in the push subscription it gives us. The PRIVATE key is used to
 * sign the push messages we send.
 *
 * Keys are generated once and stored in environment variables:
 *   VAPID_PUBLIC_KEY  — safe to expose to the browser
 *   VAPID_PRIVATE_KEY — server-only, never expose
 *   VAPID_SUBJECT     — mailto: or https: URL identifying the sender
 *
 * Generated with: generateVAPIDKeys()
 */

if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
  // Don't crash — just log. Push notifications are a progressive
  // enhancement; the chart still works without them.
  console.warn(
    "[web-push] VAPID keys not set. Push notifications disabled. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in .env",
  );
} else {
  setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:hello@vaan.one",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
}

export const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";

// Re-export for any callers that need the raw functions (e.g. key gen).
export { generateVAPIDKeys };

/**
 * PushSubscription shape (what the browser gives us).
 * We define a minimal type here so we don't have to import the entire
 * web-push module's types everywhere.
 */
export interface PushSubscriptionLike {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime?: number | null;
}

/**
 * Send a push notification to a single subscription.
 *
 * Returns true on success, false on failure (e.g. subscription expired,
 * user revoked permission). The caller should remove failed subscriptions.
 */
export async function sendPushNotification(
  subscription: PushSubscriptionLike,
  payload: {
    title: string;
    body: string;
    tag?: string;
    url?: string;
  },
): Promise<boolean> {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return false;
  }
  try {
    await webpushSendNotification(
      subscription as any,
      JSON.stringify(payload),
      {
        TTL: 60 * 60 * 24, // 24 hours — if device is offline, queue for up to 24h
        urgency: "high",
        topic: payload.tag, // collapse duplicate notifications with the same tag
      },
    );
    return true;
  } catch (err: any) {
    // 404 = subscription expired, 410 = subscription gone → caller should delete
    if (err?.statusCode === 404 || err?.statusCode === 410) {
      return false;
    }
    // Other errors (network, etc.) — don't delete the subscription
    console.error("[web-push] sendNotification error:", err?.statusCode, err?.message);
    return false;
  }
}

