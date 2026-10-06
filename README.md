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
  await fetchMatrixSession({ name: viewer.name }),
  chat,
);
```

`fetchMatrixSession` posts `{ name }` only, with `credentials: 'same-origin'`.
It never sends a WebID. The session route decides who is signed in.

`transport` satisfies `Messaging`, so it drops straight into `MessageClient`.
It projects rooms into spaces and threads, supports reactions, replies, edits,
redactions, attachments, typing, read receipts, body-less signal events, and
client-side poll aggregation.

In React, the lifecycle hook owns connect/retry and fails gracefully rather than
substituting demo data:

```tsx
const { transport, state } = useMatrixTransport({
  getViewer: () => (session ? { webId: session.webId, name: session.name } : null),
  namespace: chat,
});
```

`getViewer()` may still return `{ webId, name }` so the hook knows whether
someone is signed in and when that person changes. Only `name` is sent.

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

`ensureMatrixSession` is a **privileged server primitive**. It creates a
homeserver login for whatever WebID it is given. Call it only with a WebID the
host has authenticated, or a WebID the host is authorized to provision (for
example the other party of a direct conversation the session user may open).
Never pass a WebID taken from a request body. Do not log the access token it
returns.

```ts
// server-only — webId must already be authenticated or authorized
import { ensureMatrixSession } from '@linked.cm/matrix/backend';

const identity = await ensureMatrixSession(webId, {
  serverName: 'chat.example.org',
  registrationPath: 'infra/matrix/appservice.yaml',
  recordIdentity: (webId, mxid) => mirrorIntoGraph(webId, mxid),
});
```

## Wiring sessions safely

The caller's own session goes through `createMatrixSessionHandler`.
`resolveWebId` is required: it reads the host's verified server session. A
request body that contains a `webId` key at all is `400`
`webid-from-session-only` and does not mint. No session WebID is `401`
`authentication-required`. Display name comes from `resolveDisplayName(req)`
when that option is set, otherwise from a string body `name` (cosmetic only).

```ts
import { createMatrixSessionHandler } from '@linked.cm/matrix/backend';

const matrixSession = createMatrixSessionHandler({
  resolveWebId: (req) => readVerifiedWebId(req),
  resolveDisplayName: (req) => readVerifiedName(req),
  config: {
    serverName: 'chat.example.org',
    registrationPath: 'infra/matrix/appservice.yaml',
    recordIdentity: (webId, mxid) => mirrorIntoGraph(webId, mxid),
  },
});

// Framework-agnostic: Serve registers (req, res) handlers this way.
registerRoute('post', '/api/matrix/session', matrixSession);
```

A host that already wraps the bridge (Serve's `ensureMatrixSession(webId, displayName)`)
passes that wrapper as `ensureSession` instead of `config`. On an Express-style
server, `registerMatrixRoutes(server, { resolveWebId, config, sessionPath })`
mounts `POST /api/matrix/session` by default.

On the client, the session cookie travels with `credentials: 'same-origin'` by
default. A host whose session is a bearer token (a native or Capacitor shell, or
a different API origin) passes it as headers; the body still carries only `name`:

```ts
useMatrixTransport({
  getViewer,
  namespace,
  sessionHeaders: async () => ({ Authorization: `Bearer ${await getSessionToken()}` }),
  sessionCredentials: 'include', // only when the route is on another origin
});
```

`fetchMatrixSession({ name, sessionRoute, headers, credentials })` takes the same
options directly.

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

The package targets `@_linked/core` ^2.25.0 and owns the permanent identifier
namespace `https://id.linked.cm/matrix/`.

During development this package depends on `@linked.cm/messaging` as
`file:../messaging`. Replace that with `^0.2.0` after messaging 0.2.0 is
published; a `file:` dependency cannot be published.
