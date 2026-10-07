/**
 * Matrix transport behind the `Messaging` seam — CLIENT-ONLY. Wraps a
 * matrix-js-sdk client: every sync/timeline tick re-extracts plain RoomSnapshots,
 * the pure mapping projects them into the Msg* contracts, and `version` bumps for
 * useSyncExternalStore. UI code is untouched — MessageClient renders this exactly
 * like the in-memory store.
 *
 * E2EE: rust-crypto is initialized when available so encrypted rooms decrypt.
 * Failures degrade to unencrypted rooms only — never a hard crash.
 */
import type {
  Messaging,
  MsgMessage,
  MsgSpace,
  MsgThread,
} from '@linked.cm/messaging';
import {
  findMyReactionEventId,
  replyFallbackBody,
  toMessages,
  toSpaces,
  toThreads,
  typingNamesOf,
  type RoomSnapshot,
  type TimelineItem,
} from './mapping.js';
import {
  createTypingThrottle,
  shouldMarkRead,
  TYPING_SERVER_TIMEOUT_MS,
} from './presence.js';
import {
  type MatrixNamespaceConfig,
  resolveMatrixNamespace,
} from './config.js';
import {
  assertMatrixEnforcement,
  type MatrixEnforcementRequirement,
  type MatrixEnforcementSession,
} from './enforcement.js';

export interface MatrixSessionInfo {
  webId: string;
  mxid: string;
  accessToken: string;
  deviceId: string;
  homeserverUrl: string;
  enforcement?: MatrixEnforcementSession;
}

/**
 * Ask the host's session route for this browser's Matrix session.
 *
 * The body is `{ name }` only — a cosmetic display name — and the cookie
 * session travels with `credentials: 'same-origin'`. This function never
 * sends a WebID. Who is signed in is the server's decision
 * (`createMatrixSessionHandler` + the host's `resolveWebId`).
 *
 * The route path is a host choice; it defaults to the one
 * `registerMatrixRoutes` mounts.
 */
/** Host credentials for the session request (e.g. a bearer token on mobile). Never identity in the body. */
export type MatrixSessionHeaders =
  | Record<string, string>
  | (() => Record<string, string> | Promise<Record<string, string>>);

export interface MatrixMessagingOptions {
  /** Refuse to start unless the server attests a mandatory relay policy. */
  requireEnforcement?: boolean | MatrixEnforcementRequirement;
  /** Verified host-session headers for the enforced send route. */
  enforcementHeaders?: MatrixSessionHeaders;
  enforcementCredentials?: RequestCredentials;
}

export interface FetchMatrixSessionOptions {
  name?: string;
  sessionRoute?: string;
  /** Extra request headers, or a function returning them, so the host's session reaches its route. */
  headers?: MatrixSessionHeaders;
  /** Defaults to `'same-origin'`; a native shell calling another origin may need `'include'`. */
  credentials?: RequestCredentials;
}

export async function fetchMatrixSession(
  options?: FetchMatrixSessionOptions
): Promise<MatrixSessionInfo> {
  const opts = options && typeof options === 'object' ? options : {};
  const sessionRoute =
    typeof opts.sessionRoute === 'string' && opts.sessionRoute.length > 0
      ? opts.sessionRoute
      : '/api/matrix/session';
  // Build the body field-by-field. Never copy `options` through: a smuggled
  // `webId` must not leave the browser.
  const payload: { name?: string } = {};
  if (typeof opts.name === 'string') payload.name = opts.name;
  const extra =
    typeof opts.headers === 'function'
      ? await opts.headers()
      : (opts.headers ?? {});
  const res = await fetch(sessionRoute, {
    method: 'POST',
    headers: { ...extra, 'Content-Type': 'application/json' },
    credentials: opts.credentials ?? 'same-origin',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as any)?.error || `matrix session failed (${res.status})`
    );
  }
  return res.json();
}

