/**
 * Matrix identity bridge — SERVER-ONLY. A verified host session yields a Matrix
 * session with no second credential: the backend holds the appservice `as_token`
 * and registers-or-logs-in the caller's puppet MXID via
 * `m.login.application_service`. (Continuwuity ships no MSC3861/MAS, so
 * appservice-mediated auth is the supported route.)
 *
 * The as_token NEVER reaches a client; callers receive only their own
 * user-scoped access token.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { localpartForWebId, mxidForWebId } from '../mxid.js';

export interface MatrixIdentity {
  webId: string;
  mxid: string;
  accessToken: string;
  deviceId: string;
  homeserverUrl: string;
}

/** Everything the bridge needs that is not a Matrix protocol fact. */
export interface MatrixBridgeConfig {
  /** Homeserver domain — the part after the colon in an MXID. */
  serverName: string;
  /** Account-data type storing the subject's WebID on the Matrix account. */
  webIdAccountDataType?: string;
  /** Path to the appservice registration YAML, when tokens are not in env. */
  registrationPath?: string;
  /**
   * Mirror the WebID↔MXID mapping into the host's graph. Optional and non-fatal:
   * a mirror hiccup must never block a login. Hosts normally pass a writer built
   * on MatrixIdentityShape.
   */
  recordIdentity?: (webId: string, mxid: string) => Promise<unknown>;
}

const DEFAULT_REGISTRATION_PATH = 'infra/matrix/appservice.yaml';
const DEFAULT_WEBID_ACCOUNT_DATA = 'cm.linked.webid';

const HS_URL = () => process.env.MATRIX_HS_URL || 'http://127.0.0.1:4148';
/** What BROWSERS should dial: the public domain when fronted by Caddy
 *  (staging/prod), else the loopback that local dev genuinely exposes. */
const HS_PUBLIC_URL = () => process.env.MATRIX_PUBLIC_URL || HS_URL();

/** Read one token from env, else from the generated appservice registration. */
function readToken(
  envName: string,
  field: 'as_token' | 'hs_token',
  registrationPath: string,
): string | null {
  if (process.env[envName]) return process.env[envName]!;
  try {
    const yaml = readFileSync(join(process.cwd(), registrationPath), 'utf8');
    return yaml.match(new RegExp(`^${field}:\\s*"([^"]+)"`, 'm'))?.[1] ?? null;
  } catch {
    return null; // homeserver not provisioned — bridge disabled
  }
}

const asTokenCache = new Map<string, string | null>();
const hsTokenCache = new Map<string, string | null>();

/** as_token from env (staging/prod) or the generated registration (local dev). */
export function matrixAsToken(registrationPath = DEFAULT_REGISTRATION_PATH): string | null {
  if (!asTokenCache.has(registrationPath)) {
    asTokenCache.set(registrationPath, readToken('MATRIX_AS_TOKEN', 'as_token', registrationPath));
  }
  return asTokenCache.get(registrationPath)!;
}

/** hs_token: how the HOMESERVER authenticates itself to our appservice endpoints. */
export function matrixHsToken(registrationPath = DEFAULT_REGISTRATION_PATH): string | null {
  if (!hsTokenCache.has(registrationPath)) {
    hsTokenCache.set(registrationPath, readToken('MATRIX_HS_TOKEN', 'hs_token', registrationPath));
  }
  return hsTokenCache.get(registrationPath)!;
}

async function hs(path: string, body: unknown, token: string, query = '') {
  const res = await fetch(`${HS_URL()}/_matrix/client/v3${path}${query}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

/**
 * Privileged server primitive. Register-or-login the puppet for `webId` and
 * return that account's user-scoped access token.
 *
 * Call this only with a WebID the host has authenticated, or a WebID the host
 * is authorized to provision (for example the other party of a direct
 * conversation the session user is allowed to open). Never pass a WebID taken
 * from a request body. The safe default for the caller's own session is
 * `createMatrixSessionHandler`, which reads the host's verified session and
 * refuses a body `webId`.
 *
 * Register wins the common first-contact case; M_USER_IN_USE falls through
 * to appservice login. Both paths are idempotent per call — each issues a
 * new device, which the client persists (device reuse is the client's job,
 * matrix-js-sdk crypto store).
 */
export async function ensureMatrixSession(
  webId: string,
  config: MatrixBridgeConfig,
  displayName?: string,
): Promise<MatrixIdentity> {
  const registrationPath = config.registrationPath ?? DEFAULT_REGISTRATION_PATH;
  const asToken = matrixAsToken(registrationPath);
  if (!asToken) {
    throw new Error(
      `Matrix bridge is not configured (no as_token in env or ${registrationPath}) — run the bootstrap script.`,
    );
  }
  const localpart = await localpartForWebId(webId);
  const mxid = await mxidForWebId(webId, config.serverName);

  let session = await hs(
    '/register',
    { type: 'm.login.application_service', username: localpart },
    asToken,
  );
  if (!session.ok && session.json?.errcode === 'M_USER_IN_USE') {
    session = await hs(
      '/login',
      {
        type: 'm.login.application_service',
        identifier: { type: 'm.id.user', user: localpart },
      },
      asToken,
    );
  }
  if (!session.ok || !session.json?.access_token) {
    throw new Error(
      `Matrix session failed: ${session.json?.errcode ?? 'unknown'} ${session.json?.error ?? ''}`.trim(),
    );
  }
  const accessToken = session.json.access_token as string;
  const deviceId = session.json.device_id as string;

  // WebID on the Matrix account: chat identity resolves back to linked data.
  // Account data is per-user server-side storage; the write is idempotent and
  // non-fatal (profile sugar, not a safety property).
  await fetch(
    `${HS_URL()}/_matrix/client/v3/user/${encodeURIComponent(mxid)}/account_data/${encodeURIComponent(config.webIdAccountDataType ?? DEFAULT_WEBID_ACCOUNT_DATA)}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ webId }),
    },
  ).catch(() => {});

  // Human display name on the puppet (authors otherwise render as raw MXIDs).
  // Cosmetic, never identity: the MXID stays the opaque anchor.
  if (displayName?.trim()) {
    await fetch(
      `${HS_URL()}/_matrix/client/v3/profile/${encodeURIComponent(mxid)}/displayname`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ displayname: displayName.trim() }),
      },
    ).catch(() => {});
  }

  // Graph mirror for reverse lookup (MXID → subject) used by safety audits.
  // Non-fatal: a mirror hiccup must not block login; audits treat unknown
  // accounts protectively anyway.
  if (config.recordIdentity) {
    try {
      await config.recordIdentity(webId, mxid);
    } catch (cause) {
      console.warn('[matrix:identity] mirror failed:', cause);
    }
  }

  return {
    webId,
    mxid,
    accessToken,
    deviceId,
    // Browser-facing: server-side calls in this module keep using HS_URL().
    homeserverUrl: HS_PUBLIC_URL(),
  };
}
