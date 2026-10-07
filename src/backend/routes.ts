/**
 * Session route — framework-agnostic. The host reads its verified server
 * session and passes that WebID in. A `webId` key on the request body is
 * refused, so a caller cannot mint another person's Matrix login by posting
 * an identifier.
 *
 * Mount the handler with the host's own router (`registerRoute`, `app.post`,
 * …) or with `registerMatrixRoutes` on an Express-style server.
 */
import {
  ensureMatrixSession,
  type MatrixBridgeConfig,
  type MatrixIdentity,
} from './identity.js';
import type { MatrixEnforcementSession } from '../enforcement.js';

/** Enough of an incoming request for the session route. Only `body` is read. */
export interface MatrixSessionRequest {
  body?: unknown;
}

/**
 * Express-style response. Hosts that use `(req, res)` handlers already have
 * this shape: `res.status(code).json(payload)`.
 */
export interface MatrixSessionResponse {
  status(code: number): MatrixSessionResponse;
  json(payload: unknown): unknown;
}

export type MatrixSessionHandler = (
  req: MatrixSessionRequest,
  res: MatrixSessionResponse
) => Promise<unknown>;

/** Read the WebID from the host's verified server session. */
export type WebIdFromRequest = (
  req: MatrixSessionRequest
) => Promise<string | null | undefined> | string | null | undefined;

/** Optional display name from the host session. Cosmetic; never identity. */
export type DisplayNameFromRequest = (
  req: MatrixSessionRequest
) => Promise<string | null | undefined> | string | null | undefined;

/**
 * Injected bridge. Matches a host wrapper such as Serve's
 * `ensureMatrixSession(webId, displayName)`, which already closes over the
 * bridge config.
 */
export type EnsureMatrixSessionFn = (
  webId: string,
  displayName?: string
) => Promise<MatrixIdentity>;

export interface MatrixSessionHandlerOptions {
  /**
   * REQUIRED. Read the WebID from the host's verified server session.
   * Construction throws when this is missing, so the unsafe "trust the body"
   * wiring cannot be configured by accident.
   */
  resolveWebId: WebIdFromRequest;
  /**
   * Display name from the host session. When this function is provided, its
   * result is used and a body `name` is ignored.
   */
  resolveDisplayName?: DisplayNameFromRequest;
  /**
   * Host bridge wrapper. Takes precedence over `config` and over flat
   * `serverName` fields. Tests inject a mock here.
   */
  ensureSession?: EnsureMatrixSessionFn;
  /** Bridge configuration. Used when `ensureSession` is not injected. */
  config?: MatrixBridgeConfig;
  /** Homeserver domain, when the bridge config is passed flat on these options. */
  serverName?: string;
  webIdAccountDataType?: string;
  registrationPath?: string;
  recordIdentity?: MatrixBridgeConfig['recordIdentity'];
  /**
   * Mandatory relay enforcement. The session is refused unless `assertActive`
   * confirms that the relay route and room-locking infrastructure are healthy.
   */
  enforcement?: MatrixEnforcementSession & {
    assertActive(input: {
      webId: string;
      req: MatrixSessionRequest;
    }): boolean | Promise<boolean>;
  };
}

/** Express-style app with a `post` mount. */
export interface MatrixRouteServer {
  post(path: string, handler: MatrixSessionHandler): void;
}

const MISSING_RESOLVER =
  'createMatrixSessionHandler requires resolveWebId — read the WebID from the verified server session. A body webId is never accepted.';

const MISSING_BRIDGE =
  'createMatrixSessionHandler requires ensureSession or a MatrixBridgeConfig with serverName.';

function bridgeConfigOf(
  options: MatrixSessionHandlerOptions
): MatrixBridgeConfig | undefined {
  if (
    typeof options.config?.serverName === 'string' &&
    options.config.serverName.length > 0
  ) {
    return options.config;
  }
  if (typeof options.serverName !== 'string' || options.serverName.length === 0)
    return undefined;
  const config: MatrixBridgeConfig = { serverName: options.serverName };
  if (options.webIdAccountDataType !== undefined)
    config.webIdAccountDataType = options.webIdAccountDataType;
  if (options.registrationPath !== undefined)
    config.registrationPath = options.registrationPath;
  if (options.recordIdentity !== undefined)
    config.recordIdentity = options.recordIdentity;
  return config;
}

