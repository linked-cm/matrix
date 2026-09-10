/**
 * WebID ↔ MXID derivation. The Matrix localpart is a STABLE, OPAQUE, NON-PII
 * derivation of the subject's canonical WebID — never a name or an email.
 * Deterministic, so any component (app, appservice, tests) derives the same MXID
 * with no lookup table; the graph still mirrors the mapping for reverse
 * resolution, which hashing alone cannot give you.
 *
 * Shape: `@p_<26 chars base32(sha256(webId))>:<server name>` — 130 bits of the
 * hash, collision-safe at any plausible population, and matching the appservice's
 * exclusive namespace `@p_.*`. WebCrypto keeps this file isomorphic
 * (browser + Node 18+).
 */

const LOCALPART_PREFIX = 'p_';
const LOCALPART_HASH_CHARS = 26;
// RFC 4648 base32, lowercased — MXID localparts must be lowercase.
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

function base32(bytes: Uint8Array, chars: number): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < chars) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    if (out.length >= chars) break;
  }
  return out;
}

/** Canonicalize before hashing so trailing-slash drift can't fork identities. */
function canonicalWebId(webId: string): string {
  const trimmed = webId.trim();
  if (!/^https?:\/\//.test(trimmed)) {
    throw new Error('webId must be an absolute IRI');
  }
  return trimmed.replace(/\/+$/, '');
}

export async function localpartForWebId(webId: string): Promise<string> {
  const data = new TextEncoder().encode(canonicalWebId(webId));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return `${LOCALPART_PREFIX}${base32(new Uint8Array(digest), LOCALPART_HASH_CHARS)}`;
}

export async function mxidForWebId(webId: string, serverName: string): Promise<string> {
  return `@${await localpartForWebId(webId)}:${serverName}`;
}

/** True for MXIDs inside the appservice's exclusive subject namespace. */
export function isSubjectMxid(mxid: string, serverName: string): boolean {
  return new RegExp(
    `^@${LOCALPART_PREFIX}[a-z2-7]{${LOCALPART_HASH_CHARS}}:${serverName.replace(/\./g, '\\.')}$`,
  ).test(mxid);
}
