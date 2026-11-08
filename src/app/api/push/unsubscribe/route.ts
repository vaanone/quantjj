import { NextResponse } from "next/server";
import { removeSubscription } from "@/lib/push-store";

/**
 * POST /api/push/unsubscribe
 *
 * Removes a push subscription (when user disables notifications or the
 * subscription has expired). Body: { endpoint: string }
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body?.endpoint) {
      return NextResponse.json(
        { error: "Missing endpoint" },
        { status: 400 },
      );
    }
    await removeSubscription(body.endpoint);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Failed to remove subscription: " + String(err?.message || err) },
      { status: 500 },
    );
  }
}
