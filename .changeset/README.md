# Changesets

This package uses [changesets](https://github.com/changesets/changesets) for version management and publishing.

## Adding a changeset

When making a change that should trigger a new release, run:

```bash
npx changeset
```

This generates a markdown file in `.changeset/` describing the change. Commit it with your PR.

On merge to `main`, the publish workflow either:

1. Creates (or updates) a **Release PR** that bumps the version + updates `CHANGELOG.md`, or
2. If the Release PR is already merged, publishes the new version to npm.

Changes that don't need a release (docs, CI config, tooling) can skip the changeset — the check is a warning, not a block.
