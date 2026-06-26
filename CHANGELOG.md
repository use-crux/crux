# Changelog

Human-friendly release notes for synchronized Crux releases. Package-specific changelogs live next to each package.

## 0.2.0

### Highlights

- Prepare the first npm release under the `@use-crux` package scope.

  Document the native AST beta parity gate, release checklist, and `experimental.indexer.nativeAst`
  troubleshooting guidance.

  Fix `make local` so the current-platform Rust/Oxc worker binary is replaced atomically when an old
  worker process is still running.
