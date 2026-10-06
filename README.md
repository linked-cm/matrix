# `@linked.cm/matrix`

A Matrix transport for [`@linked.cm/messaging`](https://github.com/linked-cm/messaging).

`@linked.cm/messaging` defines the seam and the UI. This package implements the
seam against a Matrix homeserver — identity, sessions, projection, and the graph
mirror — so an app gets federated, end-to-end-encrypted chat without any
component knowing Matrix exists.

## Install

```sh
npm install @linked.cm/matrix matrix-js-sdk
```

## Entry points

- `@linked.cm/matrix` — shapes, ontology, namespace config, MXID derivation, and the pure projection
- `@linked.cm/matrix/client` — the `matrix-js-sdk` transport implementing `Messaging`
- `@linked.cm/matrix/react` — the connect/retry lifecycle hook
- `@linked.cm/matrix/backend` — **server-only**: the appservice-mediated identity bridge

## Nothing here is branded

Every name a host stamps into Matrix is a host choice, so it is configuration
rather than a constant:

```ts
import { resolveMatrixNamespace } from '@linked.cm/matrix';

export const chat = resolveMatrixNamespace({
  serverName: 'chat.example.org',      // the only required field
  roomMarkerType: 'org.example.room',  // state event carrying entity/tier/audience
  cardEventPrefix: 'org.example.',     // custom timeline events that render as cards
  cardContentField: 'org.example.card',
  botUserIds: ['@bot:chat.example.org'],
});
```

The projection tests run against a namespace that shares nothing with any
shipping app, so a hardcoded product string fails the suite instead of passing
by coincidence.

## Client

```ts
import { createMatrixMessaging, fetchMatrixSession } from '@linked.cm/matrix/client';

const transport = await createMatrixMessaging(
  await fetchMatrixSession(viewer.webId, viewer.name),
  chat,
);
```

`transport` satisfies `Messaging`, so it drops straight into `MessageClient`.
It projects rooms into spaces and threads, supports reactions, replies, edits,
redactions, attachments, typing, read receipts, body-less signal events, and
client-side poll aggregation.

In React, the lifecycle hook owns connect/retry and fails gracefully rather than
substituting demo data:

```tsx
const { transport, state } = useMatrixTransport({
  getViewer: () => session.get(),
  namespace: chat,
});
```

## Identity

The Matrix localpart is a stable, opaque, non-PII derivation of the subject's
WebID: `@p_<26 chars base32(sha256(webId))>:<server name>`. It is deterministic,
so app, appservice, and tests derive the same MXID with no lookup table.

Because a hash is one-way, reverse resolution (room member → subject, which
safety audits need) requires a graph record — that is what `MatrixIdentityShape`
is for. `MatrixRoomBindingShape` records which room realizes which host entity,
along with the tier, audience, and encryption stamped at provisioning, so an
audit can reconstruct a room's audience from durable data rather than live room
state.

A verified host session yields a Matrix session with no second credential: the
backend holds the appservice `as_token` and registers-or-logs-in the caller's
puppet. **The `as_token` never reaches a client** — callers receive only their
own user-scoped access token.

```ts
// server-only
import { ensureMatrixSession } from '@linked.cm/matrix/backend';

const identity = await ensureMatrixSession(webId, {
  serverName: 'chat.example.org',
  registrationPath: 'infra/matrix/appservice.yaml',
  recordIdentity: (webId, mxid) => mirrorIntoGraph(webId, mxid),
});
```

## Homeserver

`infra/` carries a Continuwuity configuration, an appservice registration
template, and the bootstrap scripts. Continuwuity is a Rust homeserver with
embedded RocksDB; it runs as a sibling container to the app and shares only the
identity spine, never a database.

## Migrating an app that already ran Matrix

An app that built Matrix before this package existed minted its own predicates.
Those triples are correct data in a private vocabulary. `scripts/migrate-namespace.mjs`
moves them onto `https://id.linked.cm/matrix/`, one term per transaction:

```sh
node scripts/migrate-namespace.mjs \
  --endpoint http://localhost:3030/<dataset> \
  --from https://your.app/ont/your-app/ \
  --dry-run
```

Read the counts, then re-run without `--dry-run`. Every term is idempotent, and
old triples are removed only after the new ones are written. Nothing runs this
for you.

The package targets `@_linked/core` 2.14.4 and owns the permanent identifier
namespace `https://id.linked.cm/matrix/`.
