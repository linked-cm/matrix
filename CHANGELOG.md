# @linked.cm/matrix

## 0.3.0

### Minor Changes

- [#1](https://github.com/linked-cm/matrix/pull/1) [`1a4ac2c`](https://github.com/linked-cm/matrix/commit/1a4ac2c9193500fba0273caa61a5ecab79ddabfa) Thanks [@carlenmy](https://github.com/carlenmy)! - Add a fail-closed relay enforcement seam for hosts with mandatory safety or
  policy controls. Server-issued sessions can attest an active policy, clients can
  require it, moderated room power levels prevent direct member events, and a
  framework-neutral controlled-send handler derives identity from the verified
  session before authorization, control evaluation, logical-author stamping, and
  relay dispatch.

- [#1](https://github.com/linked-cm/matrix/pull/1) [`f5a52c2`](https://github.com/linked-cm/matrix/commit/f5a52c2cc44fc8ea8ad238ce55ee2ef6e0ecb167) Thanks [@carlenmy](https://github.com/carlenmy)! - Add Matrix-native event reporting and one-way ignore actions plus a verified-session,
  host-authorized appservice moderation handler.

## 0.2.0

### Minor Changes

- [`a33e7b1`](https://github.com/linked-cm/matrix/commit/a33e7b169f1f6ab35c72c0d6c2186b4f360c2754) Thanks [@carlenmy](https://github.com/carlenmy)! - Break the session API so a caller-supplied WebID can no longer mint a Matrix login.
  
  `fetchMatrixSession` now takes `{ name?, sessionRoute?, headers?, credentials? }` and posts `{ name }` only; `headers` (or `useMatrixTransport`'s `sessionHeaders`) carries a host session token when cookies are not available. Mount `createMatrixSessionHandler({ resolveWebId, config | ensureSession })` (or `registerMatrixRoutes`) so the WebID comes from the host's verified server session. A body `webId` is `400 webid-from-session-only`; a missing session is `401 authentication-required`. `ensureMatrixSession` stays a privileged server primitive: call it only with a WebID the host has authenticated or is authorized to provision.
  
  Room projection now carries a host audience key verbatim instead of keeping only `18+`.
