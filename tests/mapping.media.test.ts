import { describe, expect, it } from 'vitest';
import { mediaOf, mxcToHttp, toMessages, type RoomSnapshot, type TimelineItem } from '../src/mapping.js';
import { NS } from './fixtures.js';

// Plan 036 P1 — m.image / m.file timeline events project to MsgMessage.media with the mxc
// resolved to a renderable http URL. Pure projection; the homeserver base rides in as a plain
// string (never the sdk).

const HS = 'http://127.0.0.1:4148';
const ME = '@p_me:serve.create.now';
const BOTS = new Set<string>();

const room = (events: TimelineItem[]): RoomSnapshot => ({
  roomId: '!ah',
  name: 'After Hours',
  isSpace: false,
  parentId: '!space',
  encrypted: false,
  marker: { entityIri: 'x/channel/after-hours', tier: 'team', audience: '18+' },
  events,
});

const imageEvent = (over: Partial<TimelineItem> = {}): TimelineItem => ({
  id: '$img',
  sender: '@p_gloria:serve.create.now',
  senderName: 'Gloria',
  ts: 1720000000000,
  type: 'm.room.message',
  content: {
    msgtype: 'm.image',
    body: 'river-cleanup.jpg',
    url: 'mxc://serve.create.now/abc123',
    info: { mimetype: 'image/jpeg', size: 48211, w: 2048, h: 1365 },
  },
  ...over,
});

describe('mxc → http resolution', () => {
  it('resolves an mxc to the media download endpoint on the given homeserver', () => {
    expect(mxcToHttp('mxc://serve.create.now/abc123', HS)).toBe(
      `${HS}/_matrix/media/v3/download/serve.create.now/abc123`,
    );
  });

  it('tolerates a trailing slash on the homeserver URL', () => {
    expect(mxcToHttp('mxc://hs/x', `${HS}/`)).toBe(`${HS}/_matrix/media/v3/download/hs/x`);
  });

  it('refuses non-mxc input and a missing homeserver (no accidental remote fetches)', () => {
    expect(mxcToHttp('https://evil.example/x.jpg', HS)).toBeUndefined();
    expect(mxcToHttp('mxc://only-server', HS)).toBeUndefined();
    expect(mxcToHttp('mxc://hs/x', '')).toBeUndefined();
  });
});

describe('media projection (m.image / m.file → MsgMessage.media)', () => {
  it('m.image becomes an image attachment: resolved url + name/mime/size/dimensions, NO text bubble', () => {
    const msgs = toMessages(room([imageEvent()]), ME, BOTS, NS, HS);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.media).toEqual({
      kind: 'image',
      url: `${HS}/_matrix/media/v3/download/serve.create.now/abc123`,
      name: 'river-cleanup.jpg',
      mimeType: 'image/jpeg',
      size: 48211,
      width: 2048,
      height: 1365,
    });
    expect(msgs[0]!.text).toBeUndefined(); // the body IS the filename — it rides in media.name
  });

  it('m.file becomes a file attachment (download row shape, no w/h)', () => {
    const ev = imageEvent({
      id: '$file',
      content: {
        msgtype: 'm.file',
        body: 'waiver.pdf',
        url: 'mxc://serve.create.now/def456',
        info: { mimetype: 'application/pdf', size: 120333 },
      },
    });
    const [msg] = toMessages(room([ev]), ME, BOTS, NS, HS);
    expect(msg!.media).toMatchObject({ kind: 'file', name: 'waiver.pdf', mimeType: 'application/pdf', size: 120333 });
    expect(msg!.media!.width).toBeUndefined();
  });

  it('a redacted media message drops entirely (existing rule holds for attachments)', () => {
    const redaction: TimelineItem = {
      id: '$r',
      sender: ME,
      ts: 2,
      type: 'm.room.redaction',
      content: { redacts: '$img' },
    };
    expect(toMessages(room([imageEvent(), redaction]), ME, BOTS, NS, HS)).toHaveLength(0);
  });

  it('a malformed/non-mxc url yields NO media — the filename degrades to a text bubble', () => {
    const ev = imageEvent({ content: { msgtype: 'm.image', body: 'x.jpg', url: 'https://evil.example/x.jpg' } });
    const [msg] = toMessages(room([ev]), ME, BOTS, NS, HS);
    expect(msg!.media).toBeUndefined();
    expect(msg!.text).toBe('x.jpg');
  });

  it('without a homeserver URL media cannot resolve — protective no-media, filename as text', () => {
    const [msg] = toMessages(room([imageEvent()]), ME, BOTS, NS);
    expect(msg!.media).toBeUndefined();
    expect(msg!.text).toBe('river-cleanup.jpg');
  });

  it('plain m.text with a stray url field stays a text message', () => {
    const ev = imageEvent({ content: { msgtype: 'm.text', body: 'look at mxc://hs/x', url: 'mxc://hs/x' } });
    const [msg] = toMessages(room([ev]), ME, BOTS, NS, HS);
    expect(msg!.media).toBeUndefined();
    expect(msg!.text).toBe('look at mxc://hs/x');
  });

  it('mediaOf guards malformed info blocks (wrong types dropped, media kept)', () => {
    const media = mediaOf(
      { msgtype: 'm.image', body: 'a.jpg', url: 'mxc://hs/x', info: { mimetype: 42, size: 'big', w: '2048' } },
      HS,
    );
    expect(media).toMatchObject({ kind: 'image', name: 'a.jpg' });
    expect(media!.mimeType).toBeUndefined();
    expect(media!.size).toBeUndefined();
    expect(media!.width).toBeUndefined();
  });
});