function snapshotRoom(
  room: any,
  myMxid: string,
  config: MatrixNamespaceConfig,
  bots: Set<string>
): RoomSnapshot {
  const state = room.currentState;
  const get = (type: string, key = '') => state?.getStateEvents?.(type, key);
  const marker = get(config.roomMarkerType)?.getContent?.();
  const createType = get('m.room.create')?.getContent?.()?.type;
  const parent = state
    ?.getStateEvents?.('m.space.parent')?.[0]
    ?.getStateKey?.();
  const power = get('m.room.power_levels')?.getContent?.();
  const events: TimelineItem[] = (
    room.getLiveTimeline?.()?.getEvents?.() ?? []
  ).map((ev: any): TimelineItem => {
    const transportSender = ev.getSender?.() ?? '';
    const content = {
      ...(ev.getContent?.() ?? {}),
      ...(ev.event?.redacts ? { redacts: ev.event.redacts } : {}),
    };
    const stampedActor = bots.has(transportSender)
      ? (content[config.actorContentField] as unknown)
      : undefined;
    const actor =
      stampedActor &&
      typeof stampedActor === 'object' &&
      !Array.isArray(stampedActor) &&
      typeof (stampedActor as { id?: unknown }).id === 'string'
        ? (stampedActor as { id: string; name?: unknown })
        : undefined;
    const sender = actor?.id ?? transportSender;
    return {
      id: ev.getId?.() ?? '',
      sender,
      senderName:
        typeof actor?.name === 'string'
          ? actor.name
          : room.getMember?.(sender)?.name,
      ts: ev.getTs?.() ?? 0,
      type: ev.getType?.() ?? '',
      content,
    };
  });
  // Typing: matrix-js-sdk keeps `member.typing` current from m.typing EDUs; the
  // pure mapping filters the viewer/bots and resolves display names.
  const typingNames = typingNamesOf(
    (room.getMembers?.() ?? [])
      .filter((m: any) => m?.typing === true)
      .map((m: any) => ({ userId: m.userId ?? '', name: m.name })),
    myMxid,
    bots
  );
  return {
    roomId: room.roomId,
    name: room.name ?? room.roomId,
    isSpace: createType === 'm.space',
    parentId: parent,
    encrypted: !!get('m.room.encryption'),
    marker,
    postLevel: power?.events_default,
    myLevel: power?.users?.[myMxid] ?? power?.users_default ?? 0,
    unread: room.getUnreadNotificationCount?.() || undefined,
    typingNames: typingNames.length ? typingNames : undefined,
    events,
  };
}

/**
 * Create the live transport. Dynamic-imports matrix-js-sdk so SSR and non-chat
 * surfaces never pay for it. `config` carries every host-chosen Matrix name; only
 * `serverName` is required.
 */
