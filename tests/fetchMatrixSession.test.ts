import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMatrixSession } from '../src/client.js';

const session = {
  webId: 'https://id.example/session',
  mxid: '@p_test:chat.example.org',
  accessToken: 'access-token',
  deviceId: 'DEVICE',
  homeserverUrl: 'https://chat.example.org',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch() {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => session,
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function bodyOf(fetchMock: ReturnType<typeof stubFetch>): Record<string, unknown> {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
}

describe('fetchMatrixSession', () => {
  it('sends { name } only, with same-origin credentials, and never a webId key', async () => {
    const fetchMock = stubFetch();
    const result = await fetchMatrixSession({ name: 'Ada', sessionRoute: '/api/matrix/session' });
    expect(result.mxid).toBe(session.mxid);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/matrix/session',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const body = bodyOf(fetchMock);
    expect(body).toEqual({ name: 'Ada' });
    expect(Object.prototype.hasOwnProperty.call(body, 'webId')).toBe(false);
  });

  it('defaults the route and omits name without introducing a webId key', async () => {
    const fetchMock = stubFetch();
    await fetchMatrixSession();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/matrix/session');
    const body = bodyOf(fetchMock);
    expect(body).toEqual({});
    expect('webId' in body).toBe(false);
  });

  it('drops a webId smuggled onto the options object', async () => {
    const fetchMock = stubFetch();
    await fetchMatrixSession({ name: 'Ada', webId: 'https://id.example/other' } as { name?: string });
    const body = bodyOf(fetchMock);
    expect(body).toEqual({ name: 'Ada' });
    expect('webId' in body).toBe(false);
  });

  it('does not treat a legacy string argument as a WebID to send', async () => {
    const fetchMock = stubFetch();
    await fetchMatrixSession('https://id.example/other' as never);
    const body = bodyOf(fetchMock);
    expect(body).toEqual({});
    expect('webId' in body).toBe(false);
  });

  it('attaches host headers so a bearer-token session reaches the route, keeping the JSON content type', async () => {
    const fetchMock = stubFetch();
    await fetchMatrixSession({
      name: 'Ada',
      headers: { Authorization: 'Bearer host-session', 'Content-Type': 'text/plain' },
    });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toEqual({ Authorization: 'Bearer host-session', 'Content-Type': 'application/json' });
    expect(init.credentials).toBe('same-origin');
    expect(Object.keys(bodyOf(fetchMock))).toEqual(['name']);
  });

  it('awaits a headers function and honours a credentials override', async () => {
    const fetchMock = stubFetch();
    await fetchMatrixSession({
      headers: async () => ({ Authorization: 'Bearer fresh' }),
      credentials: 'include',
    });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer fresh');
    expect(init.credentials).toBe('include');
    expect(bodyOf(fetchMock)).not.toHaveProperty('webId');
  });
});
