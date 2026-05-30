# Crux TUI · V1 Panels Redesign — Implementation Plan

Scope: the Bubbletea TUI that runs when `crux dev` starts. The React devtools UI, the `crux quality *` CLI command output, and the other top-level CLI commands are explicitly **out of scope** for this pass.

Design source: `Crux CLI - V1 Panels.html` + `tui-v1-{shell,screens-a,screens-b,screens-c}.jsx` from the Claude Design bundle at `https://api.anthropic.com/v1/design/h/-AUkRYp-gJMVJ5mgHT9wPg`. Extracted locally under `/tmp/crux-design/crux-cli/`.

---

## 1. Target shape

A persistent, full-screen TUI with:

- **Top tab strip**: `quality · traces · eval · shell` (only `quality` is fully designed; others get the chrome and a "coming soon" body for now)
- **Left nav rail** (9 items in the `quality` tab): `1 overview · 2 insights · 3 runs · 4 experiments · 5 compare · 6 datasets · 7 baselines · 8 feedback · 9 cassettes` with live counts
- **Body**: per-screen three-pane layout (list → detail → side-detail)
- **Bottom status bar**: mode chip (`NORMAL` / `INSERT` / `COMMAND`) + contextual keybind hints + `.crux/quality` working dir
- **Two overlays**: `:` command palette · `?` help / keybinds cheat-sheet

Visual language: Crux dark + teal (palette from `tui-shared.jsx`: `bg #0a0c0b`, `panel #0f1311`, `text #d5dcd8`, `teal #5eead4`, `amber #fbbf24`, `rose #fb7185`, `violet #a78bfa`, `green #86efac`). JetBrains Mono. Box-drawing characters for hierarchy. No rounded corners inside panes.

Modes:

- **NORMAL** (default): `j/k` move · `h/l` pane · `↵` open · single-letter actions (`s` save · `r` run · `c` compare · `p` promote · `x` dismiss) · `g {letter}` jump · `/` search this pane · `:` palette · `?` help · `1-9` jump to nav rail item
- **INSERT** (case/prompt/config edit): `esc` → NORMAL · `^s` save · `^z` undo · `tab` next field · `^↵` run in-place
- **COMMAND**: `:` opens palette · `↵` run · `esc` close · `^r` history · `tab` complete

Keybinds remappable via `.crux/keybinds.toml` (V1: design the schema, leave the loader as a follow-up).

---

## 2. Make TUI the default for `crux dev`

Current: `--tui` opt-in flag at `packages/cli/internal/commands/dev.go:236`.

Change: invert the default. The TUI and the web UI are independent surfaces and can run concurrently against the same dev server — they're not mutually exclusive.

- `crux dev` → starts the server **and** launches the TUI; browser also opens unless `--no-open`
- `crux dev --no-tui` → starts the server only, no TUI (current default behavior)
- `crux dev --no-open` → skip browser auto-open (orthogonal to `--no-tui`; you can combine them)
- `--tui` flag stays as a deprecated no-op for backwards compatibility, with a note in the flag help text

The user's question "the quality command is to run / execute quality things (right??)" — yes. `crux quality runs|suites|insights|experiments|comparisons|baselines|feedback|cassettes` are headless/CI-friendly commands that hit the same `/api/quality/*` BFF the TUI will use. They share `internal/api/types.go` records, so no duplication. The TUI is just the interactive surface over the same endpoints.

---

## 3. File layout

