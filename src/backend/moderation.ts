import type {
  MatrixSessionRequest,
  MatrixSessionResponse,
  WebIdFromRequest,
} from './routes.js';

export interface MatrixModerationRequest extends MatrixSessionRequest {
  body?: unknown;
}

export interface MatrixModerationDecision {
  allowed: boolean;
  status?: number;
  error?: string;
}

export interface MatrixModerationHandlerOptions {
  /** Verified server session only; never read caller identity from the body. */
  resolveWebId: WebIdFromRequest;
  /** Host policy/graph authorization. The package makes no assumptions about roles. */
  authorize(input: {
    callerId: string;
    roomId: string;
    eventId: string;
    action: 'redact';
  }): MatrixModerationDecision | Promise<MatrixModerationDecision>;
  /** Appservice/bot redaction primitive supplied by the host bridge. */
  redact(input: {
    callerId: string;
    roomId: string;
    eventId: string;
    reason?: string;
  }): void | Promise<void>;
}

export type MatrixModerationHandler = (
  req: MatrixModerationRequest,
  res: MatrixSessionResponse,
) => Promise<unknown>;

const parsedBody = (body: unknown): unknown => {
  if (typeof body !== 'string') return body;
  try { return JSON.parse(body); } catch { return body; }
};

/** Framework-neutral, deny-by-default route for appservice-mediated redaction. */
export function createMatrixModerationHandler(
  options: MatrixModerationHandlerOptions,
): MatrixModerationHandler {
  if (!options || typeof options.resolveWebId !== 'function') {
    throw new Error('createMatrixModerationHandler requires resolveWebId');
  }
  if (typeof options.authorize !== 'function' || typeof options.redact !== 'function') {
    throw new Error('createMatrixModerationHandler requires authorize and redact');
  }
  return async (req, res) => {
    try {
      const body = parsedBody(req?.body);
      if (!body || typeof body !== 'object') {
        return res.status(400).json({ error: 'invalid-request' });
      }
      const record = body as Record<string, unknown>;
      // Identity-shaped body keys are rejected rather than ignored to make unsafe callers obvious.
      if ('webId' in record || 'callerId' in record || 'userId' in record) {
        return res.status(400).json({ error: 'identity-from-session-only' });
      }
      const callerId = await options.resolveWebId(req);
      if (typeof callerId !== 'string' || !callerId.trim()) {
        return res.status(401).json({ error: 'authentication-required' });
      }
      const roomId = typeof record.roomId === 'string' ? record.roomId : '';
      const eventId = typeof record.eventId === 'string' ? record.eventId : '';
      const action = record.action;
      const reason = typeof record.reason === 'string' ? record.reason.slice(0, 500) : undefined;
      if (!roomId || !eventId) {
        return res.status(400).json({ error: 'roomId-and-eventId-required' });
      }
      if (action !== 'redact') {
        return res.status(400).json({ error: 'unsupported-action' });
      }
      const decision = await options.authorize({ callerId, roomId, eventId, action });
      if (!decision.allowed) {
        return res.status(decision.status ?? 403).json({ error: decision.error ?? 'forbidden' });
      }
      await options.redact({ callerId, roomId, eventId, reason });
      return res.status(200).json({ ok: true });
    } catch (error) {
      return res.status(502).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
