# Editor release asset smoke checklist

Run this checklist against the final GitHub Release after its immutable assets
have been reconciled. Use a stable release normally; for a nightly, select the
prerelease whose notes name the source commit being tested.

Record the release URL, version, source commit, operating system, architecture,
and editor version with the result. The VSIX and native archive must come from
the same release version.

## Every platform

1. Download `SHA256SUMS`, `crux-vscode-<version>.vsix`, and exactly one matching
   native archive:
   - Linux: `crux-<version>-linux-x64.tar.gz` or
     `crux-<version>-linux-arm64.tar.gz`
   - macOS: `crux-<version>-darwin-x64.tar.gz` or
     `crux-<version>-darwin-arm64.tar.gz`
   - Windows: `crux-<version>-win32-x64.zip` or
     `crux-<version>-win32-arm64.zip`

2. Verify both downloaded payloads against their exact `SHA256SUMS` rows. A
   mismatch is a release failure; do not extract or install the files.
3. Extract the archive. Confirm its one top-level directory contains only the
   sibling `crux` and `crux-static-index-worker` executables (`.exe` on
   Windows). Do not separate them.
4. Run the extracted `crux --version` and confirm it reports the release
   version.
5. Prove the version-locked CLI path in the editor being tested:

   ```bash
   crux editor install vscode
   # or
   crux editor install cursor
   ```

   Confirm the command downloads the release under test and reports the exact
   release version. For an independent manual seam, install the downloaded
   VSIX using **Extensions: Install from VSIX...** or:

   ```bash
   code --install-extension crux-vscode-<version>.vsix
   cursor --install-extension crux-vscode-<version>.vsix
   ```

   Record at least one successful Visual Studio Code result and one successful
   Cursor result before a stable release is considered editor-smoke complete.

6. Open `packages/local/internal/lsp/testdata/fixture-project` as a trusted
   workspace. Set `crux.binaryPath` to the extracted CLI and reload the editor.
7. Open the Crux output channel. Confirm it names the expected CLI version and
   reports language-server startup without a binary-discovery error.
8. Open a fixture TypeScript file and confirm Crux diagnostics appear. Open a
   canonical Core `md` template and confirm Markdown roles stop at interpolation
   boundaries. Run **Crux: Restart Language Server** and confirm both return.
9. Record that the extension and direct-download binary do not advertise or
   perform an automatic update; upgrades require installing both newer
   lockstep assets.

## Platform-specific checksum commands

Use the actual downloaded filenames in place of the placeholders.

Linux:

```bash
grep '  crux-<version>-linux-x64.tar.gz$' SHA256SUMS | sha256sum -c -
grep '  crux-vscode-<version>.vsix$' SHA256SUMS | sha256sum -c -
```

macOS:

```bash
grep '  crux-<version>-darwin-arm64.tar.gz$' SHA256SUMS | shasum -a 256 -c -
grep '  crux-vscode-<version>.vsix$' SHA256SUMS | shasum -a 256 -c -
```

Windows PowerShell:

```powershell
$file = "crux-<version>-win32-x64.zip"
$expected = ((Select-String -Path SHA256SUMS -Pattern "  $file$").Line -split "  ")[0]
(Get-FileHash -Algorithm SHA256 $file).Hash.ToLower() -eq $expected
```

Repeat the PowerShell check with `crux-vscode-<version>.vsix`.

## Automated evidence before publication

CI runs `pnpm release:assets:test`, which stages the stable/nightly matrix from
fixtures, byte-compares repeat builds, opens every archive and the VSIX, checks
paths and executable modes, validates the lockstep version and public metadata,
and exercises negative checksum/manifest cases. The manual checklist proves the
remaining GitHub download, operating-system launch, and editor-host seams.
