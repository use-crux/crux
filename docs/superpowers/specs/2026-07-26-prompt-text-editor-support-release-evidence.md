# PromptText editor release evidence

Date: 2026-07-29
Host: Linux amd64, Intel Core i7-1360P
Build profile for worker measurements: Rust dev

This appendix records repeatable release evidence for the PromptText editor
surface. Binding behavior remains in
[contracts.md](2026-07-26-prompt-text-editor-support/contracts.md).

## Shared conformance

`packages/indexer/__tests__/fixtures/prompt-text-editor-conformance-v1.ts` is
the sole authored source for the final cross-layer fixture. Its sidecar freezes
the source hash, Rust V1 response, JavaScript semantic source ref and
diagnostics, and Go-derived views.

The fixture proves canonical direct, aliased, and namespace identities and
suppresses a local lookalike tag. It includes every decoration role, nested
blocks, a safe literal link, interpolation barriers, malformed and invalid
candidates, CRLF, astral and combining Unicode, static preview, all three
diagnostics, and all three available quick fixes.

The focused cross-language gate is:

```bash
cargo test -p crux-indexer-static-compiler \
  one_document_matches_the_shared_editor_conformance_analysis
(cd packages/local && go test ./internal/lsp/prompttext \
  -run SharedEditorConformance -count=1)
pnpm --dir packages/vscode exec vitest run \
  src/prompt-text/mapping.test.ts
pnpm --filter @use-crux/indexer exec vitest run \
  __tests__/prompt-text-editor-architecture.test.ts \
  __tests__/prompt-text-editor-conformance.test.ts \
  __tests__/semantic-backend-parity.test.ts \
  -t 'architecture|conformance|prompt-text-diagnostic-conclusions'
```

All commands pass. Six concurrent Go consumers—decorations, folding, symbols,
links, static preview, and diagnostics—produce one compiler call. Regenerated
actions reuse that accepted identity and yield `.join(", ")`, the
Rust-proven line-isolation edit, and `md.json()` serialization.

## Stress and lifecycle matrix

The following rows are executable tests, not manual exemptions:

| Scenario                                                                   | Durable evidence                                                                                                                 |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Rapid edits, same-version hash mismatch, cancellation, out-of-order result | `packages/vscode/src/prompt-text/controller.test.ts`                                                                             |
| Close/reopen and document-version reuse                                    | `packages/vscode/src/prompt-text/document-revisions.test.ts`, `packages/local/internal/lsp/prompttext/folding_lifecycle_test.go` |
| Save-generation handover and reindex gap                                   | `packages/local/internal/lsp/server/workspace_prompt_text_view_test.go`, `prompt_text_diagnostic_source_test.go`                 |
| Concurrent providers and coordinator reuse                                 | shared Go conformance test and `folding_shared_test.go`                                                                          |
| Worker streaming order and worker-pool concurrency                         | `packages/local/internal/projectindex/staticindex/frontend/worker_test.go`                                                       |
| Cancellation, reconnect, disconnect, and late ATTACHED result              | `packages/local/internal/runtimebridge/preview_service_test.go`, VS Code preview lifecycle/race suites                           |
| Large and malformed CommonMark                                             | Rust `performance_cases.rs` and `structure_cases.rs`                                                                             |
| Setting off, theme transition, disposal                                    | VS Code controller/type tests and the extension-host theme artifact                                                              |
| Sensitive input/output, failure, and transport privacy                     | Runtime Bridge preview privacy tests and Local PromptText route security tests                                                   |

Go race coverage runs over LSP, Project Index, Runtime Bridge, Devtools, and
server packages in the final acceptance command.

## Performance

The shared 1,453-byte fixture produces 29,134 compact analysis bytes
(`wc -c` includes one pipeline newline). A persistent debug worker measured:

| Workload                                             |      Elapsed | Maximum RSS |
| ---------------------------------------------------- | -----------: | ----------: |
| One shared-fixture request including process startup |       0.06 s |  18,320 KiB |
| 100 shared-fixture requests                          | 4.23 s total |  18,556 KiB |

Go projections were measured with:

```bash
(cd packages/local && go test ./internal/lsp/prompttext -run '^$' \
  -bench PromptTextSharedConformanceViews -benchmem \
  -benchtime=2s -count=3)
```

