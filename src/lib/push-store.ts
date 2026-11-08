import "server-only";
import { promises as fs } from "fs";
import path from "path";
import type { PushSubscriptionLike } from "@/lib/web-push";

/**
 * Persistent push-subscription store.
 *
 * Stores subscriptions in a JSON file under /tmp/vaan-push-subscriptions.json
 * so they survive serverless instance restarts. Each subscription is a
 * unique browser/device that has opted in to push notifications.
 *
 * In a real production setup you'd use Redis, a database, or Vercel KV,
 * but a JSON file is fine for a small user base and avoids needing a DB.
 *
 * NOTE: On Vercel serverless, /tmp is per-instance and gets wiped on cold
 * start. For production with >1 user, swap this out for Vercel KV / Upstash
 * Redis / Firebase. The interface below is intentionally simple so the
 * storage backend can be replaced without touching the API routes.
 */

const STORE_PATH = process.env.PUSH_SUBSCRIPTIONS_PATH || "/tmp/vaan-push-subscriptions.json";

interface StoredSubscription {
  endpoint: string;            // unique URL the push service uses to deliver to this device
  keys: { p256dh: string; auth: string };
  createdAt: number;
  // Optional metadata for debugging / per-user filtering
  userAgent?: string;
}

let cache: StoredSubscription[] | null = null;

async function load(): Promise<StoredSubscription[]> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(STORE_PATH, "utf-8");
    cache = JSON.parse(raw);
  } catch {
    cache = [];
  }
  return cache!;
}

async function save(subs: StoredSubscription[]) {
  cache = subs;
  try {
    await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
    await fs.writeFile(STORE_PATH, JSON.stringify(subs, null, 2), "utf-8");
  } catch (err) {
    console.error("[push-store] Failed to save:", err);
  }
}

export async function addSubscription(
  sub: PushSubscriptionLike,
  userAgent?: string,
): Promise<void> {
  const subs = await load();
  // De-dup by endpoint — same browser re-subscribing shouldn't create duplicates.
  if (!subs.find((s) => s.endpoint === sub.endpoint)) {
    subs.push({
      endpoint: sub.endpoint,
      keys: sub.keys as { p256dh: string; auth: string },
      createdAt: Date.now(),
      userAgent,
    });
    await save(subs);
  }
}

export async function removeSubscription(endpoint: string): Promise<void> {
  const subs = await load();
  const filtered = subs.filter((s) => s.endpoint !== endpoint);
  if (filtered.length !== subs.length) await save(filtered);
}

/**
 * Remove subscriptions whose endpoints no longer accept messages.
 * Called after a batch send returns 404/410.
 */
export async function removeDeadEndpoints(dead: string[]): Promise<void> {
  if (dead.length === 0) return;
  const subs = await load();
  const filtered = subs.filter((s) => !dead.includes(s.endpoint));
  if (filtered.length !== subs.length) await save(filtered);
}

export async function getAllSubscriptions(): Promise<PushSubscriptionLike[]> {
  const subs = await load();
  return subs.map((s) => ({
    endpoint: s.endpoint,
    keys: s.keys,
    expirationTime: null,
  }));
}

export async function getSubscriptionCount(): Promise<number> {
  const subs = await load();
  return subs.length;
}
