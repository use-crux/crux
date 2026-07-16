# Go CLI and TUI stabilization design

Status: **approved design; implementation planning pending written-spec review**

## Summary

Crux Local's Go CLI and terminal UI have enough surface area to look complete,
but their interaction, layout, data, lifecycle, and testing contracts are not
yet reliable enough to ship. The first stabilization slice will make one real
workflow production-usable:

> Start Crux Local, find a bad run, understand what failed, and navigate to the
> relevant project definition without losing context.

That slice crosses `crux dev`, Overview, Runs, and Project Index. It will
establish a small stabilization kernel that later screens must use rather than
patching each screen independently.

The existing Bubble Tea, Bubbles, and Lip Gloss stack remains. The primary
problem is not the framework; it is duplicated interaction state, screen-local
scrolling and layout rules, weak async identity, optimistic feature exposure,
and insufficient workflow-level tests.

## Goals

- Make the diagnose-a-bad-run workflow predictable, readable, cancellable, and
  useful at supported terminal sizes.
- Give keyboard input, focus, navigation, scrolling, and back behavior one
  authoritative contract.
- Present diagnosis-oriented information by default, with raw JSON available
  only as an explicit inspection action.
- Prevent stale async responses from replacing data for the user's current
  selection.
- Make CLI output, non-interactive behavior, signal handling, and shutdown
  suitable for local development and automation.
- Prove behavior through real Bubble Tea event-loop and compiled-binary PTY
  tests, not only snapshots and direct model calls.
- Migrate the remaining screens in small workflow slices after the kernel is
  proven.

## Non-goals

- Rewriting the TUI in another framework.
- Redesigning every screen in the first slice.
- Adding mouse support as a release requirement.
- Making raw backend payloads the primary user interface.
- Implementing currently advertised placeholders merely to preserve the
  existing navigation map.
- Replacing the browser devtools. The browser remains a complementary explicit
  escape hatch for richer inspection.

## Current-state findings

The audit found a broad test suite and several useful primitives, but not a
single enforceable product contract.

- The TUI contains roughly 18,000 lines across nine screens. Most tests call
  model methods or compare rendered output; only a small queue test constructs
  a real `tea.Program`.
- The root app intercepts global keys before focused workspace components can
  consume them. Screens also implement their own `j/k/h/l`, cursor, focus, and
  paging behavior.
- Runs has list scrolling, but its waterfall and detail content do not own a
  real viewport. Long detail output is padded or clipped, while `j/k` changes
  span selection rather than reliably scrolling the focused document.
- Layouts are selected from global width classes and fixed pane allocations,
  so content becomes unreadable before the whole screen crosses a breakpoint.
- Async screen commands commonly start from `context.Background()` and response
  messages frequently lack request and selection identity. Slow responses can
  therefore land after the user has navigated elsewhere.
- Generic payload rendering falls back to pretty-printed JSON. This exposes
  storage shape instead of answering the diagnostic question.
- Visible actions and screens include pending or no-op behavior, including
  viewer/source navigation and unfinished dataset surfaces.
- `crux dev` has overlapping signal/shutdown ownership, and interactive startup
  can open a browser alongside the TUI. Some command paths bypass injected IO
  or mutate the process-global logger.
- Focused TUI tests and the race suite pass, but the broader command suite
  depends on prepared embedded assets and currently fails without them. That is
  a release-harness defect even when the product code is otherwise correct.
- Code and tests cite ADR-0050 and ADR-0051, but this repository contains only
  ADR-0001 through ADR-0003. Those references cannot serve as architectural
  authority and must be replaced or repaired during migration.

These findings explain why local fixes have not produced stability: the bugs
cross screen, component, transport, and process boundaries.

## Industry lessons applied

The design borrows proven shapes without copying another product's information
architecture:

- Bubble Tea's Elm-style update loop works when state ownership and message
  boundaries are explicit. Bubbles' list and viewport components show that
  scrolling belongs to a reusable component, not ad hoc string clipping.
- Lazygit's list controller centralizes selection, paging, and scroll behavior.
  Its integration suite drives the real application like a user and asserts
  focus and visible views.
- K9s uses an explicit page stack and contextual key actions, allowing the UI
  to render the actions that are actually executable in the current context.
- `gh-dash` composes reusable list/viewport components and central key maps
  rather than teaching each screen a new scrolling model.
- Command Line Interface Guidelines separate result data from diagnostics,
  adapt to TTY capabilities, and avoid interactive decoration in pipelines.

References:

