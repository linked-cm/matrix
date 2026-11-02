# @linked.cm/matrix

## 1.0.0

### Major Changes

- [#11](https://github.com/linked-cm/matrix/pull/11) [`f678b40`](https://github.com/linked-cm/matrix/commit/f678b407fe77d21aea104d389da0aa2d25d75bc3) Thanks [@flyon](https://github.com/flyon)! - The ontology moves to `https://linked.cm/ont/matrix/` and ships as Turtle with generated
  accessor modules.
  
  - **New namespace.** Terms move from `https://id.linked.cm/matrix/` to
    `https://linked.cm/ont/matrix/` (prefix `matrix`); every term keeps its local name. Stored
    identities and room bindings are invisible to this release until the app rewrites that
    namespace (predicates and `rdf:type` objects) to the new one.
  - **Generated accessor modules.** `src/data/matrix.ttl` is the only source of terms;
    `linked generate-ontology` writes `ontologies/matrix` (one named export per term),
    `ontologies/matrix.data` (`ns`, `dataFiles`, `loadData`, `_ontologyResource`) and
    `ontologies/matrix.register`. Import the terms as a namespace:
    `import * as matrix from '@linked.cm/matrix/ontologies/matrix'`.
  - **Property groups are terms.** The shapes' `sh:group` values were bare strings (`'identity'`,
    `'binding'`, `'policy'`), which the shapes Turtle wrote as relative IRIs and shape sync refused.
    They are now `sh:PropertyGroup` terms of the ontology (`matrix:identityGroup`,
    `matrix:bindingGroup`, `matrix:policyGroup`, each with a label, comment and `sh:order`),
    exported from `ontologies/matrix`.
  - **Removed:** the root's `mx` namespace object (import `ontologies/matrix` instead), `_self`
    (now `_ontologyResource` in `ontologies/matrix.data`), `legacyNs`, `ns`/`dataFiles`/`loadData`
    from `ontologies/matrix` (now in `ontologies/matrix.data`), and
    `scripts/migrate-namespace.mjs` (the package no longer ships `scripts/`).
  - The build ships `lib/esm/data/matrix.ttl` and `shapes.ttl`.
  - Requires `@_linked/core` ^2.46.0 and `@_linked/xsd` ^1.4.4; built with `@_linked/cli` ^1.61.0.

## 0.3.1

### Patch Changes

- [#8](https://github.com/linked-cm/matrix/pull/8) [`dbd3b6d`](https://github.com/linked-cm/matrix/commit/dbd3b6de97253394850e024db6938a9100a0f493) Thanks [@flyon](https://github.com/flyon)! - Depend on `@linked.cm/messaging` ^0.3.0. Under 0.x, `^0.2.0` excluded 0.3.0, so matrix was held on the older messaging.

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
