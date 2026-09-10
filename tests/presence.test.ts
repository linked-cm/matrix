import { describe, expect, it } from 'vitest';
import {
  createTypingThrottle,
  shouldMarkRead,
  TYPING_REFRESH_MS,
  TYPING_SERVER_TIMEOUT_MS,
} from '../src/presence.js';

// Typing + read-receipt decisions (plan 036 P4) — pure, clock-injected. These are
// the ONLY things standing between "fire on every keystroke / every render effect"
// and request spam, so the contracts are tested exhaustively here.

describe('createTypingThrottle', () => {
  it('first keystroke sends immediately; the composing burst then collapses to one send per refresh window', () => {
    const th = createTypingThrottle();
    expect(th.shouldSend('!t', true, 0)).toBe(true);
    // hammering within the window — all suppressed
    expect(th.shouldSend('!t', true, 100)).toBe(false);
    expect(th.shouldSend('!t', true, TYPING_REFRESH_MS - 1)).toBe(false);
    // window elapsed — refresh the server's notice
    expect(th.shouldSend('!t', true, TYPING_REFRESH_MS)).toBe(true);
    expect(th.shouldSend('!t', true, TYPING_REFRESH_MS + 100)).toBe(false);
  });

  it('the refresh window sits below the server timeout (the indicator never flickers off mid-composition)', () => {
    expect(TYPING_REFRESH_MS).toBeLessThan(TYPING_SERVER_TIMEOUT_MS);
  });

  it('false sends only while a true is outstanding; idle falses are suppressed entirely', () => {
    const th = createTypingThrottle();
    // never composed here — blur/thread-switch cleanup must not hit the network
    expect(th.shouldSend('!t', false, 0)).toBe(false);
    th.shouldSend('!t', true, 10);
    expect(th.shouldSend('!t', false, 20)).toBe(true); // send/blur/cleared draft
    expect(th.shouldSend('!t', false, 30)).toBe(false); // already withdrawn
  });

  it('false resets the clock — the next composing burst signals immediately, not after the window', () => {
    const th = createTypingThrottle();
    th.shouldSend('!t', true, 0);
    th.shouldSend('!t', false, 50); // sent the message
    expect(th.shouldSend('!t', true, 60)).toBe(true); // new burst inside the old window
  });

  it('threads throttle independently', () => {
    const th = createTypingThrottle();
    expect(th.shouldSend('!a', true, 0)).toBe(true);
    expect(th.shouldSend('!b', true, 1)).toBe(true);
    expect(th.shouldSend('!a', true, 2)).toBe(false);
    expect(th.shouldSend('!b', false, 3)).toBe(true);
    expect(th.shouldSend('!a', false, 4)).toBe(true);
  });

  it('honors an injected refresh interval', () => {
    const th = createTypingThrottle(1000);
    th.shouldSend('!t', true, 0);
    expect(th.shouldSend('!t', true, 999)).toBe(false);
    expect(th.shouldSend('!t', true, 1000)).toBe(true);
  });
});

describe('shouldMarkRead', () => {
  it('sends when a latest event exists that we have not acknowledged', () => {
    expect(shouldMarkRead('$e1', undefined)).toBe(true);
    expect(shouldMarkRead('$e2', '$e1')).toBe(true);
  });

  it('repeat fires on the same latest event are no-ops — the effect-on-version loop terminates', () => {
    expect(shouldMarkRead('$e1', '$e1')).toBe(false);
  });

  it('an empty timeline never receipts', () => {
    expect(shouldMarkRead(undefined, undefined)).toBe(false);
    expect(shouldMarkRead(undefined, '$e1')).toBe(false);
  });
});
