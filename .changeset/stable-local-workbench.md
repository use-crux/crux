---
'@use-crux/core': minor
'@use-crux/indexer': minor
'@use-crux/convex': minor
'@use-crux/local': minor
---

Make TUI input routing deterministic so focused filters consume text before
workspace shortcuts, each key dispatches at most one action, and help plus pane
footers show only executable actions. Derive optional Dataset support from the
injected production client and keep unsupported screens out of navigation.
Preserve exact record identities across Overview drills and restore logical
route, pane focus, and stable selections when navigating Back.
Cancel in-flight Overview and Runs fetches and actions when the owning dev
command ends instead of leaving workflow work detached from shutdown.
Keep Runs list and detail reads revision-aware and selection-owned, preserve
complete observability detail when exporting, and reject late detail responses
from a previously selected run.
Keep the Runs list selection visible across paging, filtering, refresh, and
terminal resize, with keyboard and mouse-wheel navigation gated by pane focus.
Wrap and scroll long Runs span details with stable resize anchors, focused
line/page navigation, and a visible document position indicator.
Keep the selected Runs span visible while navigating or refreshing its
hierarchy, with focused line/page movement independent from detail scrolling.
Render a direct, diagnosis-oriented Runs detail with failure evidence,
diagnostics, activity, artifacts, events, and exact definition references;
keep complete raw observability records behind explicit inspect and export
actions.
Keep Runs readable across narrow, medium, and wide terminals using its actual
Workbench body bounds, prioritize diagnosis at medium widths, and show an
actionable resize message below the supported 60x20 terminal minimum.
Keep Overview insight and run selections visible across paging, refresh, and
resize; expose focused-pane actions and readable narrow navigation; and retain
pane-scoped last-good data when independent summary, insight, run, or activity
refreshes fail.
Make Project Index definitions and structured source details independently
scrollable, preserve exact selection and detail anchors across refreshes, and
retain last-good index data with an explicit degraded state when refresh fails.
Support tab-based pane traversal and control-key paging, sanitize indexed text
before terminal rendering, and report definition exports with portable names
without replacing usable Index data on export failure.
Open exact runtime definition references from Runs with `d`: navigate directly
for one destination or choose among multiple exact IDs in a bounded scrollable
modal. Show missing references explicitly in Project Index, never substitute a
same-named definition, and restore run, span, definition, pane, and viewport
location when navigating Back.
Select the interactive workbench only when stdin and stdout are capable
terminals outside CI and `TERM=dumb`, while keeping plain output free of
terminal control sequences. Browser launch is now explicit: use `--open` at
startup or `o` inside the workbench; the legacy `--no-open` flag is removed,
while `--tui` and `--no-tui` explicitly select a mode and reject conflicts.
Route command input, JSON output, diagnostics, worker logs, and subprocess
stderr through scoped injectable boundaries, propagating JSON write failures
without mutating the process-wide logger.
Unify dev-command, TUI, event-bridge, server, WebSocket, tunnel, watcher, and
worker shutdown under one cancelable session with idempotent bounded cleanup.
Clean `q` and raw TUI Ctrl+C exit `0`, process SIGINT exits `130`, and SIGTERM
exits `143`; signal status wins
over reported cleanup failures, expected cancellation stays silent, and a
second signal terminates immediately.
Render the TUI immediately after listener binding while runtime preflight,
Project Index, and runtime-artifact warmup continue under owned cancellation.
Replay typed startup diagnostics such as `RUNTIME_HOST_ONLY` in the workbench,
buffer edits made during the initial index, retry a failed baseline on the next
edit, and prevent delayed terminal capability replies from leaking into the
shell. Preserve graceful cleanup and exit status through the npm launcher.
Allow ordinary callable Evals and adapter-managed Evals to coexist without
placement flags: Crux derives execution per Current/Variant arm, keeps
coordinator-only Evals out of deployed host artifacts, and validates exact
host requirements before paid work. Generate Runtime files through one
preflighted, atomic, manifest-last pipeline with complete structured findings.
Make `crux setup` dry-run generated-file freshness and make
`crux setup --apply` re-inspect before safely refreshing files; `crux dev`
continues serving while background generation reports and retries failures.
Preserve existing Convex routers that already call `crux.bridge(...)`, with the
bridge registering authenticated Eval routes automatically. The local Runtime
artifact manifest moves to v2 while the authenticated host wire remains v1.
Index Eval placement in a bounded runtime-rich pass for setup, one-shot
generation, and watcher refreshes, and treat host-bound preflight as
metadata-only instead of executing host-only functions from the local CLI.
