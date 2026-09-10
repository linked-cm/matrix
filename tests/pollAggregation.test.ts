import { describe, expect, it } from 'vitest';
import { aggregatePolls, toMessages, type RoomSnapshot, type TimelineItem } from '../src/mapping.js';
import { NS, POLL } from './fixtures.js';

// Poll aggregation (reaction-pattern reuse): <prefix>poll.response / .close are
// aggregation-only vocabulary computed CLIENT-SIDE from the raw timeline by origin ts (explicitly
// NOT the relations API). Latest response per sender wins; responses after the AUTHOR's close or
// after closesAt are ignored; closes from non-authors are ignored; responses to unknown polls are
// ignored. Everything is attributed — senders are room-event facts, and the aggregate exposes only
// counts + the viewer's own selection.

const ME = '@p_me:serve.create.now';
const ANA = '@p_ana:serve.create.now';
const BEN = '@p_ben:serve.create.now';

const pollEvent = (over: Partial<TimelineItem> = {}, content: Record<string, unknown> = {}): TimelineItem => ({
  id: '$poll',
  sender: ME,
  ts: 100,
  type: POLL.poll,
  content: {
    question: 'Where Saturday?',
    options: [
      { id: 'o1', label: 'River mouth' },
      { id: 'o2', label: 'Harbor steps' },
    ],
    mode: 'single',
    body: 'Where Saturday?\n• River mouth\n• Harbor steps',
    ...content,
  },
  ...over,
});

const response = (id: string, sender: string, ts: number, optionIds: unknown, pollId = '$poll'): TimelineItem => ({
  id,
  sender,
  ts,
  type: POLL.response,
  content: { pollId, optionIds },
});

const close = (id: string, sender: string, ts: number, pollId = '$poll'): TimelineItem => ({
  id,
  sender,
  ts,
  type: POLL.close,
  content: { pollId },
});

const room = (events: TimelineItem[]): RoomSnapshot => ({
  roomId: '!r',
  name: 'Catch-All',
  isSpace: false,
  parentId: '!space',
  encrypted: false,
  marker: { entityIri: 'x/channel/catch-all', tier: 'team', audience: 'all' },
  events,
});

