# Publishing

Crux publishes public alpha packages to npm under the `@use-crux` scope. Keep this document focused on
the package contract and release mechanics; a broken alpha package is worse than a delayed one.

## Release target

The first public alpha should publish the packages users can install directly:

- `@use-crux/core`
- `@use-crux/ai`
- `@use-crux/openai`
- `@use-crux/anthropic`
- `@use-crux/google`
- `@use-crux/convex`
- `@use-crux/upstash`
- `@use-crux/otel`
- `@use-crux/ingest`
- `@use-crux/indexer`
- `@use-crux/react`
- `@use-crux/local`

Internal packages such as `@use-crux/devtools` can stay private until they have a stable external contract.

## Package contract

Every published package must have:

- Compiled `dist` JavaScript and declaration files.
- `main`, `types`, and `exports` pointing at `dist`, not raw `.ts` source.
- A narrow `files` allowlist for package contents.
- `license`, `repository`, `bugs`, `homepage`, and useful `description`.
- `publishConfig.access: "public"` and `publishConfig.provenance: true`.
- Provider SDKs, React, Convex, and host frameworks in `peerDependencies` when users should own the version.
- Workspace `@use-crux/*` dependencies using a version range that Changesets can update.

## Pre-publish checks

Run these before enabling public npm publishing:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm changeset status
```

## Native AST beta parity

Before releasing or promoting `experimental.indexer.nativeAst`, run the native
AST beta parity gate and normal local build path:

```bash
pnpm test:native-ast-parity
make local
```

The parity gate must not skip because a Rust worker or env var is missing. Keep
the current evidence, residual risks, and default-readiness checklist in
[`docs/NATIVE_AST_BETA_READINESS.md`](./NATIVE_AST_BETA_READINESS.md) up to date.

Then run a tarball check for every publishable package:

```bash
pnpm --filter @use-crux/core pack --pack-destination /tmp/crux-pack
pnpm --filter @use-crux/ai pack --pack-destination /tmp/crux-pack
pnpm --filter @use-crux/openai pack --pack-destination /tmp/crux-pack
pnpm --filter @use-crux/anthropic pack --pack-destination /tmp/crux-pack
pnpm --filter @use-crux/google pack --pack-destination /tmp/crux-pack
pnpm --filter @use-crux/convex pack --pack-destination /tmp/crux-pack
pnpm --filter @use-crux/upstash pack --pack-destination /tmp/crux-pack
pnpm --filter @use-crux/otel pack --pack-destination /tmp/crux-pack
pnpm --filter @use-crux/ingest pack --pack-destination /tmp/crux-pack
pnpm --filter @use-crux/indexer pack --pack-destination /tmp/crux-pack
pnpm --filter @use-crux/react pack --pack-destination /tmp/crux-pack
pnpm --filter @use-crux/local pack --pack-destination /tmp/crux-pack
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
4. Confirm npm trusted publishing is configured for `.github/workflows/release.yml`.
5. Let the Changesets release PR update versions.
6. Merge the release PR after CI passes.
7. Smoke-test install in a fresh project:

```bash
mkdir crux-smoke
cd crux-smoke
pnpm init
pnpm add @use-crux/core @use-crux/ai ai @ai-sdk/openai zod
```

## Nightly releases

Nightly releases are generated snapshots from `main`, not Changesets releases. The `Release` workflow
supports manual dispatch and a daily scheduled run. Scheduled runs skip publishing when the current
`main` SHA is already the published `@nightly` version.

Nightly versions use the next patch version plus timestamp and SHA, for example:

```text
0.3.1-nightly.20260629193045.shaabc1234
```

Nightly publishes use the npm `nightly` dist-tag:

```bash
pnpm add @use-crux/core@nightly
pnpm add @use-crux/local@nightly
```

Nightly releases must not update changelogs, create GitHub Releases, create git tags, or publish with
the `latest` dist-tag. Internal `@use-crux/*` dependencies are pinned exactly to the same nightly
version so the package set remains coherent.
