import { describe, expect, it } from 'vitest';
import { toThreads, typingNamesOf, type RoomSnapshot } from '../src/mapping.js';
import { NS } from './fixtures.js';

// Typing-name projection (plan 036 P4) — pure. The transport hands over the raw
// typing members; this decides WHO the indicator names (never the viewer, never
// bot puppets) and how nameless members read.

const ME = '@p_me:serve.create.now';
const BOTS = new Set(NS.botUserIds);

const TEAM = 'https://serve-community.id.create.now/id/team/rovers';
const channel = (over: Partial<RoomSnapshot>): RoomSnapshot => ({
  roomId: '!news',
  name: 'News',
  isSpace: false,
  parentId: '!space',
  encrypted: false,
  marker: { entityIri: `${TEAM}/channel/news`, tier: 'team', audience: 'all' },
  postLevel: 0,
  myLevel: 0,
  events: [],
  ...over,
});

describe('typingNamesOf', () => {
  it('excludes the VIEWER — your own composing is local state, not a notification', () => {
    const names = typingNamesOf(
      [
        { userId: ME, name: 'Me' },
        { userId: '@p_gloria:serve.create.now', name: 'Gloria' },
      ],
      ME,
      BOTS,
    );
    expect(names).toEqual(['Gloria']);
  });

  it('excludes bot puppets — Ally "typing" would be presence theater', () => {
    const names = typingNamesOf(
      [
        { userId: '@helper:chat.example.org', name: 'Ally' },
        { userId: '@p_jordan:serve.create.now', name: 'Jordan' },
      ],
      ME,
      BOTS,
    );
    expect(names).toEqual(['Jordan']);
  });

  it('no displayname → the short opaque handle, never the full MXID; long localparts truncate', () => {
    const names = typingNamesOf(
      [
        { userId: '@gloria:serve.create.now' },
        { userId: '@p_verylongidentifier:serve.create.now' },
      ],
      ME,
      BOTS,
    );
    expect(names).toEqual(['gloria', 'p_verylong…']);
  });

  it('collapses duplicate display names and skips malformed (empty-id) members', () => {
    const names = typingNamesOf(
      [
        { userId: '@a:hs', name: 'Jordan' },
        { userId: '@b:hs', name: 'Jordan' },
        { userId: '', name: 'Ghost' },
      ],
      ME,
      BOTS,
    );
    expect(names).toEqual(['Jordan']);
  });

  it('nobody typing → empty', () => {
    expect(typingNamesOf([], ME, BOTS)).toEqual([]);
  });
});

describe('toThreads typing projection', () => {
  it('carries snapshot typingNames onto MsgThread.typing; empty/absent stays absent', () => {
    const threads = toThreads([
      channel({ roomId: '!a', typingNames: ['Gloria', 'Jordan'] }),
      channel({ roomId: '!b', typingNames: [] }),
      channel({ roomId: '!c' }),
    ]);
    expect(threads.find((t) => t.id === '!a')?.typing).toEqual(['Gloria', 'Jordan']);
    expect(threads.find((t) => t.id === '!b')?.typing).toBeUndefined();
    expect(threads.find((t) => t.id === '!c')?.typing).toBeUndefined();
  });
});
