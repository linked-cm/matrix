import { describe, expect, it, vi } from 'vitest';
import { createMatrixModerationHandler } from '../src/backend/moderation.js';

function response() {
  const state = { status: 0, body: undefined as unknown };
  return {
    state,
    res: {
      status(code: number) { state.status = code; return this; },
      json(body: unknown) { state.body = body; return body; },
    },
  };
}

describe('matrix moderation handler', () => {
  it('rejects caller identity in the request body before authorization', async () => {
    const authorize = vi.fn();
    const handler = createMatrixModerationHandler({
      resolveWebId: () => 'https://id.example/me', authorize,
      redact: vi.fn(),
    });
    const { res, state } = response();
    await handler({ body: { webId: 'https://id.example/other', roomId: '!r', eventId: '$e', action: 'redact' } }, res);
    expect(state.status).toBe(400);
    expect(authorize).not.toHaveBeenCalled();
  });

  it('requires an authenticated session and host authorization', async () => {
    const handler = createMatrixModerationHandler({
      resolveWebId: () => null,
      authorize: vi.fn(),
      redact: vi.fn(),
    });
    const first = response();
    await handler({ body: { roomId: '!r', eventId: '$e', action: 'redact' } }, first.res);
    expect(first.state.status).toBe(401);

    const denied = response();
    const redact = vi.fn();
    const deniedHandler = createMatrixModerationHandler({
      resolveWebId: () => 'https://id.example/me',
      authorize: () => ({ allowed: false, status: 403, error: 'not-a-moderator' }),
      redact,
    });
    await deniedHandler({ body: { roomId: '!r', eventId: '$e', action: 'redact' } }, denied.res);
    expect(denied.state).toEqual({ status: 403, body: { error: 'not-a-moderator' } });
    expect(redact).not.toHaveBeenCalled();
  });

  it('redacts only after the host authorizes the verified caller', async () => {
    const redact = vi.fn();
    const handler = createMatrixModerationHandler({
      resolveWebId: () => 'https://id.example/me',
      authorize: (input) => ({ allowed: input.roomId === '!allowed' }),
      redact,
    });
    const { res, state } = response();
    await handler({ body: { roomId: '!allowed', eventId: '$event', action: 'redact', reason: 'policy' } }, res);
    expect(state.status).toBe(200);
    expect(redact).toHaveBeenCalledWith({
      callerId: 'https://id.example/me', roomId: '!allowed', eventId: '$event', reason: 'policy',
    });
  });
});
