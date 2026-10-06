import { describe, expect, it } from 'vitest';
import {
  channelKeyOf,
  excerptOf,
  findMyReactionEventId,
  replyFallbackBody,
  stripReplyFallback,
  toMessages,
  toSpaces,
  toThreads,
  type RoomSnapshot,
  type TimelineItem,
} from '../src/mapping.js';
import { NS } from './fixtures.js';

const TEAM = 'https://serve-community.id.create.now/id/team/rovers';
const ME = '@p_me:serve.create.now';
const BOTS = new Set(['@bot:chat.example.org']);

const space: RoomSnapshot = {
  roomId: '!space',
  name: 'River Rovers',
  isSpace: true,
  encrypted: false,
  marker: { entityIri: TEAM, tier: 'team', audience: 'all' },
  events: [],
};

const channel = (over: Partial<RoomSnapshot>): RoomSnapshot => ({
  roomId: '!news',
  name: 'News',
  isSpace: false,
  parentId: '!space',
  encrypted: false,
  marker: { entityIri: `${TEAM}/channel/news`, tier: 'team', audience: 'all' },
  postLevel: 50,
  myLevel: 0,
  events: [],
  ...over,
});

describe('matrix → messaging projection', () => {
  it('spaces: Space rooms become team rails; personal rooms become DMs', () => {
    const dm: RoomSnapshot = {
      roomId: '!dm',
      name: 'Gloria',
      isSpace: false,
      encrypted: true,
      marker: { entityIri: 'x', tier: 'personal', audience: 'all' },
      events: [],
    };
    const spaces = toSpaces([space, channel({}), dm]);
    expect(spaces.map((s) => s.id)).toEqual(['!space', '!dm']);
    expect(spaces[0]).toMatchObject({ tier: 'team', initials: 'RR' });
    expect(spaces[1]).toMatchObject({ tier: 'personal', dmKind: 'person' });
  });

  it('threads: coordinator-post floors make readOnly; 18+ audience carries; DM is its own thread', () => {
    const afterHours = channel({
      roomId: '!ah',
      name: 'After Hours',
      marker: { entityIri: `${TEAM}/channel/after-hours`, tier: 'team', audience: '18+' },
      postLevel: 0,
    });
    const dm: RoomSnapshot = {
      roomId: '!dm',
      name: 'Gloria',
      isSpace: false,
      encrypted: true,
      marker: { tier: 'personal' },
      events: [],
    };
    const orphan = channel({ roomId: '!orphan', parentId: undefined });
    const threads = toThreads([space, channel({}), afterHours, dm, orphan]);
    expect(threads.map((t) => t.id)).toEqual(['!news', '!ah', '!dm']);
    expect(threads[0]).toMatchObject({ kind: 'news', readOnly: true, spaceId: '!space' });
    expect(threads[1]).toMatchObject({ audience: '18+', readOnly: false });
    expect(threads[2]).toMatchObject({ spaceId: '!dm', tier: 'personal' });
    // Coordinators (level 50) CAN post in News.
    expect(toThreads([channel({ myLevel: 50 })])[0].readOnly).toBe(false);
  });

  it('threads carry a host audience key verbatim and do not special-case it', () => {
    const staff = channel({
      roomId: '!staff',
      name: 'Staff',
      marker: { entityIri: `${TEAM}/channel/staff`, tier: 'team', audience: 'staff' },
    });
    const everyone = channel({
      roomId: '!all',
      name: 'Everyone',
      marker: { entityIri: `${TEAM}/channel/all`, tier: 'team', audience: 'all' },
    });
    const blank = channel({
      roomId: '!blank',
      name: 'Blank',
      marker: { entityIri: `${TEAM}/channel/blank`, tier: 'team', audience: '' },
    });
    const threads = toThreads([space, staff, everyone, blank]);
    expect(threads.find((t) => t.id === '!staff')?.audience).toBe('staff');
    expect(threads.find((t) => t.id === '!all')?.audience).toBe('all');
    expect(threads.find((t) => t.id === '!blank')?.audience).toBeUndefined();
  });

  it('messages: text, mine-flag, bot flag, and m.serve.* card extraction', () => {
    const room = channel({
      events: [
        { id: '$1', sender: ME, ts: 1, type: 'm.room.message', content: { msgtype: 'm.text', body: 'hi' } },
        {
          id: '$2',
          sender: '@bot:chat.example.org',
          senderName: 'Serve',
          ts: 2,
          type: `${NS.cardEventPrefix}opportunity`,
          content: { missionId: 'm1', body: 'River cleanup — RSVP' },
        },
        {
          id: '$3',
          sender: '@p_x:serve.create.now',
          ts: 3,
          type: 'm.room.message',
          content: { msgtype: 'm.text', body: 'card next', [NS.cardContentField]: { kind: 'rsvp' } },
        },
        { id: '$4', sender: '@p_x:serve.create.now', ts: 4, type: 'm.room.member', content: { membership: 'join' } },
      ],
    });
    const msgs = toMessages(room, ME, BOTS, NS);
    expect(msgs.map((m) => m.id)).toEqual(['$1', '$2', '$3']);
    expect(msgs[0]).toMatchObject({ mine: true, text: 'hi' });
    expect(msgs[1].author.bot).toBe(true);
    expect(msgs[1].data).toMatchObject({ kind: 'opportunity', missionId: 'm1' });
    expect(msgs[2].data).toMatchObject({ kind: 'rsvp' });
  });

  it('channelKeyOf parses the WP24 key from the marker IRI', () => {
    expect(channelKeyOf({ entityIri: `${TEAM}/channel/catch-all` })).toBe('catch-all');
    expect(channelKeyOf({ entityIri: TEAM })).toBeUndefined();
    expect(channelKeyOf(undefined)).toBeUndefined();
  });
});

