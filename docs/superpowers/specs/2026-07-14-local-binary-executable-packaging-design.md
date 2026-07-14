# Crux Local executable packaging fix

Status: **approved**

## Problem

The release workflow builds executable `crux` and
`crux-static-index-worker` binaries, then transfers them between jobs with
GitHub Actions artifacts. Artifact extraction normalizes files to mode `0644`.
The npm staging script copies those files without restoring executable bits, so
Linux and macOS platform packages can publish binaries that the Node wrapper
cannot launch.

The current staged-package validator checks that required binary paths are
present, but does not check their packed modes or execute an installed package.

## Design

The npm staging boundary will own the published-file-mode contract. After
copying a non-Windows platform bundle into its staged package, the stager will
set both the Go CLI and Rust static-index worker to mode `0755`. Windows `.exe`
files need no Unix mode normalization.

Staged-package validation will inspect `npm pack --dry-run --json` metadata and
reject any non-Windows CLI or worker without an executable bit. This checks the
mode npm will record in the tarball rather than only the source directory.

When the staged wrapper and the current host's platform package are both
present, validation will also:

1. Pack both packages into tarballs.
2. Install those tarballs offline into a temporary project.
3. Invoke the installed `crux --help` shim.

The smoke test must fail if packing, installation, wrapper resolution, binary
execution, or CLI help fails. Temporary artifacts are always removed.

## Tests

- Add a focused validator regression test proving a staged Unix platform
  package with `0644` binaries is rejected.
- Run the existing npm staging validator tests.
- Run a local full-platform staging fixture with host binaries to exercise the
  packed-install smoke test where practical.

## Release behavior

The fix applies centrally to stable and nightly publishing because both use the
same staging and validation scripts. The existing release workflow is scheduled
automatically at `03:17 UTC` each day, but its coordinator currently fails in
`actions/setup-node` because pnpm caching is initialized before pnpm is
available. That coordinator uses Node and npm but never pnpm, so disable
automatic package-manager caching on its `actions/setup-node` step. A scheduled
run then publishes a nightly build when `main` has a SHA not already represented
by the latest nightly version.

After publishing npm packages under the `nightly` dist-tag, the workflow creates
an immutable GitHub pre-release tagged with that exact nightly version and
targeted at the source SHA. GitHub release reconciliation runs separately from
npm publication. When npm already has a nightly for the current SHA, the
coordinator reuses that published version only if every package in the staging
set exposes the same version under the `nightly` dist-tag. A partial npm publish
therefore triggers a fresh full nightly instead of producing a GitHub release
for an incomplete package set. The coordinator still reconciles GitHub when a
complete npm nightly already exists, repairing a missing release after a prior
post-publish failure.

An existing release is accepted only when its tag resolves to the current source
SHA, it is marked as a pre-release, and it is published rather than draft;
mismatched metadata fails closed. A tag that exists without a release must also
resolve to the current source SHA before release creation. GitHub nightlies use
a short install note rather than stable changelog release notes.

This is a patch-level install/CLI behavior fix for `@use-crux/local`. A small
changeset records both the executable-package fix and the GitHub pre-release
visibility for automated nightlies. No Project Index or Quality cache identity
changes are needed.
