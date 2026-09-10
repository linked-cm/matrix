/**
 * Matrix → Messaging projection — PURE. Turns room snapshots (extracted from
 * matrix-js-sdk state by the transport) into the exact `Msg*` contracts
 * @_linked/messaging defines, so swapping the in-memory store for Matrix
 * changes ZERO component code. Host semantics ride the room marker the
 * appservice stamps at provisioning: bound entity, tier, audience.
 *
 * Every host-chosen name (marker type, card prefix, card content field, poll
 * event types) arrives via MatrixNamespaceConfig — nothing here is branded.
 */
import type {
  MsgAuthor,
  MsgMessage,
  MsgSpace,
  MsgThread,
  PrivacyTier,
} from '@_linked/messaging';
import { type MatrixNamespaceConfig, pollTypesFor } from './config.js';

/** Transport-extracted view of one room — plain data, no sdk objects. */
export interface RoomSnapshot {
  roomId: string;
  name: string;
  isSpace: boolean;
  parentId?: string;
  encrypted: boolean;
  marker?: { entityIri?: string; channelKey?: string; tier?: string; audience?: string };
  /** m.room.power_levels events_default (posting floor). */
  postLevel?: number;
  /** the viewer's power level in this room. */
  myLevel?: number;
  unread?: number;
  /** display names of OTHER members typing right now  — already
   *  viewer/bot-filtered via `typingNamesOf`; absent/empty = nobody. */
  typingNames?: string[];
  events: TimelineItem[];
}

export interface TimelineItem {
  id: string;
  sender: string;
  senderName?: string;
  ts: number;
  type: string;
  content: Record<string, unknown>;
}

const tierOf = (marker?: RoomSnapshot['marker']): PrivacyTier =>
  marker?.tier === 'public' || marker?.tier === 'personal'
    ? marker.tier
    : 'team';

/**
 * The channel key for a room: whatever the appservice stamped, else the trailing
 * `/channel/<key>` segment of the bound entity IRI (the convention hosts that
 * mint per-channel IRIs already follow).
 */
export const channelKeyOf = (marker?: RoomSnapshot['marker']): string | undefined =>
  marker?.channelKey || marker?.entityIri?.match(/\/channel\/([^/]+)$/)?.[1];

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

/** No displayname → short opaque handle, never the full MXID (it is unreadable
 *  and blows up narrow layouts). Shared by message authors + typing names. */
const shortHandleOf = (mxid: string): string => {
  const localpart = mxid.slice(1).split(':')[0]!;
  return localpart.length > 12 ? `${localpart.slice(0, 10)}…` : localpart;
};

/** One room member as the transport extracts it for typing (plain data, no sdk objects). */
export interface TypingMember {
  userId: string;
  name?: string;
}

/**
 * Typing members → the display names `MsgThread.typing` carries  — PURE.
 * Excludes the VIEWER (their own composing is local state, not a notification) and bot
 * puppets (Ally "typing" would be presence theater); missing displaynames fall back to
 * the same short handle message authors use; duplicate names collapse (the line reads
 * the same either way).
 */
