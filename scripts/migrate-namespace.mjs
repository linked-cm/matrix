#!/usr/bin/env node
/**
 * Rewrite an existing host-owned Matrix vocabulary onto the portable
 * `https://id.linked.cm/matrix/` terms this package defines.
 *
 * An app that ran Matrix before extracting this package minted its own
 * predicates (Serve, for instance, used
 * `https://serve.id.create.now/ont/serve-community/matrixRoomId`). Those triples
 * are still correct data — they just speak a private vocabulary. This script
 * moves them, one predicate at a time, inside a single transaction per term.
 *
 * It is deliberately NOT run by any build or boot step: point it at a dataset
 * yourself, run it with --dry-run first, and read the counts before committing.
 *
 *   node scripts/migrate-namespace.mjs \
 *     --endpoint http://localhost:3030/serve \
 *     --from https://serve.id.create.now/ont/serve-community/ \
 *     --dry-run
 *
 * Old triples are removed only after the new ones are written, and every term is
 * idempotent: re-running finds nothing left to move.
 */
const TARGET = 'https://id.linked.cm/matrix/';

/** old local name → new local name. Classes first, then properties. */
const TERMS = [
  ['MatrixIdentity', 'MatrixIdentity'],
  ['MatrixRoomBinding', 'MatrixRoomBinding'],
  ['forPlayer', 'forSubject'],
  ['mxid', 'mxid'],
  ['boundEntity', 'boundEntity'],
  ['matrixRoomId', 'roomId'],
  ['matrixChannelKey', 'channelKey'],
  ['matrixTier', 'tier'],
  ['matrixAudience', 'audience'],
  ['matrixEncrypted', 'encrypted'],
];

const CLASS_TERMS = new Set(['MatrixIdentity', 'MatrixRoomBinding']);

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const endpoint = arg('endpoint');
const from = arg('from');
const dryRun = process.argv.includes('--dry-run');

if (!endpoint || !from) {
  console.error('Usage: migrate-namespace.mjs --endpoint <sparql-url> --from <old-namespace-iri> [--dry-run]');
  process.exit(1);
}

async function sparql(path, body, contentType) {
  const res = await fetch(`${endpoint}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType, Accept: 'application/sparql-results+json' },
    body,
  });
  if (!res.ok) throw new Error(`${path} failed (${res.status}): ${await res.text()}`);
  return res.headers.get('content-type')?.includes('json') ? res.json() : null;
}

async function countFor(oldIri, isClass) {
  const pattern = isClass ? `?s a <${oldIri}>` : `?s <${oldIri}> ?o`;
  const result = await sparql('query', `SELECT (COUNT(*) AS ?n) WHERE { ${pattern} }`, 'application/sparql-query');
  return Number(result?.results?.bindings?.[0]?.n?.value ?? 0);
}

let moved = 0;
for (const [oldName, newName] of TERMS) {
  const oldIri = `${from}${oldName}`;
  const newIri = `${TARGET}${newName}`;
  const isClass = CLASS_TERMS.has(oldName);
  const n = await countFor(oldIri, isClass);
  if (!n) {
    console.log(`  ·  ${oldName} → ${newName}: nothing to move`);
    continue;
  }
  moved += n;
  if (dryRun) {
    console.log(`  →  ${oldName} → ${newName}: ${n} triple(s) WOULD move`);
    continue;
  }
  const update = isClass
    ? `INSERT { ?s a <${newIri}> } WHERE { ?s a <${oldIri}> };
       DELETE { ?s a <${oldIri}> } WHERE { ?s a <${oldIri}> }`
    : `INSERT { ?s <${newIri}> ?o } WHERE { ?s <${oldIri}> ?o };
       DELETE { ?s <${oldIri}> ?o } WHERE { ?s <${oldIri}> ?o }`;
  await sparql('update', update, 'application/sparql-update');
  console.log(`  ✓  ${oldName} → ${newName}: ${n} triple(s) moved`);
}

console.log(
  dryRun
    ? `\nDry run: ${moved} triple(s) would move onto ${TARGET}. Re-run without --dry-run to apply.`
    : `\nDone: ${moved} triple(s) now speak ${TARGET}.`,
);
