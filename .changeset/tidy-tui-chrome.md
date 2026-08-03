---
"@use-crux/local": minor
---

Improve TUI framing and per-screen readability with identifiable, title-first insight and run rows, semantic KPI delta colors, accented active breadcrumbs and insight categories, correct count pluralization, hanging detail values, project-relative source locations, actionable empty states, visible truncation, centered content-sized overlays, complete navigation, and single-line pane headers and breadcrumbs. Export the node-basic named defer target so the authored example boots without a target-export diagnostic.

Keep input responsive during large Index refreshes, preserve filtered Runs lists across navigation, clarify that model filters apply to the loaded Runs page, show Insights case-evidence lifecycle details, confirm when startup finds no issues, and replace the shutdown ingest-token secret with its file path and read command.

Make audited TUI interactions honest and reversible: preserve Overview drill history, document and execute Insights actions, expose jump-prefix guidance, refresh dismissed insights, confirm run exports, unify document scrolling, prioritize browser failures, mark active tabs without relying on color, anchor lint drills, clarify filter clearing, and collapse repeated demo tool spans.

Render modal overlays as true rectangles that preserve the base frame outside their bounds while isolating ANSI style state at both seams, and standardize the Runs time-window label as lowercase `last 1h`.

Deepen Runs detail with primitive-aware request, PromptText, decision, tool, memory, media, flow, timing, cost, and member-run evidence; add failure-path triage with `e`/`E` stepping and bounded terminal-safe payload expansion.

Deepen the Index Catalog with schema field trees, complete lint evidence, navigable relation columns, agent and flow summaries, PromptText provenance, per-definition runtime activity, indexing/watch status, kind/file grouping, and consistent `x` exports.

Make the Runs list operationally useful with bounded token/cost rollups, model and abnormal-health columns, child topology, server-side status/session/window filters, model refinement, stable primitive/target/session grouping, real session labels, and aggregate group headers.

Turn Overview into an operational dashboard with Stats-backed pass-rate, cost, and latency series, an honest Stats-derived cost KPI, conditional mean score, run-count jump chips, failure-filter navigation, and session-aware recent runs.

Keep Runs interactions responsive at thousand-run scale by coalescing detail reads and memoizing stable list projections. Make Overview and `crux stats` aggregate the complete observability history through a shared revision-aware snapshot instead of silently truncating their inputs.

Add an Evals workbench with catalog readiness, a navigable Case-by-Variant result grid, reusable-evidence detail, local Runs drill-through, run history, and committed Baseline compatibility. Join Insights Cases to the same persisted Eval evidence, and expand the deterministic Local demo with a mixed 3-by-2 Eval matrix and Baseline.

Unify TUI surfaces and pane seams across every screen, replace noisy braille trends with honest block-ramp sparklines, add terminal-safe TypeScript and JSON syntax color, and renumber navigation in visual order.

Keep navigation and terminal quit responsive while a hard Project Index refresh and workspace cleanup are wedged. Quit now restores the terminal before cleanup, repeated quit requests remain effective, and the command root bounds every cleanup join. Coalesce cursor-detail work to the final position in an input burst, derive Runs requests, filter labels, and visible rows from one filter state, and let `R` discard local derivations before an authoritative reload.

Use the same Eval catalog discovery mode and short-lived shared result cache as `crux eval list`, defer Node discovery until Project Index startup settles, show elapsed loading progress, surface readable timeout failures within 30 seconds, and provide an on-screen retry action.

Keep large-project Eval discovery out of contended multi-worker semantic waves, and give discovery a fresh bounded window after startup waiting so the first post-startup retry can populate the shared catalog cache.

Correct the TUI capture walk so Evals uses screen key `4` and Index uses screen key `5` in both tmux text captures and generated VHS tapes.