describe('aggregatePolls — counting', () => {
  it('counts per option, total distinct voters, and the viewer’s own selection', () => {
    const agg = aggregatePolls(
      [pollEvent(), response('$r1', ANA, 110, ['o1']), response('$r2', BEN, 120, ['o2']), response('$r3', ME, 130, ['o1'])],
      ME,
      NS,
    );
    expect(agg.get('$poll')).toEqual({
      counts: { o1: 2, o2: 1 },
      myOptionIds: ['o1'],
      closed: false,
      totalVoters: 3,
    });
  });

  it('zero-fills every option and reports an untouched poll honestly', () => {
    const agg = aggregatePolls([pollEvent()], ME, NS);
    expect(agg.get('$poll')).toEqual({ counts: { o1: 0, o2: 0 }, myOptionIds: [], closed: false, totalVoters: 0 });
  });

  it('vote switching: the latest response per sender WINS (origin ts; ties → later timeline position)', () => {
    const agg = aggregatePolls([pollEvent(), response('$r1', ANA, 110, ['o1']), response('$r2', ANA, 120, ['o2'])], ME, NS);
    expect(agg.get('$poll')!.counts).toEqual({ o1: 0, o2: 1 });
    expect(agg.get('$poll')!.totalVoters).toBe(1);
    // same-ts tie: the later timeline event wins
    const tie = aggregatePolls([pollEvent(), response('$r1', ANA, 110, ['o1']), response('$r2', ANA, 110, ['o2'])], ME, NS);
    expect(tie.get('$poll')!.counts).toEqual({ o1: 0, o2: 1 });
  });

  it('multi mode: each voter counts once per selected option; toggling off via a smaller set wins', () => {
    const agg = aggregatePolls(
      [pollEvent({}, { mode: 'multi' }), response('$r1', ANA, 110, ['o1', 'o2']), response('$r2', BEN, 120, ['o2'])],
      ME,
      NS,
    );
    expect(agg.get('$poll')).toMatchObject({ counts: { o1: 1, o2: 2 }, totalVoters: 2 });
    const toggled = aggregatePolls(
      [pollEvent({}, { mode: 'multi' }), response('$r1', ANA, 110, ['o1', 'o2']), response('$r2', ANA, 120, ['o1'])],
      ME,
      NS,
    );
    expect(toggled.get('$poll')).toMatchObject({ counts: { o1: 1, o2: 0 }, totalVoters: 1 });
  });

  it('single mode counts only the FIRST valid option of a multi-id response; unknown option ids are dropped', () => {
    const agg = aggregatePolls([pollEvent(), response('$r1', ANA, 110, ['o2', 'o1'])], ME, NS);
    expect(agg.get('$poll')!.counts).toEqual({ o1: 0, o2: 1 });
    const junk = aggregatePolls([pollEvent(), response('$r2', BEN, 120, ['nope', 'o1'])], ME, NS);
    expect(junk.get('$poll')!.counts).toEqual({ o1: 1, o2: 0 });
    // a response with ONLY unknown ids is not a voter
    const none = aggregatePolls([pollEvent(), response('$r3', BEN, 130, ['nope'])], ME, NS);
    expect(none.get('$poll')!.totalVoters).toBe(0);
  });

  it('an empty latest response withdraws the vote (retract — not a voter anymore)', () => {
    const agg = aggregatePolls([pollEvent(), response('$r1', ANA, 110, ['o1']), response('$r2', ANA, 120, [])], ME, NS);
    expect(agg.get('$poll')).toMatchObject({ counts: { o1: 0, o2: 0 }, totalVoters: 0 });
  });

  it('responses to unknown polls, to non-poll events, and malformed responses are ignored', () => {
    const text: TimelineItem = { id: '$txt', sender: ANA, ts: 90, type: 'm.room.message', content: { body: 'hi' } };
    const agg = aggregatePolls(
      [
        pollEvent(),
        text,
        response('$r1', ANA, 110, ['o1'], '$missing'), // unknown poll
        response('$r2', ANA, 111, ['o1'], '$txt'), // targets a non-poll event
        { id: '$r3', sender: ANA, ts: 112, type: POLL.response, content: { optionIds: ['o1'] } }, // no pollId
        response('$r4', ANA, 113, 'o1'), // optionIds not an array
      ],
      ME,
      NS,
    );
    expect(agg.get('$poll')).toMatchObject({ counts: { o1: 0, o2: 0 }, totalVoters: 0 });
    expect(agg.has('$missing')).toBe(false);
  });

  it('a redacted response stops counting (like a withdrawn reaction)', () => {
    const agg = aggregatePolls(
      [
        pollEvent(),
        response('$r1', ANA, 110, ['o1']),
        { id: '$x', sender: ANA, ts: 120, type: 'm.room.redaction', content: { redacts: '$r1' } },
      ],
      ME,
      NS,
    );
    expect(agg.get('$poll')).toMatchObject({ counts: { o1: 0, o2: 0 }, totalVoters: 0 });
  });
});