// ── plan 002 M4: conversation-feature aggregation (reactions / replies / edits / redactions) ──

const text = (id: string, sender: string, ts: number, body: string, extra: Record<string, unknown> = {}): TimelineItem => ({
  id,
  sender,
  ts,
  type: 'm.room.message',
  content: { msgtype: 'm.text', body, ...extra },
});

const reaction = (id: string, sender: string, ts: number, target: string, key: string): TimelineItem => ({
  id,
  sender,
  ts,
  type: 'm.reaction',
  content: { 'm.relates_to': { rel_type: 'm.annotation', event_id: target, key } },
});

describe('matrix → messaging M4 aggregation', () => {
  it('reactions aggregate per emoji with counts and the VIEWER toggle state', () => {
    const room = channel({
      events: [
        text('$msg', '@p_x:serve.create.now', 1, 'hello'),
        reaction('$r1', ME, 2, '$msg', '🙌'),
        reaction('$r2', '@p_x:serve.create.now', 3, '$msg', '🙌'),
        reaction('$r3', '@p_y:serve.create.now', 4, '$msg', '❤️'),
      ],
    });
    const [msg] = toMessages(room, ME, BOTS, NS);
    expect(msg!.reactions).toEqual([
      ['🙌', 2],
      ['❤️', 1],
    ]);
    expect(msg!.myReactions).toEqual(['🙌']);
  });

  it('a redacted (withdrawn) reaction no longer counts; duplicate same-sender reactions count once', () => {
    const room = channel({
      events: [
        text('$msg', '@p_x:serve.create.now', 1, 'hello'),
        reaction('$r1', ME, 2, '$msg', '🙌'),
        reaction('$dupe', ME, 3, '$msg', '🙌'),
        reaction('$r2', '@p_x:serve.create.now', 4, '$msg', '👍'),
        { id: '$rdact', sender: '@p_x:serve.create.now', ts: 5, type: 'm.room.redaction', content: { redacts: '$r2' } },
      ],
    });
    const [msg] = toMessages(room, ME, BOTS, NS);
    expect(msg!.reactions).toEqual([['🙌', 1]]);
    expect(msg!.myReactions).toEqual(['🙌']);
  });

  it('reactions targeting unknown events are ignored; reaction events never render as messages', () => {
    const room = channel({
      events: [
        text('$msg', '@p_x:serve.create.now', 1, 'hello'),
        reaction('$r1', ME, 2, '$gone', '🎉'),
      ],
    });
    const msgs = toMessages(room, ME, BOTS, NS);
    expect(msgs.map((m) => m.id)).toEqual(['$msg']);
    expect(msgs[0]!.reactions).toBeUndefined();
    expect(msgs[0]!.myReactions).toBeUndefined();
  });

  it('edits: the LATEST m.replace wins, marks edited, and never renders as its own message', () => {
    const room = channel({
      events: [
        text('$msg', ME, 1, 'helo'),
        text('$e1', ME, 2, '* hello', {
          'm.new_content': { msgtype: 'm.text', body: 'hello' },
          'm.relates_to': { rel_type: 'm.replace', event_id: '$msg' },
        }),
        text('$e2', ME, 3, '* hello there', {
          'm.new_content': { msgtype: 'm.text', body: 'hello there' },
          'm.relates_to': { rel_type: 'm.replace', event_id: '$msg' },
        }),
      ],
    });
    const msgs = toMessages(room, ME, BOTS, NS);
    expect(msgs.map((m) => m.id)).toEqual(['$msg']);
    expect(msgs[0]).toMatchObject({ text: 'hello there', edited: true, mine: true });
  });

  it('a redacted edit falls back to the original text (not the withdrawn replacement)', () => {
    const room = channel({
      events: [
        text('$msg', ME, 1, 'original'),
        text('$e1', ME, 2, '* oops', {
          'm.new_content': { msgtype: 'm.text', body: 'oops' },
          'm.relates_to': { rel_type: 'm.replace', event_id: '$msg' },
        }),
        { id: '$rd', sender: ME, ts: 3, type: 'm.room.redaction', content: { redacts: '$e1' } },
      ],
    });
    expect(toMessages(room, ME, BOTS, NS)[0]).toMatchObject({ text: 'original' });
    expect(toMessages(room, ME, BOTS, NS)[0]!.edited).toBeUndefined();
  });

  it('redaction DROPS the message entirely (no tombstone); locally-pruned empty content drops too', () => {
    const room = channel({
      events: [
        text('$keep', '@p_x:serve.create.now', 1, 'still here'),
        text('$gone', '@p_x:serve.create.now', 2, 'delete me'),
        { id: '$rd', sender: '@p_x:serve.create.now', ts: 3, type: 'm.room.redaction', content: { redacts: '$gone' } },
        { id: '$pruned', sender: '@p_x:serve.create.now', ts: 4, type: 'm.room.message', content: {} },
      ],
    });
    expect(toMessages(room, ME, BOTS, NS).map((m) => m.id)).toEqual(['$keep']);
  });

  it('replies resolve replyTo from the timeline and strip the rich-reply fallback quote', () => {
    const room = channel({
      events: [
        text('$orig', '@p_x:serve.create.now', 1, 'Who brings gloves?'),
        {
          ...text('$reply', ME, 2, '> <@p_x:serve.create.now> Who brings gloves?\n\nI do!'),
          senderName: undefined,
          content: {
            msgtype: 'm.text',
            body: '> <@p_x:serve.create.now> Who brings gloves?\n\nI do!',
            'm.relates_to': { 'm.in_reply_to': { event_id: '$orig' } },
          },
        },
      ],
    });
    const msgs = toMessages(room, ME, BOTS, NS);
    expect(msgs[1]).toMatchObject({
      text: 'I do!',
      replyTo: { id: '$orig', authorName: 'p_x', excerpt: 'Who brings gloves?' },
    });
  });

  it('a reply whose target is missing or redacted renders as a plain message', () => {
    const room = channel({
      events: [
        text('$target', '@p_x:serve.create.now', 1, 'secret'),
        { id: '$rd', sender: '@p_x:serve.create.now', ts: 2, type: 'm.room.redaction', content: { redacts: '$target' } },
        text('$r1', ME, 3, 'to the void', { 'm.relates_to': { 'm.in_reply_to': { event_id: '$missing' } } }),
        text('$r2', ME, 4, 'to the redacted', { 'm.relates_to': { 'm.in_reply_to': { event_id: '$target' } } }),
      ],
    });
    const msgs = toMessages(room, ME, BOTS, NS);
    expect(msgs.map((m) => m.id)).toEqual(['$r1', '$r2']);
    expect(msgs[0]!.replyTo).toBeUndefined();
    expect(msgs[1]!.replyTo).toBeUndefined();
  });

  it('findMyReactionEventId finds the viewer’s LIVE reaction for (target, emoji) only', () => {
    const events = [
      text('$msg', '@p_x:serve.create.now', 1, 'hello'),
      reaction('$mine', ME, 2, '$msg', '🙌'),
      reaction('$theirs', '@p_x:serve.create.now', 3, '$msg', '🙌'),
      reaction('$withdrawn', ME, 4, '$msg', '❤️'),
      { id: '$rd', sender: ME, ts: 5, type: 'm.room.redaction', content: { redacts: '$withdrawn' } } as TimelineItem,
    ];
    expect(findMyReactionEventId(events, ME, '$msg', '🙌')).toBe('$mine');
    expect(findMyReactionEventId(events, ME, '$msg', '❤️')).toBeUndefined();
    expect(findMyReactionEventId(events, ME, '$msg', '🎉')).toBeUndefined();
  });

  it('reply fallback body round-trips: build per spec, strip on read, excerpt trims', () => {
    const body = replyFallbackBody('@p_x:serve.create.now', 'line one\nline two', 'my reply');
    expect(body).toBe('> <@p_x:serve.create.now> line one\n> line two\n\nmy reply');
    expect(stripReplyFallback(body)).toBe('my reply');
    expect(stripReplyFallback('no quote')).toBe('no quote');
    expect(excerptOf('x'.repeat(100))).toHaveLength(80);
    expect(excerptOf('short\nsecond line')).toBe('short');
  });
});
