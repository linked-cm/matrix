---
'@linked.cm/matrix': major
---

Move the ontology to `https://linked.cm/ont/matrix/` and ship it as Turtle.

- Terms move from `https://id.linked.cm/matrix/` to `https://linked.cm/ont/matrix/` (prefix
  `matrix`); the old namespace stays exported as the deprecated `legacyNs`. Stored identities and
  room bindings are invisible to this release until rewritten:
  `scripts/migrate-namespace.mjs --from https://id.linked.cm/matrix/` moves them, every term
  under its own name.
- `src/data/matrix.ttl` declares the classes and properties; `ontologies/matrix.register`
  registers it (imported by the entry and by `shapes/index`).
- Requires `@_linked/core` ^2.37.2 and `@_linked/xsd` ^1.3.1.