describe('aggregatePolls — advisory close (plan §5: convention, not enforcement)', () => {
  it('close by the AUTHOR sets closed and later responses are ignored — an earlier valid vote stands', () => {
    const agg = aggregatePolls(
      [
        pollEvent(),
        response('$r1', ANA, 110, ['o1']),
        close('$c1', ME, 150),
        response('$r2', ANA, 160, ['o2']), // late switch — ignored, o1 stands
        response('$r3', BEN, 170, ['o2']), // late new voter — ignored
      ],
      ME,
      NS,
    );
    expect(agg.get('$poll')).toEqual({ counts: { o1: 1, o2: 0 }, myOptionIds: [], closed: true, totalVoters: 1 });
  });

  it('close from a NON-author is ignored entirely — the poll stays open and late votes count', () => {
    const agg = aggregatePolls(
      [pollEvent(), close('$c1', ANA, 150), response('$r1', BEN, 160, ['o2'])],
      ME,
      NS,
    );
    expect(agg.get('$poll')).toMatchObject({ closed: false, counts: { o1: 0, o2: 1 }, totalVoters: 1 });
  });

  it('closesAt expiry: responses time-stamped after it are ignored; closed once now passes it', () => {
    const closesAt = new Date(1000).toISOString();
    const events = [pollEvent({}, { closesAt }), response('$r1', ANA, 900, ['o1']), response('$r2', BEN, 1100, ['o2'])];
    const before = aggregatePolls(events, ME, NS, 500); // "now" before expiry
    expect(before.get('$poll')).toMatchObject({ closed: false, counts: { o1: 1, o2: 0 }, totalVoters: 1 });
    const after = aggregatePolls(events, ME, NS, 2000); // "now" past expiry
    expect(after.get('$poll')).toMatchObject({ closed: true, counts: { o1: 1, o2: 0 }, totalVoters: 1 });
  });

  it('with both closesAt and an author close, the earlier boundary governs each response', () => {
    const closesAt = new Date(1000).toISOString();
    const agg = aggregatePolls(
      [
        pollEvent({}, { closesAt }),
        close('$c1', ME, 500),
        response('$r1', ANA, 400, ['o1']), // before both — counts
        response('$r2', BEN, 700, ['o2']), // after author close, before closesAt — ignored
      ],
      ME,
      NS,
      2000,
    );
    expect(agg.get('$poll')).toMatchObject({ closed: true, counts: { o1: 1, o2: 0 }, totalVoters: 1 });
  });
});

describe('toMessages — poll projection', () => {
  it('the poll renders as ONE card message; responses and closes NEVER appear in the stream', () => {
    const msgs = toMessages(
      room([pollEvent(), response('$r1', ANA, 110, ['o1']), response('$r2', ME, 120, ['o2']), close('$c1', ME, 150)]),
      ME,
      new Set(),
      NS,
    );
    expect(msgs.map((m) => m.id)).toEqual(['$poll']);
  });

  it('attaches the aggregate to the card data: counts, my selection, closed, voters, pollId', () => {
    const msgs = toMessages(
      room([pollEvent(), response('$r1', ANA, 110, ['o1']), response('$r2', ME, 120, ['o2'])]),
      ME,
      new Set(),
      NS,
    );
    expect(msgs[0]!.data).toMatchObject({
      kind: 'poll',
      pollId: '$poll',
      question: 'Where Saturday?',
      mode: 'single',
      options: [
        { id: 'o1', label: 'River mouth' },
        { id: 'o2', label: 'Harbor steps' },
      ],
      counts: { o1: 1, o2: 1 },
      myOptionIds: ['o2'],
      closed: false,
      totalVoters: 2,
    });
    expect(msgs[0]!.mine).toBe(true); // the author sees the Close control through mine
  });

  it('poll cards project text=undefined — the body is ONLY the foreign-client fallback', () => {
    const msgs = toMessages(room([pollEvent()]), ME, new Set(), NS);
    expect(msgs[0]!.text).toBeUndefined();
    expect(msgs[0]!.data).toMatchObject({ kind: 'poll' });
  });

  it('a redacted poll drops entirely — and its orphaned responses render nothing', () => {
    const msgs = toMessages(
      room([
        pollEvent(),
        response('$r1', ANA, 110, ['o1']),
        { id: '$x', sender: ME, ts: 120, type: 'm.room.redaction', content: { redacts: '$poll' } },
      ]),
      ME,
      new Set(),
      NS,
    );
    expect(msgs).toEqual([]);
  });
});
