# AGENTS.md — @linked.cm/matrix

Staged in the **linked-cm** org (npm scope `@linked.cm`) pending René's review; moves to linked-fw (`@_linked/matrix`) only after approval. The `@_linked` npm scope is reserved for linked-fw.

Extracted from `serve-earth/serve-community` (Serve's Matrix transport) on 2026-09-11. Consumers: Serve (`serve-community`); Peace Game planned.

## Do not change without a migration

- `linkedPackage('@_linked/matrix', { baseUri: 'https://linked.cm/' })` in `src/package.ts` — it decides the package and component IRIs. The npm name is independent of it.
- The identifier namespace `https://id.linked.cm/matrix/` and the MXID derivation in `src/mxid.ts`. Changing either re-keys every existing Matrix user and room binding.

## Session identity

`ensureMatrixSession(webId, …)` (`src/backend/identity.ts`) is a privileged server primitive: it creates a homeserver login for the WebID it is given. Call it only with a WebID the host has authenticated, or one the host is authorized to provision (for example the other party of a DM the session user may open). Never pass a WebID from a request body.

The safe default for the caller's own session is `createMatrixSessionHandler({ resolveWebId })` (`src/backend/routes.ts`), also mounted by `registerMatrixRoutes`. `resolveWebId` reads the host's verified server session and is required at construction. The handler refuses a body `webId` (`400 webid-from-session-only`) and answers `401 authentication-required` when that resolver yields no WebID. `fetchMatrixSession({ name?, sessionRoute? })` posts `{ name }` only.

See `serve-community` `docs/reports/2026-10-staging-signin-readiness.md` (rows A10/A14).

## Rules

- Server-only code lives under `src/backend/` and is exported only from `@linked.cm/matrix/backend`. Never import it from client code.
- Host policy (age bands, safeguarding, room taxonomy) stays in the host; this package provides the bridge, the projection, and the client.
- Depends on `@linked.cm/messaging`. During development it resolves as `file:../messaging`, so clone both repos side by side and run `npm run build` in `messaging` before typechecking here. Replace it with `^0.2.0` after `@linked.cm/messaging` 0.2.0 is published; a `file:` dependency cannot be published and fails CI, which is why this repo has no PR workflow yet.
- Releases go through changesets (`npx changeset`). Add `.github/workflows/publish.yml` (copied from `linked-cm/calendar`) only when a release is intended: with no pending changesets, that workflow publishes the current version as soon as it lands on `main`.
