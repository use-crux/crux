# Open Source Checklist

Use this before changing `use-crux/crux` from private to public.

## Repository

- [ ] Remove Karyla-specific implementation details that are not part of Crux.
- [ ] Remove generated artifacts and local caches.
- [ ] Run a secret scan over the full tree and rotate anything that ever appeared in Git.
- [x] Confirm the license choice: Apache-2.0.
- [x] Add `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue templates, and a pull request template.
- [ ] Confirm GitHub private vulnerability reporting is enabled for `use-crux/crux`.
- [ ] Enable GitHub Discussions if the project wants public Q&A outside issues.
- [ ] Replace cleanup history with a clean initial public commit if desired.

## Packages

- [ ] Convert all publishable packages from raw `.ts` entrypoints to compiled `dist` entrypoints.
- [ ] Remove `"private": true` from packages intended for npm.
- [ ] Add `files`, `publishConfig.access`, and `publishConfig.provenance` to publishable package manifests.
- [ ] Ensure internal `@use-crux/*` dependencies use `workspace:^` or a deliberate equivalent.
- [ ] Keep provider SDKs and host frameworks in `peerDependencies` where users should control versions.
- [ ] Run package tarball checks with `pnpm pack` before publishing.
- [x] Document the npm publishing contract in `docs/PUBLISHING.md`.

## CI and Releases

- [ ] Add `NPM_TOKEN` to repository or organization secrets.
- [ ] Enable branch protection for `main`.
- [ ] Confirm CI passes on a clean GitHub runner.
- [ ] Confirm the Changesets release PR flow before first public npm publish.

## Karyla Integration

- [ ] Add this repo to Karyla as a submodule or subtree only after the public repo is the source of truth.
- [ ] Update Karyla workspace globs if consuming Crux as workspace packages.
- [ ] Remove the duplicated in-Karyla `packages/crux-*` copies once the submodule path is active.
