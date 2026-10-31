import { NextResponse } from "next/server";

// In-memory online user tracking using a simple heartbeat approach.
// Each browser pings this endpoint every 15 seconds with a unique session ID.
// We prune sessions that haven't pinged in 45 seconds (3 missed heartbeats).
//
// This avoids the need for a separate WebSocket server — everything runs inside
// the Next.js dev server (port 3000) which the browser CAN reach.

// Map of sessionId → lastSeenTimestamp (ms).
const sessions = new Map<string, number>();
const HEARTBEAT_TIMEOUT_MS = 45_000; // prune after 3 missed 15s heartbeats
const CLEANUP_INTERVAL_MS = 10_000;

// Periodically prune stale sessions.
let lastCleanup = 0;
function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [id, lastSeen] of sessions) {
    if (now - lastSeen > HEARTBEAT_TIMEOUT_MS) {
      sessions.delete(id);
    }
  }
}

export async function GET(request: Request) {
  cleanup();
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("id");

  if (sessionId) {
    // Heartbeat: update last-seen time.
    sessions.set(sessionId, Date.now());
  }

  return NextResponse.json({
    online: sessions.size,
    timestamp: Date.now(),
  });
}

export async function POST(request: Request) {
  cleanup();
  const body = await request.json().catch(() => ({}));
  const sessionId = body.id;

  if (sessionId) {
    sessions.set(sessionId, Date.now());
  }

  return NextResponse.json({ online: sessions.size });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("id");

  if (sessionId) {
    sessions.delete(sessionId);
  }

  cleanup();
  return NextResponse.json({ online: sessions.size });
}
