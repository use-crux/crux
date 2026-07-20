# Crux Local TUI startup stability

## Problem

`crux dev` can spend 10–15 seconds synchronously building the initial Project
Index and runtime artifacts after printing a nonfatal runtime-host diagnostic.
In an interactive terminal, the workbench does not render until that work
finishes. The blank wait looks like a hang, and aborting it with Ctrl+C can let
the npm wrapper exit before the Go process has restored the terminal.

The CLI also rejects the intuitive `--tui` spelling even though `--no-tui`
exists. These behaviors make a working process appear broken.

## User-visible contract

- In a supported interactive terminal, `crux dev` renders a useful first TUI
  frame without waiting for Project Index or runtime-artifact initialization.
  The release gate is a first-frame deadline of one second from entering the
  dev command, so synchronous work before listener construction cannot evade
  the test. Tests use blocked runtime-preflight and index initializers to prove
  independence.
- The TUI reports background initialization honestly with bounded phase and
  diagnostic state. Screens transition from loading/empty to live data through
  the existing event bridge without restarting the program.
- `RUNTIME_HOST_ONLY` remains nonfatal. Interactive mode presents it once in
  workbench diagnostics instead of printing a large warning before the first
  frame. Plain mode keeps a readable diagnostic.
- `--tui` explicitly selects the TUI when both streams are terminals.
  `--tui --no-tui` is invalid. `--tui` on incapable streams fails clearly and
  emits no terminal control sequences.
- `q` and Ctrl+C typed while the TUI owns raw input are clean interactive exits
  with status 0. An actual process SIGINT remains 130 and SIGTERM remains 143.
- The npm launcher remains alive until the Go child has finished cleanup. It
  propagates the child's final status and never leaves terminal replies, workers,
  listeners, or cleanup output behind the package-manager prompt.

The Ctrl+C and `--tui` rules intentionally supersede the earlier stabilization
contract. They are corrections based on observed package-manager and startup
behavior during real use.

## Architecture

### Cheap construction and owned warmup

Interactive mode validates terminal capability and conflicting flags before
starting any worker. The existing runtime preflight—which currently runs
synchronously before server construction with a 20-second timeout—moves into
the background startup pipeline. It cannot delay construction, listener
binding, or the first frame. Plain mode consumes the same background result and
prints it without terminal control sequences.

The dev command creates one session-scoped lifecycle group before constructing
the server. Runtime preflight, initial index/runtime-artifact warmup, watcher,
tunnel, bridge, and other lifetime work are all admitted to this same closeable
group. Every task inherits the session context. Shutdown atomically closes
admission, cancels the context, and joins every admitted task before Bubble Tea
restores the terminal or plain mode returns. Preflight has no independent
goroutine or output path that can outlive this boundary.

`server.NewDevServer` constructs services, storage, handlers, and owned worker
registries, but does not perform the initial Project Index reindex or runtime
artifact generation synchronously. `DevServer.Start` binds the HTTP listener,
then admits one long-lived startup/index lifecycle worker under the existing
session context before `Start` returns. The worker registry is closed to new
admission before shutdown begins waiting, so no `WaitGroup.Add` can race
`Wait`. Tunnel and other optional lifetime workers must be admitted through the
same closeable boundary or registered before `Start` returns.

The lifecycle worker installs filesystem watching before the baseline scan and
buffers/coalesces deltas while the scan is in flight. Warmup performs the
current ordering—initial full reindex, then runtime artifacts from the resulting
definitions—and publishes phase/result state. After a successful baseline
commit, buffered deltas run as one incremental refresh before normal watcher
operation continues. This prevents both duplicate competing builds and a gap
where edits can be lost.

If the baseline fails, watching remains active and the next coalesced delta
requests a full baseline retry; incremental refresh is never attempted without
a committed baseline. Cancellation and shutdown join the lifecycle worker
through the existing registry and timeout.

Initialization failure does not stop the listener or TUI. Last-good Project
Index data remains available where one exists; otherwise screens retain an
explicit loading/degraded state. “Last-good” means a committed in-memory
snapshot. A validated persisted cache may be published as an initial committed
snapshot before the asynchronous scan, but a failed scan must never claim an
uncommitted cache load as last-good or clear a previously committed snapshot.

### Startup status boundary