export function typingNamesOf(
  members: TypingMember[],
  myMxid: string,
  botMxids: Set<string>,
): string[] {
  const names: string[] = [];
  for (const m of members) {
    if (!m.userId || m.userId === myMxid || botMxids.has(m.userId)) continue;
    const name = m.name || shortHandleOf(m.userId);
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** Spaces = Space-rooms (team rails) + personal rooms (Direct list). */
export function toSpaces(rooms: RoomSnapshot[]): MsgSpace[] {
  const spaces: MsgSpace[] = [];
  for (const room of rooms) {
    if (room.isSpace) {
      spaces.push({
        id: room.roomId,
        name: room.name,
        initials: initialsOf(room.name),
        tier: tierOf(room.marker),
        unread: room.unread || undefined,
      });
    } else if (tierOf(room.marker) === 'personal') {
      spaces.push({
        id: room.roomId,
        name: room.name,
        initials: initialsOf(room.name),
        tier: 'personal',
        dmKind: 'person',
        unread: room.unread || undefined,
      });
    }
  }
  return spaces;
}

/** Threads = channel rooms under their parent Space; a DM is its own thread. */
export function toThreads(rooms: RoomSnapshot[]): MsgThread[] {
  const threads: MsgThread[] = [];
  for (const room of rooms) {
    if (room.isSpace) continue;
    const tier = tierOf(room.marker);
    const isDm = tier === 'personal';
    if (!isDm && !room.parentId) continue; // unbound channel — not ours
    const postFloor = room.postLevel ?? 0;
    threads.push({
      id: room.roomId,
      spaceId: isDm ? room.roomId : room.parentId!,
      title: room.name,
      tier,
      kind: channelKeyOf(room.marker),
      // Rail sections group by family; team channels belong to the 'team'
      // section (Movement/Sister arrive with their own markers later).
      family: isDm ? undefined : 'team',
      unread: room.unread || undefined,
      readOnly: postFloor > (room.myLevel ?? 0),
      audience: room.marker?.audience === '18+' ? '18+' : undefined,
      encrypted: room.encrypted || undefined,
      typing: room.typingNames?.length ? room.typingNames : undefined,
    });
  }
  return threads;
}

const formatTs = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** m.relates_to view of an event — undefined when absent/malformed. */
const relOf = (item: TimelineItem): { rel_type?: string; event_id?: string; key?: string; replyTo?: string } | undefined => {
  const rel = item.content['m.relates_to'] as Record<string, unknown> | undefined;
  if (!rel || typeof rel !== 'object') return undefined;
  const reply = rel['m.in_reply_to'] as Record<string, unknown> | undefined;
  return {
    rel_type: typeof rel.rel_type === 'string' ? rel.rel_type : undefined,
    event_id: typeof rel.event_id === 'string' ? rel.event_id : undefined,
    key: typeof rel.key === 'string' ? rel.key : undefined,
    replyTo: reply && typeof reply.event_id === 'string' ? reply.event_id : undefined,
  };
};

/** Reply-quote excerpt: first (non-fallback) line, trimmed to a chip-sized length. */
export const excerptOf = (text: string | undefined, max = 80): string => {
  const line = stripReplyFallback(text ?? '').split('\n')[0]!.trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

/** Strip the spec's rich-reply fallback quote ("> …" lines + blank separator) from a reply body. */
export function stripReplyFallback(body: string): string {
  if (!body.startsWith('> ')) return body;
  const lines = body.split('\n');
  let i = 0;
  while (i < lines.length && lines[i]!.startsWith('>')) i += 1;
  if (i < lines.length && lines[i] === '') i += 1;
  return lines.slice(i).join('\n');
}

/** Build the spec's rich-reply fallback body so foreign clients render the quote. */
export function replyFallbackBody(originalSender: string, originalBody: string, text: string): string {
  const quoted = originalBody
    .split('\n')
    .map((line, n) => (n === 0 ? `> <${originalSender}> ${line}` : `> ${line}`))
    .join('\n');
  return `${quoted}\n\n${text}`;
}

/**
 * mxc:// → renderable http URL  — PURE string work, no sdk. Uses the
 * legacy unauthenticated media download endpoint because <img src> cannot carry an
 * Authorization header; the authenticated-media (v1.11) path needs a fetch+objectURL
 * layer and arrives with the encrypted-attachment work. Undefined for non-mxc input.
 */
export function mxcToHttp(mxc: string, homeserverUrl: string): string | undefined {
  const m = mxc.match(/^mxc:\/\/([^/]+)\/([^/?#]+)$/);
  if (!m || !homeserverUrl) return undefined;
  return `${homeserverUrl.replace(/\/+$/, '')}/_matrix/media/v3/download/${m[1]}/${m[2]}`;
}

/** m.image / m.file content → MsgMessage.media (undefined when not media or the mxc is malformed). */
export function mediaOf(
  content: Record<string, unknown>,
  homeserverUrl: string,
): MsgMessage['media'] {
  const kind =
    content.msgtype === 'm.image' ? ('image' as const) : content.msgtype === 'm.file' ? ('file' as const) : undefined;
  if (!kind || typeof content.url !== 'string') return undefined;
  const url = mxcToHttp(content.url, homeserverUrl);
  if (!url) return undefined;
  const info = (content.info && typeof content.info === 'object' ? content.info : {}) as Record<string, unknown>;
  return {
    kind,
    url,
    name: typeof content.body === 'string' && content.body ? content.body : 'attachment',
    mimeType: typeof info.mimetype === 'string' ? info.mimetype : undefined,
    size: typeof info.size === 'number' ? info.size : undefined,
    width: typeof info.w === 'number' ? info.w : undefined,
    height: typeof info.h === 'number' ? info.h : undefined,
  };
}

/** The VIEWER's own live (unredacted) m.reaction event for (target, emoji) — the one `unreact` redacts. */
export function findMyReactionEventId(
  events: TimelineItem[],
  myMxid: string,
  targetEventId: string,
  emoji: string,
): string | undefined {
  const redacted = new Set(
    events
      .filter((e) => e.type === 'm.room.redaction' && typeof e.content.redacts === 'string')
      .map((e) => e.content.redacts as string),
  );
  return events.find((e) => {
    if (e.type !== 'm.reaction' || e.sender !== myMxid || redacted.has(e.id)) return false;
    const rel = relOf(e);
    return rel?.rel_type === 'm.annotation' && rel.event_id === targetEventId && rel.key === emoji;
  })?.id;
}

// ── polls ────────────────────────────────────────────────────────────────────
// `<prefix>poll` renders as a card; `<prefix>poll.response` / `<prefix>poll.close`
// are aggregation-only vocabulary — EXCLUDED from the message stream (like reactions) and
// folded into the poll card's data projection here, client-side, from the RAW timeline by
// origin ts. Explicitly NOT the relations API: every viewer counts locally, and boundedness
// is part of the contract. Closing is ADVISORY: closes from non-authors are ignored and
// counting stops after the author's close / closesAt, but only cooperating clients honor it.

/** What the projection attaches onto a poll card's data (services/messaging/cards.ts 'poll'). */
export interface PollAggregate {
  /** per-option counted voters (every option present, zero-filled) */
  counts: Record<string, number>;
  /** the viewer's currently-counted selection */
  myOptionIds: string[];
  /** author-closed or past closesAt — advisory (cooperating clients only) */
  closed: boolean;
  /** distinct senders with a counted, non-empty response */
  totalVoters: number;
}

const pollOptionIds = (poll: TimelineItem): string[] =>
  (Array.isArray(poll.content.options) ? poll.content.options : [])
    .map((o) => (o && typeof o === 'object' && typeof (o as { id?: unknown }).id === 'string' ? (o as { id: string }).id : ''))
    .filter(Boolean);

const pollClosesAtMs = (poll: TimelineItem): number =>
  typeof poll.content.closesAt === 'string' ? Date.parse(poll.content.closesAt) : NaN;

/**
 * PURE poll aggregation over one room's raw timeline (reaction-pattern reuse).
 * Rules (plan §5, ratified):
 * - latest response per sender WINS (origin ts; equal ts → later timeline position);
 * - responses time-stamped after the AUTHOR's close or after `closesAt` are ignored entirely
 *   (they neither count nor overwrite an earlier valid vote);
 * - a close from a non-author is ignored; a response to an unknown/non-poll event is ignored;
 * - redacted responses/closes/polls are ignored;
 * - option ids are validated against the poll's own options; single mode counts the first
 *   valid pick; an empty latest response withdraws the vote (not a voter).
 * Attribution is inherent — votes are room events with senders; nothing here anonymizes.
 */
export function aggregatePolls(
  events: TimelineItem[],
  myMxid: string,
  config: Pick<MatrixNamespaceConfig, 'cardEventPrefix'>,
  now = Date.now(),
): Map<string, PollAggregate> {
  const { poll: POLL_TYPE, response: POLL_RESPONSE_TYPE, close: POLL_CLOSE_TYPE } =
    pollTypesFor(config);
  const redacted = new Set(
    events
      .filter((e) => e.type === 'm.room.redaction' && typeof e.content.redacts === 'string')
      .map((e) => e.content.redacts as string),
  );
  const byId = new Map(events.map((e) => [e.id, e]));
  const livePoll = (pollId: unknown): TimelineItem | undefined => {
    if (typeof pollId !== 'string' || redacted.has(pollId)) return undefined;
    const poll = byId.get(pollId);
    return poll && poll.type === POLL_TYPE ? poll : undefined;
  };

  // earliest AUTHOR close per poll (advisory close time)
  const closeTs = new Map<string, number>();
  for (const e of events) {
    if (e.type !== POLL_CLOSE_TYPE || redacted.has(e.id)) continue;
    const poll = livePoll(e.content.pollId);
    if (!poll || e.sender !== poll.sender) continue; // non-author close → ignored
    const prev = closeTs.get(poll.id);
    if (prev == null || e.ts < prev) closeTs.set(poll.id, e.ts);
  }

  // latest counted response per (poll, sender)
  const votes = new Map<string, Map<string, { optionIds: string[]; ts: number }>>();
  for (const e of events) {
    if (e.type !== POLL_RESPONSE_TYPE || redacted.has(e.id)) continue;
    const poll = livePoll(e.content.pollId);
    if (!poll) continue; // unknown poll → ignored
    const closedAt = closeTs.get(poll.id);
    if (closedAt != null && e.ts > closedAt) continue; // after author close → ignored
    const closesAtMs = pollClosesAtMs(poll);
    if (!isNaN(closesAtMs) && e.ts > closesAtMs) continue; // after closesAt → ignored
    const valid = new Set(pollOptionIds(poll));
    const raw = Array.isArray(e.content.optionIds)
      ? (e.content.optionIds as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    let optionIds = Array.from(new Set(raw)).filter((id) => valid.has(id));
    if (poll.content.mode !== 'multi') optionIds = optionIds.slice(0, 1);
    const perPoll = votes.get(poll.id) ?? votes.set(poll.id, new Map()).get(poll.id)!;
    const prev = perPoll.get(e.sender);
    if (!prev || e.ts >= prev.ts) perPoll.set(e.sender, { optionIds, ts: e.ts });
  }

  const out = new Map<string, PollAggregate>();
  for (const poll of events) {
    if (poll.type !== POLL_TYPE || redacted.has(poll.id)) continue;
    const counts: Record<string, number> = {};
    for (const id of pollOptionIds(poll)) counts[id] = 0;
    let totalVoters = 0;
    let myOptionIds: string[] = [];
    for (const [sender, vote] of votes.get(poll.id) ?? []) {
      if (!vote.optionIds.length) continue; // withdrawn/invalid latest response — not a voter
      totalVoters += 1;
      for (const id of vote.optionIds) counts[id] = (counts[id] ?? 0) + 1;
      if (sender === myMxid) myOptionIds = vote.optionIds;
    }
    const closesAtMs = pollClosesAtMs(poll);
    out.set(poll.id, {
      counts,
      myOptionIds,
      closed: closeTs.has(poll.id) || (!isNaN(closesAtMs) && now > closesAtMs),
      totalVoters,
    });
  }
  return out;
}

/**
 * Timeline → messages. `m.room.message` text renders as text; any event under the
 * host's card prefix, OR a card payload in the host's card content field, becomes
 * the opaque payload the UI hands to `renderCard`. Relation events aggregate onto
 * their targets: m.reaction → `reactions`/`myReactions`, m.replace → replaced text
 * + `edited`, m.in_reply_to → `replyTo`, redactions drop the message entirely.
 * Everything else (state, receipts) is skipped.
 */
export function toMessages(
  room: RoomSnapshot,
  myMxid: string,
  botMxids: Set<string>,
  config: Pick<MatrixNamespaceConfig, 'cardEventPrefix' | 'cardContentField'>,
  /** homeserver base URL for mxc → http media resolution; absent = media renders as nothing */
  homeserverUrl = '',
): MsgMessage[] {
  const { poll: POLL_TYPE, response: POLL_RESPONSE_TYPE, close: POLL_CLOSE_TYPE } =
    pollTypesFor(config);
  // ── pass 1: aggregate relation events ──
  const redacted = new Set<string>();
  const reactions = new Map<string, Map<string, Set<string>>>(); // target → emoji → senders
  const reactionEvents = new Map<string, { target: string; emoji: string; sender: string }>();
  const edits = new Map<string, TimelineItem>(); // target → latest m.replace event
  const byId = new Map<string, TimelineItem>();
  for (const item of room.events) byId.set(item.id, item);
  for (const item of room.events) {
    if (item.type === 'm.room.redaction' && typeof item.content.redacts === 'string') {
      redacted.add(item.content.redacts);
      continue;
    }
    const rel = relOf(item);
    if (item.type === 'm.reaction') {
      if (rel?.rel_type === 'm.annotation' && rel.event_id && rel.key)
        reactionEvents.set(item.id, { target: rel.event_id, emoji: rel.key, sender: item.sender });
      continue;
    }
    if (item.type === 'm.room.message' && rel?.rel_type === 'm.replace' && rel.event_id) {
      const prev = edits.get(rel.event_id);
      if (!prev || item.ts >= prev.ts) edits.set(rel.event_id, item);
    }
  }
  for (const [id, r] of reactionEvents) {
    if (redacted.has(id)) continue; // withdrawn reaction
    const perEmoji = reactions.get(r.target) ?? new Map<string, Set<string>>();
    (perEmoji.get(r.emoji) ?? perEmoji.set(r.emoji, new Set()).get(r.emoji)!).add(r.sender);
    reactions.set(r.target, perEmoji);
  }

  // Poll signals aggregate like reactions (plan 036 P3) — computed once, attached to poll cards.
  const polls = room.events.some((e) => e.type === POLL_TYPE)
    ? aggregatePolls(room.events, myMxid, config)
    : undefined;

  // ── pass 2: project renderable messages ──
  const messages: MsgMessage[] = [];
  for (const item of room.events) {
    const rel = relOf(item);
    // Poll responses/closes are aggregation-only vocabulary — NEVER messages.
    if (item.type === POLL_RESPONSE_TYPE || item.type === POLL_CLOSE_TYPE) continue;
    const isCard = item.type.startsWith(config.cardEventPrefix);
    if (item.type !== 'm.room.message' && !isCard) continue;
    if (redacted.has(item.id)) continue; // deleted — drop entirely (no tombstone)
    if (rel?.rel_type === 'm.replace') continue; // an edit renders on its target, not as its own message
    const cardData = isCard
      ? item.type === POLL_TYPE
        ? // poll card = authored content + the client-side aggregate + its own event id (vote target)
          { kind: 'poll', ...item.content, pollId: item.id, ...polls?.get(item.id) }
        : { kind: item.type.slice(config.cardEventPrefix.length), ...item.content }
      : (item.content[config.cardContentField] as Record<string, unknown> | undefined);
    // Latest live replacement wins (redacted edits fall back to the original).
    const edit = edits.get(item.id);
    const newContent =
      edit && !redacted.has(edit.id)
        ? (edit.content['m.new_content'] as Record<string, unknown> | undefined)
        : undefined;
    const rawBody =
      typeof newContent?.body === 'string'
        ? newContent.body
        : typeof item.content.body === 'string'
          ? item.content.body
          : undefined;
    const body = rawBody != null && rel?.replyTo ? stripReplyFallback(rawBody) : rawBody;
    // Attachments : m.image / m.file project to `media`; their body IS the
    // filename (Matrix convention), so it rides in media.name — never as a text bubble.
    const media = !isCard ? mediaOf(item.content, homeserverUrl) : undefined;
    if (!body && !cardData && !media) continue; // pruned/empty (locally-redacted) — drop
    const author: MsgAuthor = {
      id: item.sender,
      name: item.senderName || shortHandleOf(item.sender),
      initials: initialsOf(item.senderName || item.sender.slice(2, 4)),
      bot: botMxids.has(item.sender) || undefined,
    };
    // Reply context, resolved from the same timeline (missing target → plain message).
    const target = rel?.replyTo ? byId.get(rel.replyTo) : undefined;
    const replyTo =
      target && typeof target.content.body === 'string' && !redacted.has(target.id)
        ? {
            id: target.id,
            authorName: target.senderName || target.sender.slice(1).split(':')[0]!,
            excerpt: excerptOf(target.content.body),
          }
        : undefined;
    // Reactions aggregate per emoji; ones targeting unknown events are ignored by construction.
    const perEmoji = reactions.get(item.id);
    const reactionPairs: [string, number][] = perEmoji
      ? Array.from(perEmoji, ([emoji, senders]) => [emoji, senders.size] as [string, number])
      : [];
    const myReactions = perEmoji
      ? Array.from(perEmoji)
          .filter(([, senders]) => senders.has(myMxid))
          .map(([emoji]) => emoji)
      : [];
    messages.push({
      id: item.id,
      threadId: room.roomId,
      author,
      ts: formatTs(item.ts),
      // Card/media events carry `body` only as the foreign-client fallback —
      // the host renders the card or attachment itself, never both.
      text: media || cardData ? undefined : body,
      media,
      mine: item.sender === myMxid || undefined,
      data: cardData,
      edited: newContent ? true : undefined,
      replyTo,
      reactions: reactionPairs.length ? reactionPairs : undefined,
      myReactions: myReactions.length ? myReactions : undefined,
    });
  }
  return messages;
}