- [Bubble Tea](https://github.com/charmbracelet/bubbletea)
- [Bubbles](https://github.com/charmbracelet/bubbles)
- [Lazygit codebase guide](https://github.com/jesseduffield/lazygit/blob/master/docs-master/dev/Codebase_Guide.md)
- [Lazygit integration tests](https://github.com/jesseduffield/lazygit/blob/master/pkg/integration/README.md)
- [K9s](https://github.com/derailed/k9s)
- [gh-dash list viewport](https://github.com/dlvhdr/gh-dash/blob/main/internal/tui/components/listviewport/listviewport.go)
- [Command Line Interface Guidelines](https://clig.dev/)

## Chosen approach: incremental stabilization kernel

Three approaches were considered:

1. Patch each screen in place. This is initially fast but preserves duplicated
   state and makes regressions likely.
2. Build a small stabilization kernel and migrate workflows incrementally. This
   fixes shared causes while keeping scope bounded.
3. Reduce the TUI to a thin launcher for browser devtools. This lowers terminal
   complexity but does not satisfy the offline, keyboard-first diagnostic use
   case.

The chosen approach is option 2. It is intentionally not a platform rewrite.
Only primitives required by the first workflow are introduced, and every new
abstraction must remove duplicated behavior from migrated screens.

## Architecture

### State ownership

The stabilized TUI has four layers with non-overlapping responsibilities:

```text
App/process boundary
  -> interaction router
      -> workflow screen
          -> pane components
              -> workflow projections / local API client
```

#### App/process boundary

The app owns terminal initialization, Bubble Tea lifecycle, true process-level
events, and the root session context. It does not pre-empt focused text input or
screen actions with ordinary workspace shortcuts.

#### Interaction router

The router is the single authority for:

- current workflow and navigation history;
- focused pane;
- overlay or input mode;
- key dispatch order;
- contextual executable actions;
- back/close behavior.

Dispatch order is:

1. Active modal, text input, filter, or command field.
2. Focused pane component.
3. Workflow-level actions.
4. Root process actions.

An action can appear in help or the status bar only when the same action object
has an executable handler and its required capability is available. `q` quits
only when the workspace owns focus. `esc` closes the nearest overlay or pops one
navigation level before it can affect the process.

#### Pane components

The kernel initially needs three pane types:

- `ListPane`: selected stable ID, cursor, paging, scroll, empty/error state.
- `TreePane`: selected stable ID, expansion state, paging, scroll.
- `DocumentPane`: wrapped content, viewport offset, search position, page and
  line scrolling.

Each pane owns its cursor or viewport and implements one shared input/resize
contract. Screens do not maintain a second offset or reinterpret movement keys.

#### Workflow screens

A screen composes panes and owns only workflow state: selected run ID, selected
span ID, selected definition ID, active projection, and navigation intent. It
does not implement raw cursor arithmetic, clipping, or global focus rules.

#### Workflow projections

Projection functions convert backend records into stable, diagnosis-oriented
view models before rendering. They are deterministic and testable without a
terminal. Rendering code must not discover meaning by traversing arbitrary JSON.

### Capability honesty

A capability registry represents backend and local capabilities available in
the current session. Screens, actions, and help derive visibility from that
registry. There are only three valid states:

- available and executable;
- experimental and explicitly labeled;
- absent.

No-op handlers, permanent “pending” surfaces, and keys that only show a toast
are removed from the production navigation map. If an action becomes
temporarily unavailable because a service is degraded, it remains visible as
disabled with a short reason only when that helps the user recover.

## Interaction contract

### Keyboard and focus

- `j/k` or arrow keys move within the focused component: list selection in a
  list, node selection in a tree, and line scroll in a document.
- `ctrl+d/ctrl+u` and page keys page the focused component where applicable.
- `h/l` and `tab/shift+tab` move focus between visible panes.
- `enter` drills into the selected record or expands the selected tree node.
- `esc` closes the nearest overlay, cancels an input, or navigates back one
  level.
- `/` opens search or filtering for the focused component when supported.
- Help is contextual and generated from the same executable action set used for
  dispatch.

Text entry always receives printable keys before workspace shortcuts. The
router must expose focus visibly; keyboard behavior must never depend on an
invisible mode.

### Scrolling

Every surface that can exceed its assigned height uses a real pane viewport.
The viewport exposes line/page movement and a compact position indicator. On
content refresh, it preserves its anchor by stable record ID and relative line
where possible. On selection change, detail content deliberately resets to its
document start unless returning through navigation history restores a prior
anchor.

### Responsive layout

Layout is chosen from pane minimum widths and workflow priority, not only a
global terminal breakpoint.

- Wide: list/summary, evidence, and detail/source panes may be visible.
- Medium: list plus the focused evidence or detail pane.
- Narrow: one pane at a time, navigated as a stack.

Resize preserves selected stable IDs, focused logical pane, expansion state,
and viewport anchor. If the focused pane becomes hidden, the router maps focus
to its stacked equivalent rather than silently selecting the first pane.

The first release matrix defines and tests concrete minimum terminal sizes. A
terminal below the minimum shows a short actionable size message instead of a
corrupted layout.

Mouse support is deferred until keyboard semantics and hit regions are stable.

## Diagnose-a-bad-run workflow

### Entry and overview

`crux dev` in an interactive terminal starts the server and opens the TUI at an
Overview triage screen. Overview shows actionable health and recent failures,
not a dashboard of raw counters. Selecting a failed run and pressing `enter`
navigates to Runs with that run ID selected.

### Run diagnosis projection

Runs consumes a `RunDiagnosis` projection with these sections where evidence is
available:

- concise failure summary and status;
- likely cause, clearly labeled as evidence or inference;
- critical path through the run;
- failed, abnormal, and retried operations;
- bounded input/output previews;
- linked insights and relevant diagnostics;
- source definitions and source references.

Unavailable evidence is omitted or labeled unsupported. It never silently
becomes a generic JSON primary view. `Inspect Raw` is an explicit secondary
action for support and advanced debugging.

Large values use bounded previews with search, scrolling, and export. Rendering
must avoid unbounded allocation and terminal output.

### Source navigation

Source references are typed navigation targets, not formatted strings. Opening
a source reference navigates to Project Index with the matching definition and
source location selected. Back returns to the same run, span, pane focus, and
viewport anchors.

External browser/editor actions appear only when implemented and supported.
The first slice may ship without them; source inspection inside Project Index
is the required path.

## Async data and failure contract

### Session and cancellation

`crux dev` creates one root session context. Screens derive request contexts
from it. Leaving a screen, changing the record that owns a detail request, or
starting a replacement request cancels the obsolete context.

Every async response delivered to a reducer carries:

- a monotonically unique request ID;
- the selected record ID that initiated it;
- a source revision or equivalent freshness token when the API provides one;
- data or a typed error.

Reducers apply a response only if its request and owner still match current
state. Cancellation is an optimization and resource guarantee; identity checks
are the correctness guarantee.

### Refresh and pane states

Refreshing keeps the last good data visible with a small refresh indicator.
Each pane has exactly five render states:

- loading: no usable data has arrived;
- ready: current usable data;
- empty: successful request with no records;
- degraded: stale/partial usable data plus a recoverable problem;
- failed: no usable data and an actionable error.

Errors are scoped to the affected pane and include retry when retry is valid.
A detail failure must not replace the run list or crash the whole workflow.

Live events invalidate a named projection or schedule a refresh. They do not
mutate arbitrary screen fields from outside the reducer. Event bursts are
coalesced so a busy project cannot create an unbounded request queue.

## CLI process and output contract

### IO

All commands receive an explicit IO bundle. Command packages do not write
directly to `os.Stdout`/`os.Stderr`, replace the process-global logger, or hide
serialization errors.

- Human result data goes to stdout.
- Diagnostics, warnings, and progress go to stderr.
- Machine output is versioned, deterministic, and contains no decoration or
  incidental log lines.
- Non-TTY and `TERM=dumb` paths use plain output: no TUI, animation, or automatic
  browser opening.

### Interactive startup

In an interactive terminal, `crux dev` starts the server and TUI. It does not
open the browser automatically. A contextual `o` action may open browser
devtools only when that action is implemented and executable.

In CI, redirected output, or unsupported terminals, `crux dev` runs as a plain
server command with concise status on stderr and stable result/output behavior.

### Signals and shutdown

The command entry point creates the sole signal-aware root context. One
idempotent shutdown coordinator stops UI, event bridges, workers, server, and
temporary resources in a documented order under a bounded timeout. The TUI
does not install a second signal handler. Repeated signals cannot start
overlapping shutdown sequences.

## Testing strategy

Snapshots and golden files remain useful for visual regression, but they are
supporting tests rather than proof of interaction correctness.

### Reducer and component tests

- Table tests for action routing and key precedence across workspace, modal,
  input, and focused panes.
- Unit and property tests for list/tree/document selection, page movement,
  empty content, wrapping, resize anchors, and bounds safety.
- Projection tests for failure, retry, missing evidence, malformed payload,
  large payload, and source-reference cases.
- Async tests for cancellation, delayed responses, out-of-order completion,
  event bursts, closed channels, retry, and degraded services.

### Real event-loop workflow tests

A test driver runs a real Bubble Tea program with deterministic fake services.
It sends terminal sizes, keys, and async messages through the program and
asserts visible state plus semantic state:

- focused pane and contextual actions;
- selected stable IDs;
- viewport offsets and anchors;
- navigation stack and restored state;
- loading/empty/degraded/failed transitions;
- stale response rejection.

The primary tracer test performs the full first workflow: start at Overview,
select a failed run, inspect evidence, scroll long details, open its source
definition, resize at each layout class, and navigate back without losing
context.

### Compiled-binary PTY tests

PTY tests build and launch the actual `crux` binary to verify:

- terminal entry and restoration;
- SIGINT/SIGTERM and repeated-signal behavior;
- deterministic exit codes;
- stdout/stderr separation;
- non-TTY and `TERM=dumb` behavior;
- server startup failure and shutdown timeout;
- no unexpected browser launch.

Race tests, goroutine leak checks, and a small terminal capability matrix run in
CI. Embedded worker/UI assets required by command tests are prepared through a
hermetic test target; a developer's previous `make` invocation cannot determine
whether the suite passes.

### Manual acceptance

A small set of reproducible VHS/manual scripts checks feel and readability at
the supported terminal sizes. Manual review cannot replace the automated
workflow and PTY gates.

## Migration and release plan

### Phase 0: stop the bleeding

- Freeze new TUI screens until they can use the stabilization contracts.
- Hide or remove advertised stubs and permanent pending states.
- Add the real event-loop workflow harness and compiled-binary PTY harness.
- Make command tests hermetic with respect to embedded assets.
- Repair documentation authority: replace broken ADR-0050/0051 references with
  this spec or add narrowly scoped ADRs if implementation discovers a durable
  decision that belongs there.

### Phase 1: diagnose

Build the kernel and migrate `crux dev`, Overview, Runs, and Project Index. Ship
this phase only when the tracer workflow and CLI lifecycle gates pass.

### Phase 2: evaluate

Migrate Experiments, Datasets, and Baselines using the same components,
capability model, async envelope, and tests. Do not preserve a screen merely
because it exists; include it only when its backend workflow is complete.

### Phase 3: improve

Migrate Insights, Feedback, and Cassettes under the same rule.

### Phase 4: remove legacy paths

Delete duplicate screen-local key, layout, cursor, fetch, and rendering paths.
There must be one stabilized implementation of each shared behavior.

## Release gates and definition of done

A migrated workflow is shippable only when:

- every advertised action has an executable, tested outcome;
- no primary pane falls back to generic JSON;
- all potentially long content scrolls in the focused pane;
- supported resize transitions preserve selection, focus, and navigation;
- obsolete requests are cancelled and stale responses are rejected;
- pane-local failures are actionable and do not erase unrelated good data;
- non-TTY execution is plain and deterministic;
- signals restore the terminal and stop the process without leaks;
- the real event-loop tracer, PTY suite, focused unit tests, race suite, and
  hermetic command suite pass;
- contextual help is generated from executable actions;
- no untested focus transition exists in the migrated workflow.

“Mostly works” snapshots, an implemented handler without a usable data
projection, and a key that only acknowledges itself do not satisfy these gates.

## Risks and controls

- **Kernel over-design:** introduce only the three pane types and contracts
  needed by the diagnose workflow; require each abstraction to replace existing
  duplicated code.
- **Dual implementations during migration:** keep phases short and delete the
  migrated legacy path in the same phase.
- **Backend data gaps:** show evidence honestly and omit unsupported sections;
  do not infer certainty or use JSON as a product fallback.
- **Golden churn:** assert semantic interaction state in workflow tests and keep
  a small, deliberate set of visual goldens.
- **Terminal variance:** publish a supported capability/size matrix and degrade
  cleanly outside it.
- **Hidden lifecycle regressions:** test the compiled binary under PTY, signal,
  non-TTY, and failure conditions.

## Implementation-planning boundary

This document defines product and architecture behavior, not file-by-file
commits. After written-spec approval, implementation planning should split the
work into small vertical slices, each leaving the repository passing and each
proving one part of the tracer workflow. The first implementation change should
establish the harness and remove dishonest capabilities before introducing new
visual surface area.
