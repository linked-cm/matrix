---
"@linked.cm/matrix": minor
---

Break the session API so a caller-supplied WebID can no longer mint a Matrix login.

`fetchMatrixSession` now takes `{ name?, sessionRoute? }` and posts `{ name }` only. Mount `createMatrixSessionHandler({ resolveWebId, config | ensureSession })` (or `registerMatrixRoutes`) so the WebID comes from the host's verified server session. A body `webId` is `400 webid-from-session-only`; a missing session is `401 authentication-required`. `ensureMatrixSession` stays a privileged server primitive: call it only with a WebID the host has authenticated or is authorized to provision.

Room projection now carries a host audience key verbatim instead of keeping only `18+`.
