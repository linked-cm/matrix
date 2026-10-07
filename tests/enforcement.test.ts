import { describe, expect, it, vi } from 'vitest';
import { assertMatrixEnforcement } from '../src/enforcement.js';
import {
  createMatrixEnforcedSendHandler,
  createModeratedRoomPowerLevels,
  type MatrixEnforcementControl,
} from '../src/backend/enforcement.js';
import type { MatrixSessionResponse } from '../src/backend/routes.js';

const WEB_ID = 'https://id.example/alice';
const ACTOR = { id: '@alice:chat.example.org', name: 'Alice' };
const EVENT = {
  roomId: '!room:chat.example.org',
  eventType: 'm.room.message',
  content: { msgtype: 'm.text', body: 'Peace begins with us.' },
};

function mockRes(): MatrixSessionResponse & {
  statusCode: number;
  body: unknown;
} {
  return {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

const allowControl = (): MatrixEnforcementControl => ({
  id: 'safety',
  evaluate: () => ({ allowed: true }),
});

describe('createMatrixEnforcedSendHandler', () => {
  it('requires at least one real control', () => {
    const base = {
      resolveWebId: () => WEB_ID,
      resolveActor: () => ACTOR,
      authorize: () => ({ allowed: true }),
      dispatch: async () => ({ eventId: '$sent' }),
    };
    expect(() =>
      createMatrixEnforcedSendHandler({ ...base, controls: [] })
    ).toThrow(/at least one control/);
  });

  it('derives identity from the session and rejects injected identity', async () => {
    const dispatch = vi.fn(async () => ({ eventId: '$sent' }));
    const handler = createMatrixEnforcedSendHandler({
      resolveWebId: () => WEB_ID,
      resolveActor: () => ACTOR,
      authorize: () => ({ allowed: true }),
      controls: [allowControl()],
      dispatch,
    });
    for (const key of ['webId', 'callerId', 'senderId', 'userId', 'mxid']) {
      const res = mockRes();
      await handler({ body: { ...EVENT, [key]: 'attacker' } }, res);
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'identity-from-session-only' });
    }
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('runs authorization and every active control before relay dispatch', async () => {
    const evaluate = vi.fn(() => ({ allowed: true }));
    const dispatch = vi.fn(async () => ({ eventId: '$sent' }));
    const handler = createMatrixEnforcedSendHandler({
      resolveWebId: () => WEB_ID,
      resolveActor: () => ACTOR,
      authorize: () => ({ allowed: true }),
      controls: [{ id: 'safety', evaluate }],
      dispatch,
    });
    const res = mockRes();
    await handler({ body: EVENT }, res);
    expect(res.body).toEqual({ event_id: '$sent' });
    expect(evaluate).toHaveBeenCalledWith(
      expect.objectContaining({ callerId: WEB_ID })
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: ACTOR,
        content: expect.objectContaining({ 'cm.linked.actor': ACTOR }),
      })
    );
  });

  it('silently suppresses a denied event with a success-shaped response', async () => {
    const dispatch = vi.fn(async () => ({ eventId: '$sent' }));
    const onDenied = vi.fn();
    const handler = createMatrixEnforcedSendHandler({
      resolveWebId: () => WEB_ID,
      resolveActor: () => ACTOR,
      authorize: () => ({ allowed: true }),
      controls: [
        { id: 'safety', evaluate: () => ({ allowed: false, silent: true }) },
      ],
      dispatch,
      onDenied,
      syntheticEventId: () => '$synthetic',
    });
    const res = mockRes();
    await handler({ body: EVENT }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ event_id: '$synthetic' });
    expect(dispatch).not.toHaveBeenCalled();
    expect(onDenied).toHaveBeenCalledWith(
      expect.objectContaining({ callerId: WEB_ID }),
      expect.objectContaining({ silent: true }),
      'safety'
    );
  });

  it('fails closed when a control is unavailable', async () => {
    const dispatch = vi.fn(async () => ({ eventId: '$sent' }));
    const handler = createMatrixEnforcedSendHandler({
      resolveWebId: () => WEB_ID,
      resolveActor: () => ACTOR,
      authorize: () => ({ allowed: true }),
      controls: [
        { id: 'safety', evaluate: () => Promise.reject(new Error('down')) },
      ],
      dispatch,
    });
    const res = mockRes();
    await handler({ body: EVENT }, res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: 'matrix-control-unavailable' });
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('relay enforcement contract', () => {
  it('creates power levels that deny members and permit the relay', () => {
    const levels = createModeratedRoomPowerLevels({
      relayUserId: '@relay:chat.example.org',
      memberUserIds: ['@alice:chat.example.org'],
    });
    expect(levels.events_default).toBe(50);
    expect(levels.users).toEqual({
      '@relay:chat.example.org': 100,
      '@alice:chat.example.org': 0,
    });
  });

  it('refuses clients that require a missing or different enforcement policy', () => {
    expect(() => assertMatrixEnforcement({}, true)).toThrow(
      /required but unavailable/
    );
    const session = {
      enforcement: {
        mode: 'relay' as const,
        policyId: 'peace-safety-v1',
        sendRoute: '/api/matrix/send',
      },
    };
    expect(() =>
      assertMatrixEnforcement(session, { policyId: 'other' })
    ).toThrow(/policy mismatch/);
    expect(() =>
      assertMatrixEnforcement(session, { policyId: 'peace-safety-v1' })
    ).not.toThrow();
  });
});