```
packages/cli/internal/tui/
├── app.go                       # root Bubbletea model (refactored)
├── modes.go                     # NORMAL/INSERT/COMMAND state + transitions
├── styles.go                    # extended Crux palette + lipgloss helpers
├── keybinds.go                  # keymap definition + .crux/keybinds.toml loader stub
├── shell/
│   ├── chrome.go                # title bar (terminal-style traffic lights + crux quality)
│   ├── tabs.go                  # top tab strip (quality · traces · eval · shell)
│   ├── navrail.go               # left nav rail + counts + target/baseline footer
│   ├── statusbar.go             # bottom bar: mode chip + keybind hints + path
│   ├── breadcrumb.go            # per-screen breadcrumb header
│   └── pane.go                  # generic 3-pane layout + Pane/ListRow/ActionBar primitives
├── screens/
│   ├── overview.go              # KPI strip + insights queue + recent runs + ASCII pass-rate chart + activity log
│   ├── insights.go              # 3-pane: list · diagnosis tabs · proposed fix
│   ├── runs.go                  # 3-pane: run list · trace waterfall · selected-span detail
│   ├── experiments.go           # 2-pane: experiment list · variants × metrics matrix + config diff
│   ├── compare.go               # 2-pane: case list with status pills · side-by-side output+trace diff
│   ├── datasets.go              # 3-pane: dataset list · cases · case editor (with INSERT mode)
│   ├── baselines.go             # 2-pane: baseline list · linked experiment + history
│   ├── feedback.go              # 2-pane: feedback inbox · detail + actions
│   └── cassettes.go             # 2-pane: cassette list · entries + drift detail
├── overlays/
│   ├── palette.go               # `:` command palette (fuzzy filter, history, completion)
│   └── help.go                  # `?` help / keybinds cheat-sheet
├── components/
│   ├── chip.go                  # severity/status pills
│   ├── sparkline.go             # box-character + braille sparkline rendering
│   ├── statusdot.go             # pass/fail/warn/new/skip/run glyphs
│   ├── asciichart.go            # multi-row line chart for Overview
│   ├── waterfall.go             # trace span waterfall renderer (used by Runs + Compare)
│   └── matrix.go                # variants × metrics table (used by Experiments)
└── messages.go                  # tea.Msg types (existing — extend)
```

The existing `view_dashboard.go`, `view_catalog.go`, `view_boot.go`, `detail.go`, `tree.go` stay until the migration is done — the new `screens/runs.go` supersedes the old dashboard's trace tree once it's wired.

---

## 4. Data flow

Every screen uses the existing `internal/api.Client` to hit `/api/quality/*`. No new HTTP layer.

