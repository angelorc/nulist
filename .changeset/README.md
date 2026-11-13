# Changesets

Run `pnpm changeset` in any PR that changes `@nulist/web` or `@nulist/sdk`. Both packages share
one version, so one changeset bumps both.

On merge to `main`, the Release workflow opens (or updates) a "version packages" PR. Merging that
PR tags `vX.Y.Z`, which builds the Docker images, creates the GitHub release and stages the SDK on npm.
