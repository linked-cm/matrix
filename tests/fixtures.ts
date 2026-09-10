import { pollTypesFor, resolveMatrixNamespace } from '../src/config.js';

/**
 * A deliberately NON-default, non-Serve namespace. Every projection test runs
 * through it, so a hardcoded product string anywhere in the mapping fails the
 * suite rather than passing by coincidence.
 */
export const NS = resolveMatrixNamespace({
  serverName: 'chat.example.org',
  roomMarkerType: 'org.example.room',
  cardEventPrefix: 'org.example.',
  cardContentField: 'org.example.card',
  webIdAccountDataType: 'org.example.webid',
  botUserIds: ['@bot:chat.example.org', '@helper:chat.example.org'],
});

export const POLL = pollTypesFor(NS);
