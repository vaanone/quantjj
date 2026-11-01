import { NextResponse } from "next/server";

// In-memory tracking of online users + total visits.
//
// Online: each browser pings every 15s with a unique session ID. Sessions
// that haven't pinged in 45s are pruned.
//
// Visits: a running counter of unique session IDs we've ever seen. It only
// ever increases (new visitors add to it). This is in-memory, so it resets
// when the server restarts — sufficient for a simple "Visited" indicator.

const sessions = new Map<string, number>();
const visitedSet = new Set<string>(); // all session IDs ever seen
const HEARTBEAT_TIMEOUT_MS = 45_000;
const CLEANUP_INTERVAL_MS = 10_000;

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
    sessions.set(sessionId, Date.now());
    visitedSet.add(sessionId);
  }

  return NextResponse.json({
    online: sessions.size,
    visited: visitedSet.size,
    timestamp: Date.now(),
  });
}

export async function POST(request: Request) {
  cleanup();
  const body = await request.json().catch(() => ({}));
  const sessionId = body.id;

  if (sessionId) {
    sessions.set(sessionId, Date.now());
    visitedSet.add(sessionId);
  }

  return NextResponse.json({ online: sessions.size, visited: visitedSet.size });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("id");

  if (sessionId) {
    sessions.delete(sessionId);
    // Note: we DON'T remove from visitedSet — visits are cumulative.
  }

  cleanup();
  return NextResponse.json({ online: sessions.size, visited: visitedSet.size });
}