export async function createMatrixMessaging(
  session: MatrixSessionInfo,
  namespace: Partial<MatrixNamespaceConfig> &
    Pick<MatrixNamespaceConfig, 'serverName'>,
  options: MatrixMessagingOptions = {}
): Promise<Messaging & { stop(): void }> {
  assertMatrixEnforcement(session, options.requireEnforcement);
  const config = resolveMatrixNamespace(namespace);
  const bots = new Set(config.botUserIds);
  const sdk = await import('matrix-js-sdk');
  // Fail FAST and loudly when the homeserver is unreachable from THIS
  // browser: matrix-js-sdk's startClient never rejects on sync failure, which
  // previously produced a "live" transport with zero rooms (empty chat).
  const probe = await fetch(
    `${session.homeserverUrl}/_matrix/client/versions`,
    {
      signal: AbortSignal.timeout(8000),
    }
  );
  if (!probe.ok) throw new Error(`homeserver unreachable: ${probe.status}`);
  const client = sdk.createClient({
    baseUrl: session.homeserverUrl,
    accessToken: session.accessToken,
    userId: session.mxid,
    deviceId: session.deviceId,
  });
  try {
    await (client as any).initRustCrypto?.();
  } catch (cause) {
    console.warn(
      '[matrix] crypto unavailable — encrypted rooms stay closed:',
      cause
    );
  }

  let v = 0;
  let spaces: MsgSpace[] = [];
  let threads: MsgThread[] = [];
  let messagesByThread = new Map<string, MsgMessage[]>();
  let snapshotsById = new Map<string, RoomSnapshot>();
  const localEchoesByThread = new Map<string, TimelineItem[]>();
  const listeners = new Set<() => void>();

  const reproject = () => {
    const rooms: RoomSnapshot[] = client
      .getRooms()
      .map((room: any) => snapshotRoom(room, session.mxid, config, bots));
    for (const room of rooms) {
      const serverEventIds = new Set(room.events.map((event) => event.id));
      const echoes = (localEchoesByThread.get(room.roomId) ?? []).filter(
        (event) => !serverEventIds.has(event.id)
      );
      if (echoes.length) {
        room.events = [...room.events, ...echoes];
        localEchoesByThread.set(room.roomId, echoes);
      } else {
        localEchoesByThread.delete(room.roomId);
      }
    }
    snapshotsById = new Map(rooms.map((r) => [r.roomId, r]));
    spaces = toSpaces(rooms);
    threads = toThreads(rooms);
    messagesByThread = new Map(
      rooms
        .filter((r) => !r.isSpace)
        .map((r) => [
          r.roomId,
          toMessages(r, session.mxid, bots, config, session.homeserverUrl),
        ])
    );
    v += 1;
    listeners.forEach((fn) => fn());
  };

  client.on('sync' as any, reproject);
  client.on('Room.timeline' as any, reproject);
  client.on('Room.redaction' as any, reproject);
  client.on('Room.name' as any, reproject);
  client.on('RoomState.events' as any, reproject);
  // Live signals : member typing flips + receipt updates (ours echoed back
  // recomputes getUnreadNotificationCount) must reproject like timeline ticks.
  client.on('RoomMember.typing' as any, reproject);
  client.on('Room.receipt' as any, reproject);
  await client.startClient({ initialSyncLimit: 30 });

  // Typing throttle + receipt guard state  — pure decisions, per-transport.
  const typingThrottle = createTypingThrottle();
  const ackedEventByThread = new Map<string, string>();

  const relayVisibleEvent = async (
    threadId: string,
    eventType: string,
    content: Record<string, unknown>
  ): Promise<void> => {
    const enforcement = session.enforcement;
    if (!enforcement) {
      await client.sendEvent(threadId as any, eventType as any, content as any);
      return;
    }
    const room = snapshotsById.get(threadId);
    if (
      !room ||
      typeof room.myLevel !== 'number' ||
      typeof room.postLevel !== 'number' ||
      room.myLevel >= room.postLevel
    ) {
      throw new Error('matrix room is not relay-locked');
    }
    const headers =
      typeof options.enforcementHeaders === 'function'
        ? await options.enforcementHeaders()
        : (options.enforcementHeaders ?? {});
    const response = await fetch(enforcement.sendRoute, {
      method: 'POST',
      credentials: options.enforcementCredentials ?? 'same-origin',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: threadId,
        eventType,
        content,
        transactionId: crypto.randomUUID(),
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(
        (body as { error?: string }).error ??
          `matrix relay failed (${response.status})`
      );
    }
    const result = (await response.json().catch(() => ({}))) as {
      event_id?: unknown;
    };
    if (typeof result.event_id !== 'string' || !result.event_id) {
      throw new Error('matrix relay returned no event id');
    }
    const echoes = localEchoesByThread.get(threadId) ?? [];
    echoes.push({
      id: result.event_id,
      sender: session.mxid,
      ts: Date.now(),
      type: eventType,
      content,
    });
    localEchoesByThread.set(threadId, echoes);
    reproject();
  };

  return {
    spaces: () => spaces,
    threads: (spaceId) => threads.filter((t) => t.spaceId === spaceId),
    messages: (threadId) => messagesByThread.get(threadId) ?? [],
    send: (threadId, text) => {
      relayVisibleEvent(threadId, 'm.room.message', {
        msgtype: 'm.text',
        body: text,
      }).catch((cause: unknown) =>
        console.warn('[matrix] send failed:', cause)
      );
    },
    // Cards ride custom event types (`<prefix><kind>`); `body` keeps a plain-text
    // fallback so foreign Matrix clients render SOMETHING.
    sendData: (threadId, data, fallbackText) => {
      const kind =
        data &&
        typeof data === 'object' &&
        typeof (data as any).kind === 'string'
          ? (data as any).kind
          : 'card';
      const { kind: _k, ...rest } = (data ?? {}) as Record<string, unknown>;
      relayVisibleEvent(threadId, `${config.cardEventPrefix}${kind}`, {
        ...rest,
        body: fallbackText ?? (rest.title as string) ?? 'Card',
      }).catch((cause: unknown) =>
        console.warn('[matrix] card send failed:', cause)
      );
    },
    // Body-less signal events (e.g. poll responses/closes). Exactly the given content, NO
    // fallback body: foreign clients must render nothing (a "pollId/optionIds" text bubble
    // would be noise), and the projection excludes these types from the message stream —
    // they exist only for the client-side aggregation.
    sendSignal: (threadId, type, content) => {
      relayVisibleEvent(threadId, type, content).catch((cause: unknown) =>
        console.warn('[matrix] signal send failed:', cause)
      );
    },
    // Attachments  — upload to the media repo, then m.image / m.file with
    // metadata. UNENCRYPTED ROOMS ONLY: matrix-js-sdk does not auto-encrypt attachments
    // (that needs the encrypt-attachment path, a later phase) — posting a plaintext mxc
    // into an E2EE room would silently break the room's confidentiality promise, so we
    // refuse. Skill gating (skills/*.available) prevents reaching this; the guard is
    // defense-in-depth for any future non-skill caller.
    sendMedia: (threadId, upload) => {
      if (snapshotsById.get(threadId)?.encrypted) {
        console.warn(
          '[matrix] media into encrypted rooms is not supported yet — dropped'
        );
        return;
      }
      client
        .uploadContent(upload.blob as any, { type: upload.mimeType } as any)
        .then(({ content_uri }: { content_uri: string }) =>
          relayVisibleEvent(threadId, 'm.room.message', {
            msgtype: upload.kind === 'image' ? 'm.image' : 'm.file',
            body: upload.name,
            url: content_uri,
            info: {
              mimetype: upload.mimeType,
              size: upload.blob.size,
              ...(upload.width != null ? { w: upload.width } : {}),
              ...(upload.height != null ? { h: upload.height } : {}),
            },
          })
        )
        .catch((cause: unknown) =>
          console.warn('[matrix] media send failed:', cause)
        );
    },
    // ── conversation features  — native Matrix relations ──
    react: (threadId, eventId, emoji) => {
      relayVisibleEvent(threadId, 'm.reaction', {
        'm.relates_to': {
          rel_type: 'm.annotation',
          event_id: eventId,
          key: emoji,
        },
      }).catch((cause: unknown) =>
        console.warn('[matrix] react failed:', cause)
      );
    },
    unreact: (threadId, eventId, emoji) => {
      const events = snapshotsById.get(threadId)?.events ?? [];
      const mine = findMyReactionEventId(events, session.mxid, eventId, emoji);
      if (!mine) return;
      (session.enforcement
        ? relayVisibleEvent(threadId, 'm.room.redaction', { redacts: mine })
        : client.redactEvent(threadId as any, mine as any)
      ).catch((cause: unknown) =>
        console.warn('[matrix] unreact failed:', cause)
      );
    },
    sendReply: (threadId, text, inReplyToEventId) => {
      const target = snapshotsById
        .get(threadId)
        ?.events.find((e) => e.id === inReplyToEventId);
      const originalBody =
        typeof target?.content.body === 'string' ? target.content.body : '';
      relayVisibleEvent(threadId, 'm.room.message', {
        msgtype: 'm.text',
        // Rich-reply fallback body per spec, so foreign clients render the quote.
        body: target
          ? replyFallbackBody(target.sender, originalBody, text)
          : text,
        'm.relates_to': { 'm.in_reply_to': { event_id: inReplyToEventId } },
      }).catch((cause: unknown) =>
        console.warn('[matrix] reply failed:', cause)
      );
    },
    edit: (threadId, eventId, newText) => {
      relayVisibleEvent(threadId, 'm.room.message', {
        msgtype: 'm.text',
        body: `* ${newText}`, // legacy-client fallback per spec
        'm.new_content': { msgtype: 'm.text', body: newText },
        'm.relates_to': { rel_type: 'm.replace', event_id: eventId },
      }).catch((cause: unknown) =>
        console.warn('[matrix] edit failed:', cause)
      );
    },
    remove: (threadId, eventId) => {
      (session.enforcement
        ? relayVisibleEvent(threadId, 'm.room.redaction', { redacts: eventId })
        : client.redactEvent(threadId as any, eventId as any)
      ).catch((cause: unknown) =>
        console.warn('[matrix] delete failed:', cause)
      );
    },
    // Matrix-native abuse reporting reaches the homeserver operator. It does not replace
    // a host's durable report/moderation queue; MessageClient can call both.
    report: async (
      threadId: string,
      eventId: string,
      report: { reason: string; score?: number }
    ) => {
      await client.reportEvent(
        threadId,
        eventId,
        report.score ?? -100,
        report.reason
      );
    },
    // Matrix ignored-users is one-way and account-scoped. Keep the seam honest: this is
    // exposed as ignoreAuthor, never as a bilateral product-level block.
    ignoreAuthor: async (authorId: string) => {
      const ignored = client.getIgnoredUsers?.() ?? [];
      if (ignored.includes(authorId)) return;
      await client.setIgnoredUsers([...ignored, authorId]);
      reproject();
    },
    unignoreAuthor: async (authorId: string) => {
      const ignored = client.getIgnoredUsers?.() ?? [];
      if (!ignored.includes(authorId)) return;
      await client.setIgnoredUsers(
        ignored.filter((id: string) => id !== authorId)
      );
      reproject();
    },
    // ── live signals  — typing + read receipts, natively Matrix ──
    // The UI fires this on every keystroke; the pure throttle collapses that to at most
    // one `true` per TYPING_REFRESH_MS (refreshing the server's 6s notice) and only
    // meaningful `false`s (send/blur/cleared draft while a notice is outstanding).
    setTyping: (threadId, typing) => {
      if (!typingThrottle.shouldSend(threadId, typing, Date.now())) return;
      client
        .sendTyping(threadId as any, typing, TYPING_SERVER_TIMEOUT_MS)
        .catch((cause: unknown) =>
          console.warn('[matrix] typing failed:', cause)
        );
    },
    // Receipt on the room's LATEST event, guarded so re-fires from render effects are
    // no-ops until something newer arrives (no receipt→sync→version→receipt loop). The
    // local notification count zeroes optimistically — the badge clears the moment the
    // viewer looks, without waiting a sync round-trip; the server echo then confirms.
    markRead: (threadId) => {
      const room: any = client.getRoom?.(threadId);
      const events: any[] = room?.getLiveTimeline?.()?.getEvents?.() ?? [];
      const latest = events[events.length - 1];
      const latestId: string | undefined = latest?.getId?.();
      if (!shouldMarkRead(latestId, ackedEventByThread.get(threadId))) return;
      ackedEventByThread.set(threadId, latestId!);
      client
        .sendReadReceipt(latest)
        .catch((cause: unknown) =>
          console.warn('[matrix] read receipt failed:', cause)
        );
      try {
        room?.setUnreadNotificationCount?.('total' as any, 0);
        room?.setUnreadNotificationCount?.('highlight' as any, 0);
      } catch {
        /* older sdk shapes — the next sync clears it instead */
      }
      reproject();
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    version: () => v,
    // Topology changes (DM/space creation) go through server routes, not
    // client mutation — reprojection picks the new room up from sync.
    mutate: (fn) => {
      fn();
      reproject();
    },
    stop: () => {
      client.removeAllListeners();
      client.stopClient();
    },
  } as Messaging & { stop(): void };
}
