/**
 * Live Matrix transport holder — CLIENT-ONLY. There is exactly one transport: the
 * host's homeserver. While it connects, callers render their own loader; if it
 * fails, chat FAILS GRACEFULLY (error state + retry) rather than substituting
 * demo data for a real conversation surface.
 *
 * The host supplies its session (who is signed in) and its namespace; this module
 * owns only the connect/retry lifecycle. `webId` is read locally so the hook
 * knows whether someone is signed in and when that person changes. It is never
 * sent to the session route — only `name` is, and only as a cosmetic display name.
 */
import React from 'react';
import type { Messaging } from '@linked.cm/messaging';
import { createMatrixMessaging, fetchMatrixSession, type MatrixSessionHeaders } from './client.js';
import type { MatrixNamespaceConfig } from './config.js';

type LiveTransport = Messaging & { stop(): void };
export type MatrixTransportState = 'off' | 'connecting' | 'on' | 'error';

/**
 * Who is signed in, as the host sees it. Returning null keeps the transport off.
 * `webId` is not a credential and is not posted to the session route.
 */
export interface MatrixViewer {
  webId: string;
  name?: string;
}

export interface MatrixTransportOptions {
  getViewer: () => MatrixViewer | null;
  namespace: Partial<MatrixNamespaceConfig> & Pick<MatrixNamespaceConfig, 'serverName'>;
  /** Route the host mounted for the session bridge. */
  sessionRoute?: string;
  /** Headers (or a function returning them) that carry the host session to its route, e.g. a bearer token. */
  sessionHeaders?: MatrixSessionHeaders;
  /** Credentials mode for the session request. Defaults to `'same-origin'`. */
  sessionCredentials?: RequestCredentials;
  /** Expose the seam (never credentials) on `window[debugHandle]` for devtools. */
  debugHandle?: string;
}

let live: LiveTransport | null = null;
let state: MatrixTransportState = 'off';
let options: MatrixTransportOptions | null = null;
/** WebID the in-flight or live transport was opened for. Local only; never sent. */
let openedFor: string | null = null;
let connectGeneration = 0;
const waiters = new Set<() => void>();
const notify = () => {
  waiters.forEach((fn) => fn());
};

function clearDebugHandle(): void {
  const handle = options?.debugHandle;
  if (!handle || typeof window === 'undefined') return;
  delete (window as any)[handle];
}

/** Drop the current transport and invalidate any in-flight connect. */
function dropLive(): void {
  connectGeneration += 1;
  live?.stop();
  live = null;
  openedFor = null;
  clearDebugHandle();
}

export function matrixTransportState(): MatrixTransportState {
  return state;
}

async function connect(): Promise<void> {
  if (state === 'connecting' || state === 'on' || !options) return;
  const viewer = options.getViewer();
  if (!viewer?.webId) return;
  const webId = viewer.webId;
  const name = viewer.name;
  const sessionRoute = options.sessionRoute;
  const headers = options.sessionHeaders;
  const credentials = options.sessionCredentials;
  const namespace = options.namespace;
  const debugHandle = options.debugHandle;
  const generation = ++connectGeneration;
  openedFor = webId;
  state = 'connecting';
  notify();
  try {
    const session = await fetchMatrixSession({ name, sessionRoute, headers, credentials });
    if (generation !== connectGeneration) return;
    const transport = await createMatrixMessaging(session, namespace);
    if (generation !== connectGeneration) {
      transport.stop();
      return;
    }
    live = transport;
    // debug handle: the SEAM only (no credentials live on it) — lets a devtools
    // session inspect the projected spaces/threads/messages.
    if (debugHandle && typeof window !== 'undefined') (window as any)[debugHandle] = live;
    state = 'on';
  } catch (cause) {
    if (generation !== connectGeneration) return;
    state = 'error';
    console.warn('[matrix] transport unavailable:', cause);
  }
  notify();
}

/** Error-panel retry: drop the failed attempt and reconnect. */
export function retryMatrixConnect(): void {
  if (state !== 'error') return;
  state = 'off';
  connect();
}

/**
 * The live transport (null while connecting/errored). StrictMode/HMR-proof:
 * every mount re-registers its waiter and re-kicks an idle connect. A change
 * of signed-in WebID drops the previous transport before connecting again.
 */
export function useMatrixTransport(opts: MatrixTransportOptions): {
  transport: Messaging | null;
  state: MatrixTransportState;
} {
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  options = opts;
  const viewerId = opts.getViewer()?.webId ?? null;
  React.useEffect(() => {
    waiters.add(force);
    if (state !== 'off' && openedFor !== viewerId) {
      dropLive();
      state = 'off';
      notify();
    }
    if (state === 'off') connect();
    return () => {
      waiters.delete(force);
    };
  }, [viewerId]);
  return { transport: state === 'on' ? live : null, state };
}
