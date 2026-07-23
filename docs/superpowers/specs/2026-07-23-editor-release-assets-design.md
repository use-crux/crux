# Editor extension and native GitHub Release assets

Status: **approved for implementation planning**

Tracking: [#267](https://github.com/use-crux/crux/issues/267)

## Problem

Crux now has a working VS Code-compatible extension and `crux lsp`, but public
installation is still a developer workflow. The extension packages into a
VSIX, and the release pipeline already builds six native binary bundles for npm
platform packages, yet stable and nightly GitHub Releases contain no assets.

Marketplace publication and an extension-owned binary downloader are separate
product decisions. The immediate goal is a complete, inspectable GitHub
distribution path using artifacts the release pipeline already produces.

## Product contract

Stable releases and nightly prereleases publish the same asset matrix:

- one universal `crux-vscode-<version>.vsix`;
- `crux-<version>-linux-x64.tar.gz`;
- `crux-<version>-linux-arm64.tar.gz`;
- `crux-<version>-darwin-x64.tar.gz`;
- `crux-<version>-darwin-arm64.tar.gz`;
- `crux-<version>-win32-x64.zip`;
- `crux-<version>-win32-arm64.zip`; and
- `SHA256SUMS` covering every VSIX/archive asset.

The extension version is lockstep with the Crux release version, including the
existing nightly version. Each native archive contains exactly the matching
`crux` executable and `crux-static-index-worker` sibling, using `.exe` names on
Windows. npm remains the recommended CLI installation; release archives are
the direct-download alternative.

## Boundaries

This work does not publish to Visual Studio Marketplace or Open VSX, download
executables from extension code, bundle native binaries into the universal
VSIX, or change Project Index/LSP/cache behavior. Marketplace-managed
platform-specific VSIX packages are the preferred future one-click path before
considering a custom downloader.

## Architecture

### One platform manifest

Extract the current six-entry local platform table from
`scripts/stage-npm-packages.mjs` into a small shared release manifest. npm
staging and GitHub asset staging consume the same IDs, OS/CPU values, executable
names, and worker names. This prevents the two public distribution surfaces
from silently drifting.

The manifest is declarative data. It does not own workflow behavior, archive
commands, or publication policy.

### Release-asset staging

A focused Node entry point stages GitHub assets into an explicit temporary
directory. It accepts the release version, restored native-bundle root, output
directory, and extension source directory. It never builds a binary.

The release job owns extension production before invoking the stager: it runs
the extension tests and typecheck, builds `packages/vscode/dist/extension.js`,
then supplies that built entry point to staging. The stager fails if the entry
point is missing; it does not hide a missing build by invoking an implicit
prepublish hook.

For each platform, the stager validates both expected executables, copies them
into one top-level `crux-<version>-<platform>/` archive directory, normalizes
Unix executable modes, and creates a deterministic platform-appropriate
archive. It packages the built extension from a temporary copy whose manifest
version is rewritten to the release version; the tracked
`packages/vscode/package.json` is never modified by release packaging.

The output has separate `public/` and `internal/` directories. `public/`
contains exactly the eight release assets in the product contract. `internal/`
contains a machine-readable asset manifest with version, source commit,
expected filenames, platform identity, archive format, contained paths, sizes,
and SHA-256 values. `SHA256SUMS` is rendered from the final public asset bytes.
The internal manifest is retained as a workflow artifact for diagnostics but is
not uploaded to the GitHub Release.

### Validation

A separate validator consumes the machine-readable manifest and staged assets.
It rejects:

- missing, extra, or duplicate public assets;
- a platform missing either executable;
- wrong executable names or non-executable Unix archive entries;
- a VSIX whose manifest version differs from the release version;
- archive paths that escape their single top-level release directory;
- checksum, recorded-size, source-commit, or version mismatches; and
- stable/nightly asset names that do not follow the one naming function.

Validation inspects archive and VSIX contents rather than trusting only staging
inputs. Release workflow upload receives only the validated `public/` output
directory.

### Workflow integration

Stable and nightly jobs reuse the same extension-build, stage, and validate
commands after restoring the existing build-matrix artifacts. Asset staging and
validation run before npm publication, so a packaging defect cannot begin a
partially public release. npm remains the first external publish.

The stable publish job checks the complete staged npm package set at the target
version before publishing. If none exists, it publishes normally. If every
package already exists at that exact version, it skips npm and continues with
GitHub asset reconciliation. A partial set fails closed for manual recovery.
This makes a rerun capable of repairing GitHub assets without attempting to
republish completed npm versions.

The nightly coordinator extends its existing completeness decision with the
expected GitHub asset matrix and checksums. Its build output becomes true when
either npm needs a new nightly or the current immutable nightly is missing or
has invalid release assets. In the repair-only case it checks out the tag's
already-verified source SHA, deterministically rebuilds the extension/native
bundles, stages and validates assets, skips npm publication, and reconciles the
prerelease. Nightly repair therefore does not depend on downloading artifacts
from a previous workflow run or on Actions artifact retention.

After npm succeeds, the workflow creates or reconciles the GitHub Release and
uploads the validated assets. Reruns are idempotent:

- an existing asset with the expected checksum is accepted;
- a conflicting asset for the same immutable tag fails closed; and
- existing nightly tag/source-SHA/prerelease checks remain binding.

If GitHub upload fails after npm publication, a stable rerun uses its freshly
rebuilt current-tag artifacts and a nightly rerun enters the repair-only build
path above. Both reproduce the assets from the immutable source tag without
publishing npm again.

## Extension readiness and binary discovery

The extension manifest and README stop describing the package as private. The
published VSIX contains public install, support, repository, license, and LSP
documentation links while retaining Restricted Mode behavior.

Binary discovery keeps the existing precedence—explicit setting, trusted
workspace-local candidate, then PATH—but expands trusted workspace candidates
to the project-local npm executable shims produced by `@use-crux/local`.
Windows `.cmd`/`.exe` behavior is explicit and tested; discovery continues to
execute `--version` before starting the server. No discovery or validation runs
in an untrusted workspace.

When discovery fails, the extension offers an installation-documentation action
that explains both supported paths instead of sending the user only to the raw
binary-path setting.

## Documentation

The LSP reference and extension README document:

1. recommended installation with `npm install -g @use-crux/local` plus the
   release VSIX;
2. project-local npm installation where supported by the editor host;
3. direct native archive download, extraction, and `crux.binaryPath` setup;
4. `code --install-extension <file.vsix>` and Install from VSIX;
5. platform/architecture selection and checksum verification; and
6. the lack of automatic updates before marketplace publication.

Stable release notes link these instructions. Nightly notes identify the assets
as prerelease builds from the exact source SHA.

## Failure handling

Every stage fails closed before upload. Temporary extension manifests and
archive roots are removed on success or failure. The uploader never silently
replaces a conflicting immutable asset. A post-npm GitHub outage leaves npm
usable and is repairable through the idempotent reconciliation job.

Checksums protect download integrity, not publisher identity. Artifact
attestations and signing are valuable later hardening, but are not required for
the first GitHub distribution release.

## Testing

- Unit tests cover the shared platform manifest, asset naming, lockstep stable
  and nightly versions, and expected matrix generation.
- Fixture tests stage all six platforms and prove archive contents, executable
  modes, version metadata, and deterministic checksums.
- Repeat-build tests prove identical inputs produce byte-identical VSIX and
  native archives, which the repair reconciliation contract depends on.
- Negative tests reject every validator condition listed above.
- VSIX inspection proves the lockstep version, public metadata, license, and
  bundled extension entry point.
- Extension tests cover project-local npm shim discovery on Unix and Windows,
  precedence, failed `--version`, Restricted Mode, and the install-docs action.
- CI runs the same staging/validation entry points with fixture bundles; stable
  and nightly workflows contain no separate packaging logic.
- A release smoke checklist downloads the published VSIX and one archive on
  Linux, macOS, and Windows, verifies checksums, runs `crux --version`, and
  starts the extension against a fixture workspace.

Existing cross-platform build jobs remain responsible for binary correctness.
GitHub asset staging verifies packaging and identity, not the Go/Rust runtime
again.

## Release and repository impact

This changes public CLI/extension install behavior and release mechanics. The
existing `@use-crux/local` changeset should be extended if it still represents
the release theme; otherwise implementation creates the appropriate release
entry after inspecting pending changesets. No Project Index, semantic, or Eval
cache identity changes are required.
