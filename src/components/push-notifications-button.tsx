"use client";

import { Bell, BellRing, BellOff } from "lucide-react";
import { usePushNotifications } from "@/hooks/use-push-notifications";

/**
 * PushNotificationsButton
 *
 * Toggles browser push notifications on/off.
 *
 * - First click: requests permission + registers a push subscription
 *   via the service worker. POSTs the subscription to /api/push/subscribe.
 * - Second click: unregisters the subscription and removes it from
 *   the server.
 *
 * The button reflects three states:
 *   - default (Bell, grey): notifications off
 *   - granted+subscribed (BellRing, green): notifications on
 *   - denied (BellOff, red): user blocked notifications — must enable
 *     in browser settings
 *   - unsupported (BellOff, grey): browser doesn't support push
 */
export function PushNotificationsButton() {
  const { status, subscribed, loading, enable, disable } = usePushNotifications();

  // Unsupported — render nothing instead of a non-functional button.
  if (status === "unsupported") {
    return null;
  }

  // Denied — show a disabled button that hints to the user.
  if (status === "denied") {
    return (
      <button
        disabled
        title="Notifications blocked — enable in browser site settings to receive push alerts."
        className="flex h-7 shrink-0 items-center justify-center rounded-md border border-red-500/30 bg-red-500/5 p-1.5 text-red-400 sm:h-8"
        aria-label="Notifications blocked"
      >
        <BellOff className="h-3.5 w-3.5" />
      </button>
    );
  }

  // Active / enabled — show bell with notification ring.
  if (subscribed) {
    return (
      <button
        onClick={disable}
        disabled={loading}
        title="Push notifications ON — click to disable"
        className="relative flex h-7 shrink-0 items-center justify-center rounded-md border border-[#75D380]/40 bg-[#75D380]/10 p-1.5 text-[#75D380] transition-colors hover:bg-[#75D380]/20 sm:h-8"
        aria-label="Disable push notifications"
      >
        <BellRing className="h-3.5 w-3.5" />
        {/* Pulse dot */}
        <span className="absolute -right-0.5 -top-0.5 flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#75D380] opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[#75D380]" />
        </span>
      </button>
    );
  }

  // Default — bell without ring (notifications off).
  return (
    <button
      onClick={enable}
      disabled={loading}
      title="Enable push notifications on this device"
      className="flex h-7 shrink-0 items-center justify-center rounded-md border border-white/15 bg-white/5 p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50 sm:h-8"
      aria-label="Enable push notifications"
    >
      <Bell className="h-3.5 w-3.5" />
    </button>
  );
}