| Projection                               |   Median | Bytes/op | Allocs/op |
| ---------------------------------------- | -------: | -------: | --------: |
| Cold decoration with a new coordinator   |  58.0 µs |   20,006 |       178 |
| Five warm views from one cached analysis | 172.0 µs |   89,234 |       834 |

The warm run reports a 100% coordinator hit rate and performs no compiler
calls after priming. Five cancellation samples completed in 8.2–36.8 µs; the
durable fail-closed test permits one second to avoid scheduler-sensitive CI
failures.

The first 132,701-byte/2,048-heading probe exposed repeated source-map
construction and linear mapping lookup: 63.02 seconds in the debug worker.
The range mapper now reuses one line index and uses binary mapping lookup.
After the fix the same probe takes 0.20 seconds and 21,436 KiB maximum RSS.
The scaling curve is:

| Headings | Request bytes | Elapsed |
| -------: | ------------: | ------: |
|      128 |         8,773 |  0.02 s |
|      256 |        16,965 |  0.05 s |
|      512 |        33,349 |  0.10 s |
|    1,024 |        66,141 |  0.10 s |
|    2,048 |       132,701 |  0.20 s |

`large_commonmark_projection_stays_within_the_release_budget` retains a
conservative 10-second debug-build ceiling—50 times the measured result—while
also proving whole-template truncation at the output limit.

## Bounded defaults

Measured results leave the contract defaults conservative: 2 MiB document,
256 templates, 256 KiB per template, 100,000 syntax nodes, 1 MiB response and
preview, 256 fragments and joins, 64 KiB aggregate fragment evidence, and
depth 16. Equality fits each byte bound. Overflow fails closed or retains only
the contract-defined complete source-order prefix; it never publishes a
partial template or hidden preview bytes.

## Theme and native TypeScript behavior

The four-theme visual and extension-host matrix is retained in
`packages/vscode/test-artifacts/prompt-text-decoration-theme-evidence.md`.
It covers semantic highlighting on and off, selection, cursors, diagnostics,
completion, hover, definition, rename, brackets, interpolation isolation,
edit clearing, theme transition, and the client-only off switch. Theme changes
perform zero decoration replacements, clears, or repulls.

## Manual-gate disposition

Evidence date: 2026-07-29. Visual and extension-host evidence uses VS Code
1.90.2 on Linux.

The manual gate is evidence-relative. Its genuinely visual requirement is
rendered legibility, distinguishability, cursor/selection/diagnostic
visibility, and visible repaint or flicker across the four supported themes.
Deterministic state and transport behavior is proved by repeatable automated
workflow suites rather than a one-off walkthrough.

| Manual-gate row                                                                                                                                   | Durable disposition                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dark+, Light+, High Contrast Dark, High Contrast Light; cursor, selection, diagnostics, interpolation isolation, no-reload transition, off switch | Retained real-editor visual artifact: `packages/vscode/test-artifacts/prompt-text-decoration-theme-evidence.md`                                                                                                                  |
| Semantic highlighting on/off; completion, hover, definition, rename, brackets, interpolation selection                                            | Real VS Code 1.90.2 extension-host command/result assertions in `packages/vscode/test/suite/`                                                                                                                                    |
| Static-preview content, copy equality, reuse, edit refresh, reconnect, rename, split, and close                                                   | Real extension-host static-preview suite plus `packages/vscode/src/prompt-text/preview/` lifecycle and wire tests                                                                                                                |
| Explicit exact preview and unavailable runtime                                                                                                    | Core `prompt-preview-exact` dispatch/transport/privacy suites; Local Runtime Bridge and `promptpreview` route/security race suites; LSP/VS Code exact-link suites; Devtools `prompt-preview` workflow/lifecycle/component suites |
| Latest Run and no-Run state                                                                                                                       | SQLite latest-definition ordering tests; Local `promptlatest` service/route/security and LSP suites; VS Code latest-link/command suites; Devtools `prompt-latest-run` resolver/refresh/empty-state suites                        |

No application runtime peer was created, no workspace or trusted Prompt
callback was invoked, no observability was ingested through a production
endpoint, and no ordinary Run was manufactured for release evidence.
Test-owned callbacks and disposable in-memory or temporary-SQLite records are
bounded fixtures and do not affect application data or production semantics.