function parsedBody(body: unknown): unknown {
  if (typeof body !== 'string') return body;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

/** True when the parsed body has an own `webId` key, whatever its value. */
function bodyHasWebId(body: unknown): boolean {
  return (
    !!body &&
    typeof body === 'object' &&
    Object.prototype.hasOwnProperty.call(body, 'webId')
  );
}

function bodyName(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const name = (body as { name?: unknown }).name;
  return typeof name === 'string' ? name : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function displayNameFor(
  req: MatrixSessionRequest,
  options: MatrixSessionHandlerOptions,
  body: unknown
): Promise<string | undefined> {
  if (typeof options.resolveDisplayName === 'function') {
    const resolved = await options.resolveDisplayName(req);
    return typeof resolved === 'string' ? resolved : undefined;
  }
  return bodyName(body);
}

/**
 * Build the session handler. `resolveWebId` is mandatory at the type level
 * and checked again at construction: without it there is no safe way to know
 * who is signed in, and the handler refuses to exist.
 */
export function createMatrixSessionHandler(
  options: MatrixSessionHandlerOptions
): MatrixSessionHandler {
  if (!options || typeof options.resolveWebId !== 'function') {
    throw new Error(MISSING_RESOLVER);
  }
  const injected =
    typeof options.ensureSession === 'function'
      ? options.ensureSession
      : undefined;
  const config = injected ? undefined : bridgeConfigOf(options);
  if (!injected && !config) throw new Error(MISSING_BRIDGE);
  if (options.enforcement) {
    const enforcement = options.enforcement;
    if (
      enforcement.mode !== 'relay' ||
      !enforcement.policyId?.trim() ||
      !enforcement.sendRoute?.trim() ||
      typeof enforcement.assertActive !== 'function'
    ) {
      throw new Error(
        'Matrix enforcement requires mode relay, policyId, sendRoute, and assertActive'
      );
    }
  }
  const ensure: EnsureMatrixSessionFn =
    injected ??
    ((webId, displayName) =>
      ensureMatrixSession(webId, config as MatrixBridgeConfig, displayName));

  return async (req, res) => {
    try {
      const body = parsedBody(req?.body);
      // The key itself is the old, unsafe contract — reject it before minting
      // and before trusting anything else on the body.
      if (bodyHasWebId(body)) {
        return res.status(400).json({ error: 'webid-from-session-only' });
      }
      const sessionWebId = await options.resolveWebId(req);
      if (typeof sessionWebId !== 'string' || sessionWebId.trim() === '') {
        return res.status(401).json({ error: 'authentication-required' });
      }
      if (options.enforcement) {
        const active = await options.enforcement.assertActive({
          webId: sessionWebId,
          req,
        });
        if (!active) {
          return res
            .status(503)
            .json({ error: 'matrix-enforcement-unavailable' });
        }
      }
      const displayName = await displayNameFor(req, options, body);
      const identity = await ensure(sessionWebId, displayName);
      if (!options.enforcement) return res.status(200).json(identity);
      const { assertActive: _assertActive, ...enforcement } =
        options.enforcement;
      return res.status(200).json({ ...identity, enforcement });
    } catch (error) {
      // Do not log. Bridge failures can sit next to access tokens; the
      // response carries the message and nothing is written to the console.
      return res.status(502).json({ error: errorMessage(error) });
    }
  };
}

/**
 * Mount `POST {sessionPath}` (default `/api/matrix/session`) on an
 * Express-style server. Hosts whose router is `registerRoute(method, path,
 * handler)` should call `createMatrixSessionHandler` and register it themselves.
 */
export function registerMatrixRoutes(
  server: MatrixRouteServer,
  options: MatrixSessionHandlerOptions & { sessionPath?: string }
): void {
  const { sessionPath = '/api/matrix/session', ...handlerOptions } = options;
  server.post(sessionPath, createMatrixSessionHandler(handlerOptions));
}
