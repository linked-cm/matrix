import type {
  MatrixSessionRequest,
  MatrixSessionResponse,
  WebIdFromRequest,
} from './routes.js';

export const DEFAULT_MATRIX_ACTOR_FIELD = 'cm.linked.actor';

export interface MatrixLogicalActor {
  /** Stable application identity (normally an MXID resolved from the verified WebID). */
  id: string;
  name?: string;
}

export interface MatrixOutboundEvent {
  callerId: string;
  actor: MatrixLogicalActor;
  roomId: string;
  eventType: string;
  content: Record<string, unknown>;
  transactionId?: string;
}

export interface MatrixEnforcementDecision {
  allowed: boolean;
  /** Silent denials return the same success envelope as dispatched events. */
  silent?: boolean;
  status?: number;
  error?: string;
  freezeAccount?: boolean;
  /** Opaque host audit data; the package never interprets or returns it. */
  metadata?: Record<string, unknown>;
}

export interface MatrixEnforcementControl {
  /** Stable identifier used in audit records and diagnostics. */
  id: string;
  evaluate(
    event: Readonly<MatrixOutboundEvent>
  ): MatrixEnforcementDecision | Promise<MatrixEnforcementDecision>;
}

export interface MatrixEnforcedSendOptions {
  /** Verified host session only. Identity is never accepted from the request body. */
  resolveWebId: WebIdFromRequest;
  /** Resolve the verified caller to the logical author stamped by the trusted relay. */
  resolveActor(
    callerId: string,
    req: MatrixSessionRequest
  ): MatrixLogicalActor | Promise<MatrixLogicalActor>;
  /** Host authorization, including proof that this is a relay-locked room. */
  authorize(
    event: Readonly<MatrixOutboundEvent>
  ): MatrixEnforcementDecision | Promise<MatrixEnforcementDecision>;
  /** One or more mandatory controls. A missing/throwing control fails closed. */
  controls: readonly MatrixEnforcementControl[];
  /** Trusted relay/appservice dispatch. Browser Matrix credentials are never used here. */
  dispatch(
    event: Readonly<MatrixOutboundEvent>
  ): { eventId: string } | Promise<{ eventId: string }>;
  /** Persist reports, restrictions, or other host policy after a denial. */
  onDenied?(
    event: Readonly<MatrixOutboundEvent>,
    decision: Readonly<MatrixEnforcementDecision>,
    controlId: string
  ): void | Promise<void>;
  actorContentField?: string;
  maxContentBytes?: number;
  syntheticEventId?: () => string;
}

export type MatrixEnforcedSendHandler = (
  req: MatrixSessionRequest,
  res: MatrixSessionResponse
) => Promise<unknown>;

export interface MatrixModeratedRoomPowerLevelOptions {
  relayUserId: string;
  memberUserIds?: readonly string[];
  administratorUserIds?: readonly string[];
  relayLevel?: number;
  memberLevel?: number;
  sendLevel?: number;
  stateLevel?: number;
}

