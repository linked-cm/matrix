import { beforeEach, describe, expect, it, vi } from 'vitest';

const ensureMatrixSession = vi.hoisted(() => vi.fn());

vi.mock('../src/backend/identity.js', () => ({
  ensureMatrixSession,
}));

import {
  createMatrixSessionHandler,
  registerMatrixRoutes,
  type MatrixSessionResponse,
} from '../src/backend/routes.js';

const SESSION = 'https://id.example/session';
const identity = {
  webId: SESSION,
  mxid: '@p_test:chat.example.org',
  accessToken: 'access-token',
  deviceId: 'DEVICE',
  homeserverUrl: 'https://chat.example.org',
};

function mockRes(): MatrixSessionResponse & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe('createMatrixSessionHandler', () => {
  beforeEach(() => {
    ensureMatrixSession.mockReset();
  });

  it('throws at construction when resolveWebId is missing', () => {
    expect(() =>
      createMatrixSessionHandler({ ensureSession: async () => identity } as never),
    ).toThrow(/resolveWebId/);
    expect(() => createMatrixSessionHandler(undefined as never)).toThrow(/resolveWebId/);
  });

  it('throws at construction when neither ensureSession nor a bridge config is given', () => {
    expect(() => createMatrixSessionHandler({ resolveWebId: () => SESSION })).toThrow(/ensureSession|serverName/);
  });

  it('rejects a body webId even with a valid session, and does not mint', async () => {
    const ensure = vi.fn(async () => identity);
    const handler = createMatrixSessionHandler({
      resolveWebId: () => SESSION,
      ensureSession: ensure,
    });
    for (const webId of ['https://id.example/other', '', null]) {
      ensure.mockClear();
      const res = mockRes();
      await handler({ body: { webId, name: 'Gloria' } }, res);
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'webid-from-session-only' });
      expect(ensure).not.toHaveBeenCalled();
    }
  });

  it('rejects a webId key in an unparsed JSON body', async () => {
    const ensure = vi.fn(async () => identity);
    const handler = createMatrixSessionHandler({
      resolveWebId: () => SESSION,
      ensureSession: ensure,
    });
    const res = mockRes();
    await handler({ body: JSON.stringify({ webId: 'https://id.example/other', name: 'Gloria' }) }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'webid-from-session-only' });
    expect(ensure).not.toHaveBeenCalled();
  });

  it('answers 401 when the session has no WebID, and does not mint', async () => {
    const ensure = vi.fn(async () => identity);
    for (const sessionWebId of [null, undefined, '', '   ']) {
      ensure.mockClear();
      const handler = createMatrixSessionHandler({
        resolveWebId: async () => sessionWebId,
        ensureSession: ensure,
      });
      const res = mockRes();
      await handler({ body: { name: 'Ada' } }, res);
      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: 'authentication-required' });
      expect(ensure).not.toHaveBeenCalled();
    }
  });

  it('mints for the session WebID, not any body value', async () => {
    const ensure = vi.fn(async () => identity);
    const handler = createMatrixSessionHandler({
      resolveWebId: async () => SESSION,
      ensureSession: ensure,
    });
    const res = mockRes();
    await handler({ body: { name: 'Ada', otherId: 'https://id.example/other' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(identity);
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(ensure).toHaveBeenCalledWith(SESSION, 'Ada');
  });

  it('prefers resolveDisplayName over a cosmetic body name', async () => {
    const ensure = vi.fn(async () => identity);
    const handler = createMatrixSessionHandler({
      resolveWebId: () => SESSION,
      resolveDisplayName: async () => 'Session Name',
      ensureSession: ensure,
    });
    const res = mockRes();
    await handler({ body: { name: 'Body Name' } }, res);
    expect(res.statusCode).toBe(200);
    expect(ensure).toHaveBeenCalledWith(SESSION, 'Session Name');
  });

  it('uses an undefined resolveDisplayName result instead of falling through to body name', async () => {
    const ensure = vi.fn(async () => identity);
    const handler = createMatrixSessionHandler({
      resolveWebId: () => SESSION,
      resolveDisplayName: () => undefined,
      ensureSession: ensure,
    });
    await handler({ body: { name: 'Body Name' } }, mockRes());
    expect(ensure).toHaveBeenCalledWith(SESSION, undefined);
  });

  it('uses a string body name only when resolveDisplayName is absent, and ignores a non-string name', async () => {
    const ensure = vi.fn(async () => identity);
    const handler = createMatrixSessionHandler({
      resolveWebId: () => SESSION,
      ensureSession: ensure,
    });
    await handler({ body: { name: 42 } }, mockRes());
    expect(ensure).toHaveBeenCalledWith(SESSION, undefined);
    ensure.mockClear();
    await handler({ body: {} }, mockRes());
    expect(ensure).toHaveBeenCalledWith(SESSION, undefined);
    ensure.mockClear();
    await handler({ body: { name: 'Body Name' } }, mockRes());
    expect(ensure).toHaveBeenCalledWith(SESSION, 'Body Name');
  });

  it('answers 502 with the error message and does not log', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const handler = createMatrixSessionHandler({
      resolveWebId: () => SESSION,
      ensureSession: async () => {
        throw new Error('bridge down');
      },
    });
    const res = mockRes();
    await handler({ body: { name: 'Ada' } }, res);
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: 'bridge down' });
    expect(error).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    error.mockRestore();
    log.mockRestore();
    warn.mockRestore();

    const thrown = createMatrixSessionHandler({
      resolveWebId: () => SESSION,
      ensureSession: async () => {
        throw 'nope';
      },
    });
    const again = mockRes();
    await thrown({ body: {} }, again);
    expect(again.statusCode).toBe(502);
    expect(again.body).toEqual({ error: 'nope' });
  });

  it('calls ensureMatrixSession with the session WebID when given a bridge config', async () => {
    ensureMatrixSession.mockResolvedValue(identity);
    const config = { serverName: 'chat.example.org', registrationPath: 'infra/matrix/appservice.yaml' };
    const handler = createMatrixSessionHandler({
      resolveWebId: () => SESSION,
      config,
    });
    const res = mockRes();
    await handler({ body: { name: 'Ada' } }, res);
    expect(res.statusCode).toBe(200);
    expect(ensureMatrixSession).toHaveBeenCalledTimes(1);
    expect(ensureMatrixSession).toHaveBeenCalledWith(SESSION, config, 'Ada');
  });

  it('accepts a flat serverName and prefers an injected ensureSession over config', async () => {
    ensureMatrixSession.mockResolvedValue(identity);
    const flat = createMatrixSessionHandler({
      resolveWebId: () => SESSION,
      serverName: 'chat.example.org',
    });
    await flat({ body: {} }, mockRes());
    expect(ensureMatrixSession).toHaveBeenCalledWith(SESSION, { serverName: 'chat.example.org' }, undefined);

    ensureMatrixSession.mockClear();
    const ensure = vi.fn(async () => identity);
    const injected = createMatrixSessionHandler({
      resolveWebId: () => SESSION,
      ensureSession: ensure,
      config: { serverName: 'chat.example.org' },
    });
    await injected({ body: {} }, mockRes());
    expect(ensure).toHaveBeenCalledWith(SESSION, undefined);
    expect(ensureMatrixSession).not.toHaveBeenCalled();
  });

  it('registerMatrixRoutes mounts the handler on the given path, or the default', async () => {
    const custom: { path?: string; handler?: (req: { body?: unknown }, res: MatrixSessionResponse) => Promise<unknown> } = {};
    registerMatrixRoutes(
      {
        post(path, handler) {
          custom.path = path;
          custom.handler = handler;
        },
      },
      {
        sessionPath: '/api/custom/session',
        resolveWebId: () => SESSION,
        ensureSession: async () => identity,
      },
    );
    expect(custom.path).toBe('/api/custom/session');
    const res = mockRes();
    await custom.handler!({ body: { name: 'Ada' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(identity);

    const fallback: { path?: string } = {};
    registerMatrixRoutes(
      {
        post(path) {
          fallback.path = path;
        },
      },
      { resolveWebId: () => SESSION, ensureSession: async () => identity },
    );
    expect(fallback.path).toBe('/api/matrix/session');
  });
});
