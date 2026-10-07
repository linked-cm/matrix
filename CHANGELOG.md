# @linked.cm/matrix

## 0.2.0

### Minor Changes

- [`a33e7b1`](https://github.com/linked-cm/matrix/commit/a33e7b169f1f6ab35c72c0d6c2186b4f360c2754) Thanks [@carlenmy](https://github.com/carlenmy)! - Break the session API so a caller-supplied WebID can no longer mint a Matrix login.
  
  `fetchMatrixSession` now takes `{ name?, sessionRoute?, headers?, credentials? }` and posts `{ name }` only; `headers` (or `useMatrixTransport`'s `sessionHeaders`) carries a host session token when cookies are not available. Mount `createMatrixSessionHandler({ resolveWebId, config | ensureSession })` (or `registerMatrixRoutes`) so the WebID comes from the host's verified server session. A body `webId` is `400 webid-from-session-only`; a missing session is `401 authentication-required`. `ensureMatrixSession` stays a privileged server primitive: call it only with a WebID the host has authenticated or is authorized to provision.
  
  Room projection now carries a host audience key verbatim instead of keeping only `18+`.
