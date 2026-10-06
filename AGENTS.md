# AGENTS.md — @linked.cm/matrix

Staged in the **linked-cm** org (npm scope `@linked.cm`) pending René's review; moves to linked-fw (`@_linked/matrix`) only after approval. The `@_linked` npm scope is reserved for linked-fw.

Extracted from `serve-earth/serve-community` (Serve's Matrix transport) on 2026-09-11. Consumers: Serve (`serve-community`); Peace Game planned.

## Do not change without a migration

- `linkedPackage('@_linked/matrix', { baseUri: 'https://linked.cm/' })` in `src/package.ts` — it decides the package and component IRIs. The npm name is independent of it.
- The identifier namespace `https://id.linked.cm/matrix/` and the MXID derivation in `src/mxid.ts`. Changing either re-keys every existing Matrix user and room binding.

## Release blocker: session identity

`ensureMatrixSession(webId, …)` (`src/backend/identity.ts`) creates a homeserver login for whatever WebID it is given, and `fetchMatrixSession` (`src/client.ts`) sends `{ webId, name }` in the request body. A host that wires these together as-is lets any caller obtain any person's Matrix session. Before the first npm release:

- Ship a `registerMatrixRoutes(server, { resolveWebId })` helper. `resolveWebId(req)` is supplied by the host and reads its **verified server session**. The route refuses a body `webId` and answers 401 with no session.
- `fetchMatrixSession` stops sending `webId`.
- Add a test that a spoofed body `webId` is rejected.

See `serve-community` `docs/reports/2026-10-staging-signin-readiness.md` (rows A10/A14).

## Rules

- Server-only code lives under `src/backend/` and is exported only from `@linked.cm/matrix/backend`. Never import it from client code.
- Host policy (age bands, safeguarding, room taxonomy) stays in the host; this package provides the bridge, the projection, and the client.
- Depends on `@linked.cm/messaging`. During development it resolves as `file:../messaging`, so clone both repos side by side and run `npm run build` in `messaging` before typechecking here. Replace it with a published version range before releasing; a `file:` dependency cannot be published and fails CI, which is why this repo has no PR workflow yet.
- Releases go through changesets (`npx changeset`). Add `.github/workflows/publish.yml` (copied from `linked-cm/calendar`) only when a release is intended: with no pending changesets, that workflow publishes the current version as soon as it lands on `main`.
