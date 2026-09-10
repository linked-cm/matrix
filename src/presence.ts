/**
 * Typing + read-receipt decision helpers (plan 036 P4) — PURE, clock-injected.
 * The Matrix transport consults these before touching the network so the UI may
 * signal freely (every keystroke, every render effect) without request spam;
 * tests drive them with a fake clock, no sdk and no timers.
 */

/** How long the homeserver keeps a typing notice alive without a refresh (m.typing timeout). */
export const TYPING_SERVER_TIMEOUT_MS = 6000;
/**
 * How often a still-composing viewer re-sends `typing: true`. Below the 6s server
 * timeout so the indicator never flickers off between refreshes, yet at most one
 * request per 4s regardless of keystroke rate.
 */
export const TYPING_REFRESH_MS = 4000;

export interface TypingThrottle {
  /** true = the caller should actually send this typing state to the server NOW. */
  shouldSend(threadId: string, typing: boolean, now: number): boolean;
}

/**
 * Per-thread typing throttle:
 * - `true` sends immediately on the first keystroke, then at most every `refreshMs`
 *   while composing continues (keeping the server's 6s notice alive);
 * - `false` sends ONLY when a `true` is outstanding (send/blur/cleared draft), and
 *   resets the clock so the next composing burst signals immediately;
 * - `false` while already idle is suppressed entirely (thread switches, re-renders).
 */
export function createTypingThrottle(refreshMs = TYPING_REFRESH_MS): TypingThrottle {
  const lastSentAt = new Map<string, number>(); // threads with an outstanding `true`
  return {
    shouldSend(threadId, typing, now) {
      const sentAt = lastSentAt.get(threadId);
      if (typing) {
        if (sentAt != null && now - sentAt < refreshMs) return false;
        lastSentAt.set(threadId, now);
        return true;
      }
      if (sentAt == null) return false;
      lastSentAt.delete(threadId);
      return true;
    },
  };
}

/**
 * Read-receipt guard: send a receipt only when the thread HAS a latest event and it
 * differs from the one we last acknowledged. This is what lets the UI fire `markRead`
 * from an effect on [activeThreadId, store.version()] without a receipt→sync→version→
 * receipt loop — the second pass sees its own receipt's event id and stops.
 */
export function shouldMarkRead(
  latestEventId: string | undefined,
  lastAckedEventId: string | undefined,
): boolean {
  return !!latestEventId && latestEventId !== lastAckedEventId;
}
