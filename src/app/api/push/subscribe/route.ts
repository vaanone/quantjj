import { NextResponse } from "next/server";
import { addSubscription, getSubscriptionCount } from "@/lib/push-store";
import { VAPID_PUBLIC_KEY } from "@/lib/web-push";

/**
 * POST /api/push/subscribe
 *
 * Stores a new push subscription. The body should be the PushSubscription
 * JSON the browser gives us via serviceWorker.pushManager.subscribe().
 *
 * GET /api/push/subscribe
 *
 * Returns the VAPID public key + current subscriber count (for the
 * "Enable Notifications" button to use).
 */

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    publicKey: VAPID_PUBLIC_KEY,
    enabled: Boolean(VAPID_PUBLIC_KEY),
    subscribers: await getSubscriptionCount(),
  });
}

export async function POST(req: Request) {
  if (!VAPID_PUBLIC_KEY) {
    return NextResponse.json(
      { error: "Push notifications not configured. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in .env" },
      { status: 503 },
    );
  }

  try {
    const body = await req.json();
    // PushSubscription shape: { endpoint, keys: { p256dh, auth }, expirationTime }
    if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) {
      return NextResponse.json(
        { error: "Invalid subscription payload" },
        { status: 400 },
      );
    }
    const userAgent = req.headers.get("user-agent") || undefined;
    await addSubscription(body, userAgent);
    return NextResponse.json({
      success: true,
      message: "Push subscription stored",
      subscribers: await getSubscriptionCount(),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Failed to store subscription: " + String(err?.message || err) },
      { status: 500 },
    );
  }
}