An internal startup journal is shared by runtime preflight and server warmup
rather than coupling the TUI to indexer internals. Each immutable status has a
monotonically increasing revision, per-task states, and zero or more structured
diagnostics. The fixed task set is registered before startup work begins. Each
task state has a phase plus pending, active, or terminal disposition.
Diagnostics retain a stable identity, code, severity, message, and remediation.

Aggregate `active` is true while any task is active. Aggregate `terminal` is
true only when every registered task is terminal. The displayed phase is the
first active task in a fixed documented priority order, falling back to the
most recently terminal task when none is active. Thus preflight and index
warmup may finish in either order without prematurely declaring startup
complete or making rendering timing-dependent.

`SnapshotAndSubscribe(ctx)` atomically returns the latest snapshot and a stream
of strictly newer revisions. Terminal results remain replayable for the command
lifetime. Diagnostics deduplicate by stable identity, including
`RUNTIME_HOST_ONLY`, so a fast preflight or artifact result cannot be missed or
shown twice when the TUI subscribes after warmup begins. Worker protocol
collection preserves structured error codes instead of discarding them or
requiring string parsing.

The TUI receives journal revisions via the existing bridge/application message
flow. Plain mode renders terminal results from the same journal through its
diagnostic reporter.

The initial frame depends only on cheap server construction, listener binding,
and TUI program startup. It never awaits a warmup result or tunnel result.

### CLI mode selection

Mode selection accepts an explicit tri-state intent: automatic, TUI, or plain.
Automatic retains current capability detection. Explicit TUI still validates
stdin, stdout, CI, and `TERM`; it does not force escape sequences into a pipe.
Cobra rejects mutually exclusive `--tui` and `--no-tui` flags before server
construction.

### Launcher and shutdown

On Unix, the Node 24 launcher resolves the platform binary and calls
`process.execve`, replacing itself with the Go process. PID, process group,
stdio, signal delivery, second-signal behavior, and final exit status therefore
belong directly to Go; no JavaScript signal proxy remains to duplicate or race
signals.

Node does not provide `execve` on Windows. There the launcher uses a synchronous
child with inherited stdio and temporary console-signal handlers that keep the
wrapper alive while the Go child handles console Ctrl+C. It exits from the
child status after cleanup. Windows process-tree termination remains forceful;
graceful shutdown is guaranteed for TUI keys and console control events, not an
arbitrary `TerminateProcess` targeted only at the wrapper. Exit-code/signal
mapping is isolated as a pure function and covered for both platform policies.

Inside raw TUI input, Ctrl+C is an application key and follows the same orderly
shutdown path as `q`. Process signals continue through the command-root signal
coordinator and retain conventional statuses.

## Test strategy

Tests are added one behavior at a time using public boundaries:

1. A command/PTTY test separately blocks runtime preflight and server warmup,
   and proves the Overview or startup frame arrives within one second of command
   entry, then releases cleanly.
2. Command tests prove automatic mode, `--tui`, `--no-tui`, conflicting flags,
   and explicit-TUI capability errors.
3. A real-program test proves a runtime-host-only warmup diagnostic is visible
   without suppressing the first frame and is not duplicated.
4. PTY shutdown tests prove `q` and raw Ctrl+C exit 0, while process SIGINT and
   SIGTERM retain 130/143 and release the port.
5. A watcher test edits source while baseline reindex is blocked, then proves
   the buffered delta is applied after commit. A failure variant proves a later
   edit schedules a full retry and recovers from degraded startup.
6. Startup-journal tests prove atomic snapshot/replay, monotonic revisions,
   terminal retention, typed code preservation, and diagnostic deduplication.
7. A launcher integration test runs the published npm wrapper around a
   controllable child and proves Unix process replacement, Windows status
   mapping, cleanup ordering, and no leaked terminal capability replies after
   return.
8. Shutdown race tests cancel while baseline handoff and runtime preflight are
   independently blocked. They prove no worker is admitted after registry
   closure, every admitted worker joins, and no output arrives after terminal
   restoration.
9. Existing Go, integration, race, vet, cross-compile, and package checks remain
   green.

Tests must not rely only on a passive PTY. At least one terminal harness answers
the synchronized-output and Unicode-core capability probes observed in the bad
run.

## Scope boundaries

This tranche does not redesign screens, change Project Index output, alter
cache identity, make runtime-host-only declarations executable outside their
host, or change browser/tunnel policy. It stabilizes startup visibility, mode
selection, and process ownership only.