- Initial load on TUI boot: one fetch per active screen's endpoint (parallel `tea.Cmd`).
- Live updates: existing WebSocket (`internal/api.WSClient`) routes events to the TUI via `wsEventMsg`. Add filtering: only re-fetch the active screen's endpoint(s) when relevant events arrive. The Overview screen subscribes to all event kinds for the activity log.
- All Quality records mirror the Go types in `internal/api/types.go` (already in sync with the design's data needs).
- Command palette actions either:
  - Call existing HTTP endpoints (e.g. `POST /api/quality/insights/{id}/status` for dismiss)
  - Or invoke the `crux quality` cobra subcommand (e.g. `:promote exp-043:maxIter+dedupe` → `crux quality promote`). For V1, simpler to shell out to the local server's RPC.

---

## 5. Screen-by-screen implementation notes

### Overview (`screens/overview.go`)
- 4-column KPI strip with sparklines: open insights · pass rate · cost/100 runs · p95 latency
- 2-column body: left = top-insights list + recent-runs list (stacked); right = ASCII pass-rate chart + activity log
- ASCII chart: 7-row line chart over `passRateHistory` (last 14 days)
- Activity log: timestamped event stream from WS, color-coded by kind (trace/insight/experiment/cassette/feedback)

### Insights (`screens/insights.go`)
- Left pane: insights list with severity dot, ID, tag chip, title, target, traces count, dt-ago, mini sparkline
- Right pane: tabs (Diagnosis · Traces · Cases · Compare · Fix) over the selected insight; diagnosis shows pattern pre-block + 3 stat cards (tokens/run, latency p95, cost/100); proposed fix shows config YAML
- Action bar: `t` open traces · `s` save cases · `r` run variant · `c` compare · `p` promote fix · `x` dismiss

### Runs (`screens/runs.go`)
- Left pane (width 260): run list with status dot, id, flow, lat, tok, ago
- Center pane: trace waterfall over `/api/quality/runs/{traceId}` — uses `spans` array
  - Time ruler at top (0s … total)
  - Indented span rows: glyph + op color-coded + name + duration bar + duration
  - Duplicate spans flagged with `· dup` marker in rose
- Right pane (width 340): selected span detail — identity, timing, cost, attributes pre-block, linked insights
- Action bar: `↵` expand · `o` open in viewer · `f` flame chart · `t` timeline · `e` export

### Experiments (`screens/experiments.go`)
- Left pane (width 460): experiment table with status, ID, flow, dataset, ×variants, pass%, cost, ago
- Right pane: progress strip (running experiments) + variants×metrics matrix + variant config diff vs baseline
- Action bar: `↵` open variant · `c` compare 2 · `p` promote winner · `r` re-run · `e` export csv · `n` new exp

### Compare (`screens/compare.go`)
- Left pane (width 420): case list with status pill (regressed/new-fail/fixed/improved/unchanged) + base→cand score
- Right pane: 2×2 grid — top row is baseline-vs-candidate header; bottom row is split output diff + split trace diff
- Action bar: `o` only diffs · `s` save as case · `p` copy prompt · `r` re-run · `c` copy to clipboard

### Datasets (`screens/datasets.go`)
- 3 panes: dataset list · cases list · case editor
- Case editor (INSERT mode): tags chips · Input pre-block · Expected (rubric) pre-block · Assertions table · Metadata
- Action bar: `^s` save · `^z` undo · `r` re-run case · `d` duplicate · `x` delete · `esc` NORMAL

### Baselines (`screens/baselines.go`)
- Left pane: baseline list (id, target, experiment, variant, dataset snapshot, promoted-at, summary score)
- Right pane: baseline detail — linked experiment, dataset snapshot, previous baseline history, latest comparison
- Action bar: `c` compare latest · `R` replace baseline · `o` open experiment

### Feedback (`screens/feedback.go`)
- Left pane: feedback inbox (rating, comment preview, linked trace/output, tags, status, created-at)
- Right pane: trace/output context · feedback comment · suggested expected · review notes
- Action bar: `s` save to dataset · `l` link to case · `m` create memory proposal · `x` dismiss

### Cassettes (`screens/cassettes.go`)
- Left pane (width 360): cassette list with drift glyph, name, age, entries, size, mode
- Right pane: 4-stat header (entries, hit rate, missing, mismatch) · entries/drift/history tabs · entries table · drift detail block
- Action bar: `R` re-record selected · `p` play once · `x` prune missing · `e` edit entry · `d` diff vs main

### Command palette (`overlays/palette.go`)
- Modal overlay opened by `:`; closes on `esc`
- Fuzzy filter (sort by prefix-match score, then substring)
- Built-in commands: `compare`, `promote`, `run`, `open trace`, `save insight … --as-cases`, `cassette record`, `target`, `baseline pin`, `set keybind`, `goto {overview|insights|runs|…}`
- History at `~/.cache/crux/palette-history` (file-backed, `^r` to recall)
- Tab completion: complete subcommand and argument enums (e.g. variant ids from current experiment)

### Help overlay (`overlays/help.go`)
- Modal opened by `?`; closes on `esc` or `?`
- Six groups (Move, Navigate, Act, Shell, Insights/Compare, Editor) — same content as `tui-v1-screens-c.jsx::V1Help`
- Type-to-fuzzy-filter the visible items
- Footer shows `.crux/keybinds.toml` path and `:keybind set` hint

---

## 6. Implementation order

1. **Shell + tabs + navrail + statusbar + breadcrumb** — empty body panels, so the chrome stands up first and every screen plugs into the same shell.
2. **Components** (chip, sparkline, statusdot, asciichart, waterfall, matrix) — pure render functions, easy to unit-test.
3. **Overview** — anchors the design and proves end-to-end data flow (parallel fetches + WS activity tail).
4. **Runs + trace waterfall** — the most novel piece. The component will be reused in Compare.
5. **Experiments** + matrix component.
6. **Insights** (depends on richer record fields — see backend gaps §7).
7. **Compare** (reuses waterfall).
8. **Cassettes** · **Feedback** · **Baselines** — straightforward 2-pane screens.
9. **Datasets** — most complex because of INSERT mode and assertion editor.
10. **Command palette** + history.
11. **Help overlay** + keybinds.toml schema.
12. **Make TUI default for `crux dev`** + `--web` flag.

Each step is its own PR-sized commit so the user can ride along.

---

## 7. Backend gaps — what must exist before I can build the UI faithfully

Listed in priority order. Items marked **blocker** mean the screen cannot reach design parity without them; **stub-ok** means I can render with placeholder data and degrade gracefully if absent.

### A. Overview screen

1. **`passRateHistory: float[]`** on `QualityOverviewRecord` — last 14 days, daily pass-rate values for the ASCII chart. **blocker** for the chart (otherwise: hide the chart panel).
2. **`p95LatencyMs: *float64`** on `QualityOverviewRecord` (already have `p50LatencyMs`). **blocker** for the KPI.
3. **`costPer100Runs: *float64`** on `QualityOverviewRecord` (computed: `totalCost / runCount * 100`). Can compute client-side as fallback — **stub-ok**.
4. **KPI sparklines** — `runCountHistory`, `costHistory`, `latencyHistory` arrays (last N intervals). Without these we can't render the 4 KPI sparklines. **blocker** for sparkline fidelity (otherwise: just the number, no sparkline).
5. **`/api/quality/activity`** endpoint (or extend WS to publish a typed `QualityActivityEvent` stream): `{ timestamp, kind: 'trace'|'insight'|'experiment'|'cassette'|'feedback'|'dataset', summary: string, refId: string }`. **blocker** for the live activity log; without it we tail the existing untyped WS events and approximate.

### B. Insights screen

6. **`occurrenceCount: int`** on `QualityInsightRecord` (the design says "10 occurrences"). **stub-ok** — derive from `len(linkedTraceIds)`.
7. **`trend: []float`** on `QualityInsightRecord` — sparkline values for the list-pane mini-chart and the detail-pane stat cards. **blocker** for the visual; without it the sparkline is hidden.
8. **`proposedFixConfig: { yaml?: string; configKeys?: []string }`** on `QualityInsightRecord` — currently `ProposedFix` is plain string. **stub-ok** — render the plain string in a pre-block. Optional improvement: structured fix for syntax highlighting.
9. **`detailStats`** on insight: `{ tokensPerRun, latencyP95, costPer100, baselineDelta }` for the three detail stat cards. **blocker** for the detail panel's stat row.

### C. Runs / Trace waterfall

10. **`/api/quality/runs/{traceId}`** returning `QualityRunDetailRecord` — already exists (`api/types.go:514`). ✅ no change needed.
11. **`QualityRunSpan.Op`** — typed classifier (`agent` | `llm` | `tool` | other) for color-coding. `Kind` exists but isn't normalized to those four values. **blocker** for waterfall color coding (otherwise: single-color bars).
12. **`QualityRunSpan.Duplicate: bool`** + **`DuplicateOfSpanId: string`** — design highlights duplicate `rag.search` calls. Detection logic could live server-side (group by `kind+name+input-hash`) or client-side. **stub-ok** but server-side is cleaner.
13. **`QualityRunSpan.Attributes: map[string]string`** — for the right-pane span detail attribute block. Currently the API exposes raw `events` and a flat `spans` array without per-span attributes. **blocker** for the span detail attribute pre-block.
14. **`QualityRunSpan.LinkedInsightIds: []string`** — for the "Linked insights" panel inside span detail. **stub-ok** — could be derived by reverse lookup from `/api/quality/insights`.

### D. Experiments

15. **Per-variant aggregated metrics** — `QualityExperimentRecord.Variants[]` currently exposes only `id` and `targetId`. Need: `passRate`, `meanScore`, `tokensAvg`, `latencyMsP95`, `costTotal`, `baselineDelta`, `isWinner` (bool), `isBaseline` (bool). **blocker** for the matrix.
16. **`QualityExperimentRecord.VariantConfigs: map[variantId]ConfigDiff`** — the design shows YAML diff between winning variant and baseline. **blocker** for the config-diff panel (otherwise: hide the panel).
17. **`QualityExperimentRecord.Progress`** for running experiments: `{ casesDone, casesTotal, providerCalls, estRemainingMs, seed, temp }`. **stub-ok** for completed experiments (skip the progress strip); **blocker** for an in-flight experiment view.
18. **`QualityExperimentRecord.PrimaryScore: string`** — name of the primary score so the matrix knows which column to highlight. **stub-ok** — UI can default to first numeric score.

### E. Compare

19. Existing `QualityComparisonRecord` + `QualityComparisonCaseDelta` cover most of what the screen needs. ✅
20. **`QualityComparisonCaseDelta.BaselineTraceSpans`** + **`CandidateTraceSpans`** (or pointers to fetch them) — for the side-by-side trace diff in the bottom of the case detail. Could be done as two extra `GET /api/quality/runs/{traceId}` calls. **stub-ok** via the existing endpoint.
21. **Gate exit code mapping** — `QualityGateSummary.Status` exists, but design shows `gate: failed · exit 1` in the breadcrumb right-rail. Just need to surface the status string. ✅

### F. Datasets / Suites

22. **`QualitySuiteRecord.State: "draft"|"pinned"|"live"|"frozen"`** — the design uses colored state glyphs. Currently no such field. **stub-ok** — UI can default everything to `pinned`.
23. **`QualitySuiteCase.LastRunStatus`** + **`LastRunExperimentId`** — for the case list rating column. **stub-ok**.
24. **`QualitySuiteCase.Assertions: [{ op, arg, lastPass: bool }]`** — for the assertions table in the case editor. **blocker** for the assertion editor (otherwise: hide).
25. **`QualitySuiteCase.FeedbackRating: '👍'|'👎'|null`** + **`FeedbackId`** — the case list shows thumb-down chips. **stub-ok** — derive from feedback list.
26. **`POST /api/quality/suites/{suiteId}/cases/{caseId}`** for partial case updates from the editor. There's a `POST /cases` for upsert ✅. **stub-ok** — reuse upsert.

### G. Baselines / Feedback

27. All current fields appear sufficient. ✅
28. Minor: design shows "previous baseline history" — would need a `History []QualityBaselineRecord` field or a separate `GET /api/quality/baselines/{id}/history` endpoint. **stub-ok** — derive from listing all baselines for the target.

### H. Cassettes

29. **`QualityCassetteEntrySummary.HitCount: int`** + **`SignatureExpected`** + **`SignatureCurrent`** + **`DriftReason`** — current `Reason` is one string; the design shows a structured diff. **blocker** for the drift-detail block (otherwise: render `Reason` as plain text).
30. **`QualityCassetteRecord.HitRate: float64`** — already derivable from `EntryCount` and entry hit counts. **stub-ok**.

### I. Cross-cutting context (for the V1 shell)

31. **`/api/devtools/context`** (or extend an existing endpoint) returning: `{ project: { name, path }, git: { branch, commitSha }, target: { id, kind, model }, baseline: { id, label, promotedAtRelative } }`. The design's tab strip + nav rail footer + breadcrumb right-rail all consume this. **stub-ok** — fall back to "(unknown project)" / git-shell-out if absent.

### J. Command palette actions

32. The palette's `:promote`, `:run`, `:compare`, `:cassette record`, `:save insight … --as-cases` need to either:
    - call existing HTTP endpoints (most do — `POST /api/quality/baselines`, `POST /api/quality/comparisons`, `POST /api/quality/cassettes/issues`, `POST /api/quality/suites/{id}/cases`)
    - or shell out to the local cobra commands (which then call the same endpoints anyway).

    The one notable missing endpoint is **`POST /api/quality/runs`** to kick off a new run / experiment from the palette (`:run docs_agent --dataset agent-loops`). Currently `crux eval` does this via the eval-runner subprocess. **blocker** for in-TUI run kickoff — could be deferred by having the palette shell out to `crux eval` until the endpoint exists.

---

## 8. Things explicitly NOT in scope

- React devtools UI — kept as-is, separate redesign pass later.
- Re-organizing top-level `crux` commands — separate pass per the user's note ("In a second pass we'll focus on making the entire cli make sense commands wise").
- `traces` / `eval` / `shell` top tabs body content — wire the tab strip but each non-`quality` tab renders a placeholder "coming soon" pane.
- Production observability / hosted dashboards — local `.crux/quality` only.
- Mobile / responsive — TUI is fixed-width terminal.

---

## 9. Verification approach

- Per-screen golden snapshots: render each screen with a fixed seed dataset (already-cached fixtures in `internal/store/testdata`) into a string, compare to a `.golden` file. Update with `go test ./internal/tui/... -update`.
- Keybind tests: simulate `tea.KeyMsg` sequences and assert mode/screen transitions.
- WS event reactivity: feed a sequence of synthetic events and assert the activity log updates without re-fetching the whole screen.
- Manual: `crux dev` on a Karyla-local target, walk through `g i` → select insight → `↵` → `t` to traces → `↵` → `o` open span → `:` palette → `:promote exp-043:maxIter+dedupe` → return to overview, confirm activity log shows the promotion.
- Scoped Go tests: `cd packages/cli && go test ./internal/tui/... ./internal/api/...`

---

## 10. Open questions surfaced by the design but not yet decided

Captured for the user / core-agent:

- Top tab strip: sections (`quality · traces · eval · shell`) vs projects. Design picks sections; we're going with that.
- Compare convention: candidate-on-right. Design picks that; we're going with it.
- Case editor in Datasets: TUI form vs shell out to `$EDITOR` for prompt bodies. Recommend: in-TUI form for short text fields, `$EDITOR` shell-out for any multi-line value > N chars (config-driven threshold).
- Cassette drift blocking on test runs: design shows passive panel. Recommend keeping it passive in the TUI; gating is a CI concern that lives in `crux quality compare --gate`.

---

## 11. What I'm waiting on

Backend gaps in §7 marked **blocker** must be filled before I can implement the corresponding screens at design fidelity. I can begin work on the shell, components, Overview (with degraded chart/sparklines), Cassettes, Baselines, Feedback in parallel — they're either covered already or fall back gracefully.

Once the backend agent reports back, I'll proceed in the order listed in §6.
