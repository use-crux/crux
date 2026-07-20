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
  The release gate is a first-frame deadline of one second after the owned HTTP
  listener is ready; tests use a blocked initializer to prove independence.
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

`server.NewDevServer` constructs services, storage, handlers, and owned worker
registries, but does not perform the initial Project Index reindex or runtime
artifact generation synchronously. `DevServer.Start` binds the HTTP listener,
then starts one server-owned warmup operation under the existing session
context.

Warmup performs the current ordering—initial reindex, then runtime artifacts
from the resulting definitions—and publishes phase/result state. The Project
Index watcher starts only after the initial reindex handoff is established so
startup cannot perform duplicate competing builds. Cancellation and shutdown
join the warmup through the existing worker registry and timeout.

Initialization failure does not stop the listener or TUI. Last-good Project
Index data remains available where one exists; otherwise screens retain an
explicit loading/degraded state.

### Startup status boundary

The dev server exposes a small read/subscribe startup-status boundary rather
than coupling the TUI to indexer internals. Status contains a phase, whether
work is active, and an optional structured diagnostic. The TUI receives it via
the existing bridge/application message flow. Plain mode renders the same
terminal result through its diagnostic reporter.

The initial frame depends only on cheap server construction, listener binding,
and TUI program startup. It never awaits a warmup result or tunnel result.

### CLI mode selection

Mode selection accepts an explicit tri-state intent: automatic, TUI, or plain.
Automatic retains current capability detection. Explicit TUI still validates
stdin, stdout, CI, and `TERM`; it does not force escape sequences into a pipe.
Cobra rejects mutually exclusive `--tui` and `--no-tui` flags before server
construction.

### Launcher and shutdown

The JavaScript launcher uses an asynchronous child-process lifecycle instead
of `execFileSync`. It inherits stdio, remains installed as the foreground
supervisor while the Go child restores the terminal, and exits only from the
child's `close` result. Signal handling must avoid terminating the wrapper
ahead of the child or delivering duplicate signals to a child that already
received the terminal's process-group signal.

Inside raw TUI input, Ctrl+C is an application key and follows the same orderly
shutdown path as `q`. Process signals continue through the command-root signal
coordinator and retain conventional statuses.

## Test strategy

Tests are added one behavior at a time using public boundaries:

1. A command/PTTY test blocks server warmup indefinitely and proves the
   Overview or startup frame arrives within the deadline, then releases cleanly.
2. Command tests prove automatic mode, `--tui`, `--no-tui`, conflicting flags,
   and explicit-TUI capability errors.
3. A real-program test proves a runtime-host-only warmup diagnostic is visible
   without suppressing the first frame and is not duplicated.
4. PTY shutdown tests prove `q` and raw Ctrl+C exit 0, while process SIGINT and
   SIGTERM retain 130/143 and release the port.
5. A launcher integration test runs the published npm wrapper around a
   controllable child and proves it waits for cleanup, propagates status, and
   does not leak terminal capability replies after the parent returns.
6. Existing Go, integration, race, vet, cross-compile, and package checks remain
   green.

Tests must not rely only on a passive PTY. At least one terminal harness answers
the synchronized-output and Unicode-core capability probes observed in the bad
run.

## Scope boundaries

This tranche does not redesign screens, change Project Index output, alter
cache identity, make runtime-host-only declarations executable outside their
host, or change browser/tunnel policy. It stabilizes startup visibility, mode
selection, and process ownership only.
