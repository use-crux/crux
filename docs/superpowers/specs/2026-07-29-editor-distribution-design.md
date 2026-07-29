# Editor extension distribution design

Date: 2026-07-29
Status: approved

## Outcome

Crux distributes one version-matched VSIX through each GitHub Release. Visual
Studio Code and Cursor users can install it either from their editor or with
the Crux Local CLI:

```bash
crux editor install vscode
crux editor install cursor
```

Marketplace and Open VSX publication are intentionally out of scope. The
GitHub Release is the authoritative extension distribution channel.

## Release contract

A completed stable or nightly GitHub Release contains exactly:

- `crux-vscode-<version>.vsix`;
- six platform-native Crux Local archives;
- `SHA256SUMS`, covering the VSIX and six archives.

Asset bytes are immutable once published. A retry may add a missing asset when
all existing assets match the staged identities. Conflicting or unexpected
assets fail closed.

Staging and validation happen before npm publication. Reconciliation reads the
same validated asset model as staging instead of reconstructing a subtly
different model. Tests exercise a fresh release, an idempotent retry, repair of
missing assets, checksum conflicts, unexpected assets, and the exact workflow
ordering. A release without the complete matrix is a failed release.

## CLI surface

`crux editor` groups editor integration commands. The initial command is:

```text
crux editor install <vscode|cursor> [--download-only <directory>]
```

The editor argument is required. Crux does not mutate every detected editor
implicitly.

The installer uses the running root command version as its sole version
authority. It refuses development versions and never falls forward or backward
to another release. It derives these immutable URLs:

```text
https://github.com/use-crux/crux/releases/download/v<version>/SHA256SUMS
https://github.com/use-crux/crux/releases/download/v<version>/crux-vscode-<version>.vsix
```

It downloads both files with bounded HTTP reads and request timeouts, accepts
only a checksum row for the exact expected VSIX filename, verifies SHA-256
before any editor process starts, and writes through a private temporary
directory. Errors contain actionable context without printing response bodies
or temporary paths.

Normal mode resolves `code` or `cursor` from `PATH`, then invokes:

```text
<editor> --install-extension <verified-vsix> --force
```

The child inherits normal output streams so the editor owns its installation
result. A missing executable, failed download, malformed checksum file,
checksum mismatch, or nonzero editor exit is an error. Temporary files are
removed after success or failure.

`--download-only <directory>` atomically copies the verified VSIX to the
selected directory and does not require or execute an editor. Existing files
are not overwritten with different bytes. This supports remote, managed, and
offline editor installation.

Dependencies are injected behind a small internal installer boundary so tests
use an HTTP test server and fake editor executable rather than the network or a
real user profile.

## Editor compatibility and presentation

The VSIX keeps Visual Studio Code `^1.90.0` as its explicit engine contract.
The same VSIX is used by Cursor through its VS Code extension compatibility
surface. Release evidence distinguishes:

- real Visual Studio Code extension-host behavior;
- successful VSIX packaging and metadata inspection;
- Cursor CLI installation when Cursor is available in the release
  environment;
- a retained manual Cursor smoke row otherwise.

Documentation must not claim marketplace availability, automatic extension
updates, or stronger Cursor runtime evidence than was actually collected.

The extension package description, README, and user-facing editor guide lead
with the user outcome: Markdown-aware PromptText authoring inside TypeScript
without replacing TypeScript language intelligence. They surface:

- mapped Markdown highlighting and folding around interpolation barriers;
- safe static preview with placeholders;
- explicit runtime-backed exact preview;
- latest captured Run navigation and provenance;
- hard composition diagnostics and conservative quick fixes;
- Catalog evidence and Run Detail presentation.

The guide contains separate VS Code and Cursor install, upgrade, verification,
and uninstall steps, plus the CLI installer and manual VSIX fallback.

## Verification

Implementation follows vertical TDD slices:

1. A release reconciler test reproduces the current staged-directory mismatch,
   then proves staging, validation, and reconciliation share one asset set.
2. A command test proves exact version-to-URL selection and a verified VSIX
   reaches a fake editor.
3. Additional command tests cover both editors, missing releases, malformed and
   mismatched checksums, nonzero child exits, bounded downloads, cleanup, and
   download-only behavior.
4. Package metadata and documentation tests prove the intended distribution
   and value statements remain present.
5. The final gate builds and inspects the VSIX, runs the real Visual Studio Code
   extension-host suite, runs relevant Go tests with the race detector, runs
   release-script tests, builds docs, and checks the complete repository diff.

After the branch is pushed, every required pull-request check is polled until
green. The merged release workflow remains the final authority for external
asset publication.
