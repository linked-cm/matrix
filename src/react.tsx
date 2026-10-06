/**
 * Live Matrix transport holder — CLIENT-ONLY. There is exactly one transport: the
 * host's homeserver. While it connects, callers render their own loader; if it
 * fails, chat FAILS GRACEFULLY (error state + retry) rather than substituting
 * demo data for a real conversation surface.
 *
 * The host supplies its session (who is signed in) and its namespace; this module
 * owns only the connect/retry lifecycle.
 */
import React from 'react';
import type { Messaging } from '@linked.cm/messaging';
import { createMatrixMessaging, fetchMatrixSession } from './client.js';
import type { MatrixNamespaceConfig } from './config.js';

type LiveTransport = Messaging & { stop(): void };
export type MatrixTransportState = 'off' | 'connecting' | 'on' | 'error';

/** Who is signed in, as the host sees it. Returning null keeps the transport off. */
export interface MatrixViewer {
  webId: string;
  name?: string;
}

export interface MatrixTransportOptions {
  getViewer: () => MatrixViewer | null;
  namespace: Partial<MatrixNamespaceConfig> & Pick<MatrixNamespaceConfig, 'serverName'>;
  /** Route the host mounted for the session bridge. */
  sessionRoute?: string;
  /** Expose the seam (never credentials) on `window[debugHandle]` for devtools. */
  debugHandle?: string;
}

let live: LiveTransport | null = null;
let state: MatrixTransportState = 'off';
let options: MatrixTransportOptions | null = null;
const waiters = new Set<() => void>();
const notify = () => {
  waiters.forEach((fn) => fn());
};

export function matrixTransportState(): MatrixTransportState {
  return state;
}

async function connect(): Promise<void> {
  if (state === 'connecting' || state === 'on' || !options) return;
  const viewer = options.getViewer();
  if (!viewer?.webId) return;
  state = 'connecting';
  notify();
  try {
    live = await createMatrixMessaging(
      await fetchMatrixSession(viewer.webId, viewer.name, options.sessionRoute),
      options.namespace,
    );
    // debug handle: the SEAM only (no credentials live on it) — lets a devtools
    // session inspect the projected spaces/threads/messages.
    if (options.debugHandle) (window as any)[options.debugHandle] = live;
    state = 'on';
  } catch (cause) {
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
 * every mount re-registers its waiter and re-kicks an idle connect.
 */
export function useMatrixTransport(opts: MatrixTransportOptions): {
  transport: Messaging | null;
  state: MatrixTransportState;
} {
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  options = opts;
  React.useEffect(() => {
    waiters.add(force);
    if (state === 'off') connect();
    return () => {
      waiters.delete(force);
    };
  }, []);
  return { transport: state === 'on' ? live : null, state };
}
