# Publishing

Crux is not ready for public npm publishing until the package build contract below is complete. Keep packages private until these checks pass; a broken alpha package is worse than a delayed one.

## Release target

The first public alpha should publish the packages users can install directly:

- `@crux/core`
- `@crux/ai`
- `@crux/openai`
- `@crux/anthropic`
- `@crux/google`
- `@crux/convex`
- `@crux/upstash`
- `@crux/otel`
- `@crux/ingest`
- `@crux/react`
- `@crux/local`

Internal packages such as `@crux/devtools` and `@crux/indexer` can stay private until they have a stable external contract.

## Package contract

Every published package must have:

- Compiled `dist` JavaScript and declaration files.
- `main`, `types`, and `exports` pointing at `dist`, not raw `.ts` source.
- A narrow `files` allowlist for package contents.
- `license`, `repository`, `bugs`, `homepage`, and useful `description`.
- `publishConfig.access: "public"` and `publishConfig.provenance: true`.
- Provider SDKs, React, Convex, and host frameworks in `peerDependencies` when users should own the version.
- Workspace `@crux/*` dependencies using a version range that Changesets can update.

## Pre-publish checks

Run these before enabling public npm publishing:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm changeset status
```

Then run a tarball check for every publishable package:

```bash
pnpm --filter @crux/core pack --pack-destination /tmp/crux-pack
pnpm --filter @crux/ai pack --pack-destination /tmp/crux-pack
pnpm --filter @crux/openai pack --pack-destination /tmp/crux-pack
pnpm --filter @crux/anthropic pack --pack-destination /tmp/crux-pack
pnpm --filter @crux/google pack --pack-destination /tmp/crux-pack
pnpm --filter @crux/convex pack --pack-destination /tmp/crux-pack
pnpm --filter @crux/upstash pack --pack-destination /tmp/crux-pack
pnpm --filter @crux/otel pack --pack-destination /tmp/crux-pack
pnpm --filter @crux/ingest pack --pack-destination /tmp/crux-pack
pnpm --filter @crux/react pack --pack-destination /tmp/crux-pack
pnpm --filter @crux/local pack --pack-destination /tmp/crux-pack
```

For each tarball, inspect:

- No source-only test fixtures or local caches.
- No secrets or local `.env` files.
- `dist` entrypoints exist for every exported subpath.
- `package.json` exports resolve in a fresh consumer project.

## Release workflow

1. Land the build/package-manifest changes.
2. Remove `private: true` only from packages that pass the contract.
3. Add a Changeset.
4. Confirm `NPM_TOKEN` and npm provenance are configured for the repository.
5. Let the Changesets release PR update versions.
6. Merge the release PR after CI passes.
7. Smoke-test install in a fresh project:

```bash
mkdir crux-smoke
cd crux-smoke
pnpm init
pnpm add @crux/core @crux/ai ai @ai-sdk/openai zod
```
