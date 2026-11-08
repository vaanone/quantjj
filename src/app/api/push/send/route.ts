import { NextResponse } from "next/server";
import {
  getAllSubscriptions,
  removeDeadEndpoints,
} from "@/lib/push-store";
import { sendPushNotification } from "@/lib/web-push";

/**
 * POST /api/push/send
 *
 * Sends a push notification to ALL subscribed devices. Used by the
 * chart's price-alert and S/R-level-alert hooks so alerts fire even
 * when the browser tab is closed or the device is in standby.
 *
 * Body:
 *   { title: string, body: string, tag?: string, url?: string }
 *
 * Auth: this endpoint is unauthenticated for now. If abuse becomes a
 * problem, add a simple shared-secret header check.
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body?.title || !body?.body) {
      return NextResponse.json(
        { error: "Missing title or body" },
        { status: 400 },
      );
    }

    const subs = await getAllSubscriptions();
    if (subs.length === 0) {
      return NextResponse.json({
        success: true,
        sent: 0,
        message: "No subscribers yet",
      });
    }

    const dead: string[] = [];
    let sent = 0;
    let failed = 0;

    // Send to all subscriptions in parallel.
    await Promise.all(
      subs.map(async (sub) => {
        const ok = await sendPushNotification(sub, {
          title: body.title,
          body: body.body,
          tag: body.tag || "vaan-alert",
          url: body.url || "/",
        });
        if (ok) sent++;
        else {
          failed++;
          dead.push(sub.endpoint);
        }
      }),
    );

    // Clean up expired subscriptions.
    if (dead.length > 0) await removeDeadEndpoints(dead);

    return NextResponse.json({
      success: true,
      sent,
      failed,
      total: subs.length,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Failed to send push: " + String(err?.message || err) },
      { status: 500 },
    );
  }
}
