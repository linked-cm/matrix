---
'@linked.cm/matrix': major
---

The ontology moves to `https://linked.cm/ont/matrix/` and ships as Turtle with generated
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
- **Removed:** the root's `mx` namespace object (import `ontologies/matrix` instead), `_self`
  (now `_ontologyResource` in `ontologies/matrix.data`), `legacyNs`, `ns`/`dataFiles`/`loadData`
  from `ontologies/matrix` (now in `ontologies/matrix.data`), and
  `scripts/migrate-namespace.mjs` (the package no longer ships `scripts/`).
- The build ships `lib/esm/data/matrix.ttl` and `shapes.ttl`.
- Requires `@_linked/core` ^2.46.0 and `@_linked/xsd` ^1.4.4; built with `@_linked/cli` ^1.61.0.