const parsedBody = (body: unknown): unknown => {
  if (typeof body !== 'string') return body;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const identityKeys = [
  'webId',
  'callerId',
  'senderId',
  'userId',
  'mxid',
] as const;

function hasIdentityKey(record: Record<string, unknown>): boolean {
  return identityKeys.some((key) =>
    Object.prototype.hasOwnProperty.call(record, key)
  );
}

function parseEvent(
  body: unknown,
  maxContentBytes: number,
  actorContentField: string
): Omit<MatrixOutboundEvent, 'callerId' | 'actor'> | null {
  if (!isRecord(body) || hasIdentityKey(body)) return null;
  const { roomId, eventType, content, transactionId } = body;
  if (
    typeof roomId !== 'string' ||
    !roomId.startsWith('!') ||
    roomId.length > 512 ||
    typeof eventType !== 'string' ||
    !eventType.trim() ||
    eventType.length > 255 ||
    !isRecord(content) ||
    Object.prototype.hasOwnProperty.call(content, actorContentField) ||
    (transactionId !== undefined &&
      (typeof transactionId !== 'string' || transactionId.length > 255))
  ) {
    return null;
  }
  try {
    if (
      new TextEncoder().encode(JSON.stringify(content)).byteLength >
      maxContentBytes
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return {
    roomId,
    eventType,
    content,
    ...(typeof transactionId === 'string' ? { transactionId } : {}),
  };
}

function failure(error: string, status = 403): MatrixEnforcementDecision {
  return { allowed: false, status, error };
}

/**
 * Framework-neutral, fail-closed relay route for visible Matrix events.
 *
 * Non-bypassability also requires the room power levels returned by
 * `createModeratedRoomPowerLevels`: members must be unable to send message
 * events directly while the trusted relay remains able to dispatch them.
 */
export function createMatrixEnforcedSendHandler(
  options: MatrixEnforcedSendOptions
): MatrixEnforcedSendHandler {
  if (!options || typeof options.resolveWebId !== 'function') {
    throw new Error('createMatrixEnforcedSendHandler requires resolveWebId');
  }
  if (typeof options.resolveActor !== 'function') {
    throw new Error('createMatrixEnforcedSendHandler requires resolveActor');
  }
  if (
    typeof options.authorize !== 'function' ||
    typeof options.dispatch !== 'function'
  ) {
    throw new Error(
      'createMatrixEnforcedSendHandler requires authorize and dispatch'
    );
  }
  if (!Array.isArray(options.controls) || options.controls.length === 0) {
    throw new Error(
      'createMatrixEnforcedSendHandler requires at least one control'
    );
  }
  const ids = new Set<string>();
  for (const control of options.controls) {
    if (!control?.id?.trim() || typeof control.evaluate !== 'function') {
      throw new Error(
        'every Matrix enforcement control requires an id and evaluate'
      );
    }
    if (ids.has(control.id))
      throw new Error(`duplicate Matrix enforcement control: ${control.id}`);
    ids.add(control.id);
  }
  const actorContentField =
    options.actorContentField ?? DEFAULT_MATRIX_ACTOR_FIELD;
  const maxContentBytes = options.maxContentBytes ?? 64 * 1024;
  const syntheticEventId =
    options.syntheticEventId ??
    (() => `$${crypto.randomUUID().replaceAll('-', '')}:relay`);

  return async (req, res) => {
    const body = parsedBody(req?.body);
    if (isRecord(body) && hasIdentityKey(body)) {
      return res.status(400).json({ error: 'identity-from-session-only' });
    }
    const parsed = parseEvent(body, maxContentBytes, actorContentField);
    if (!parsed) return res.status(400).json({ error: 'invalid-matrix-event' });

    const callerId = await options.resolveWebId(req);
    if (typeof callerId !== 'string' || !callerId.trim()) {
      return res.status(401).json({ error: 'authentication-required' });
    }
    let actor: MatrixLogicalActor;
    try {
      actor = await options.resolveActor(callerId, req);
    } catch {
      return res.status(503).json({ error: 'matrix-identity-unavailable' });
    }
    if (!actor?.id?.trim()) {
      return res.status(503).json({ error: 'matrix-identity-unavailable' });
    }
    const event: MatrixOutboundEvent = { callerId, actor, ...parsed };

    let authorization: MatrixEnforcementDecision;
    try {
      authorization = await options.authorize(event);
    } catch {
      authorization = failure('matrix-authorization-unavailable', 503);
    }
    if (!authorization.allowed) {
      return res
        .status(authorization.status ?? 403)
        .json({ error: authorization.error ?? 'forbidden' });
    }

    for (const control of options.controls) {
      let decision: MatrixEnforcementDecision;
      try {
        decision = await control.evaluate(event);
      } catch {
        decision = failure('matrix-control-unavailable', 503);
      }
      if (decision.allowed) continue;
      try {
        await options.onDenied?.(event, decision, control.id);
      } catch {
        // Enforcement already denied the event. Audit failures never turn denial into delivery.
      }
      if (decision.silent) {
        return res.status(200).json({ event_id: syntheticEventId() });
      }
      return res
        .status(decision.status ?? 403)
        .json({ error: decision.error ?? 'event-denied' });
    }

    const relayed: MatrixOutboundEvent = {
      ...event,
      content: {
        ...event.content,
        [actorContentField]: event.actor,
      },
    };
    try {
      const result = await options.dispatch(relayed);
      if (!result?.eventId) throw new Error('missing event id');
      return res.status(200).json({ event_id: result.eventId });
    } catch {
      return res.status(502).json({ error: 'matrix-relay-unavailable' });
    }
  };
}

/**
 * Power levels for a moderated room: ordinary members can sync, receive,
 * type, and send receipts, but only the trusted relay can create visible
 * timeline events. This is the protocol-level half of the enforcement seam.
 */
export function createModeratedRoomPowerLevels(
  options: MatrixModeratedRoomPowerLevelOptions
): Record<string, unknown> {
  if (!options?.relayUserId?.trim()) {
    throw new Error('createModeratedRoomPowerLevels requires relayUserId');
  }
  const relayLevel = options.relayLevel ?? 100;
  const memberLevel = options.memberLevel ?? 0;
  const sendLevel = options.sendLevel ?? 50;
  const stateLevel = options.stateLevel ?? 100;
  if (sendLevel <= memberLevel || relayLevel < sendLevel) {
    throw new Error(
      'moderated room levels must prevent members and permit the relay'
    );
  }
  const users: Record<string, number> = { [options.relayUserId]: relayLevel };
  for (const id of options.memberUserIds ?? []) users[id] = memberLevel;
  for (const id of options.administratorUserIds ?? []) users[id] = relayLevel;
  return {
    users,
    users_default: memberLevel,
    events_default: sendLevel,
    state_default: stateLevel,
    invite: relayLevel,
    kick: relayLevel,
    ban: relayLevel,
    redact: relayLevel,
  };
}
