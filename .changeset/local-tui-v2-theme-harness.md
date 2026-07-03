---
"@use-crux/local": patch
---

Migrate the local TUI to the Bubble Tea/Lip Gloss/Bubbles v2 stack, centralize terminal colors in the shared theme palette, add deterministic TUI golden/resize test harness coverage, and introduce the rect-based TUI kit layout, virtualized list/table, memo, and component primitives used by the rebuilt shell and legacy screen adapters.

Add the coalescing in-process TUI reactivity bridge with revision-tagged domain routing, hidden-screen stale marking, quality insight/cassette drift event coverage, and fixes for v2 text input and CLI color gating regressions.

Rebuild the Runs screen on rect-based kit layout with responsive full/two/single breakpoints, run filtering, duplicate-span collapse/expand behavior, deterministic Runs goldens, and resize-fuzz coverage.

Rebuild the Overview screen around the rect-based kit layout with responsive two-pane rendering, pass-rate baseline charting, live activity scroll latching, refreshed goldens, and focused resize-fuzz coverage.

Rebuild the Insights screen on the rect-based kit layout with a virtualized insight list, responsive single/two-pane rendering, tabbed diagnosis/detail/fix panes, deterministic goldens, and resize-fuzz coverage. Unsupported insight actions without service-backed DataClient methods are no longer silently stubbed.

Rebuild the Experiments screen around the kit table/matrix/diff/progress primitives with running-experiment progress, promotion-ready detail rendering, JSON export fallback, deterministic goldens, and resize-fuzz coverage. Unsupported experiment actions without current service or screen surfaces are hidden for follow-up.

Rebuild the Cassettes, Feedback, and Baselines screens with deterministic fixture data, goldens, and resize-fuzz coverage. Cassettes now surfaces read-only stats and drift context from available cassette summaries, Feedback dismiss writes through the existing annotation status surface, and Baselines can open source experiments or replace a baseline through the existing promote path while deferred Compare actions stay hidden.

Add the Datasets TUI screen with fixture-backed dataset/case/editor rendering, local dirty tracking, undo/discard behavior, in-memory duplicate/assertion edits, deterministic goldens, and resize-fuzz coverage. Service-backed suite/case save and trace-derived case creation remain hidden until the dataset write surface is added.

Route CLI command styling and live terminal control through the shared output IO gate, add a guard test for direct command `.Render()` calls, and keep command table rendering behind output-owned helpers so no-color and piped output stay ANSI-clean.
