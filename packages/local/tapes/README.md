# TUI visual captures

Capture the **real** Crux local TUI (`packages/local/crux dev --tui`) for visual review.

## One-command loop

From the repository root (requires a built `packages/local/crux` binary — this target does not build assets):

```bash
make tui-shots
# or
make -C packages/local tui-shots
```

Environment:

| Variable | Default | Meaning |
|---|---|---|
| `TUI_SHOTS_PROJECT` | `examples/node-basic` | Project directory to boot against |
| `TUI_SHOTS_VHS` | auto (`~/go/bin/vhs` or `vhs` on `PATH`) | VHS binary for PNG/GIF |
| `TUI_SHOTS_BOOT_TIMEOUT` | `90` | Seconds to wait for the TUI header |
| `TUI_SHOTS_SETTLE_MS` | `600` | Settle time after each navigation key |

Outputs land in `packages/local/tapes/out/shots/` (gitignored):

```
out/shots/
  160x45/   overview|insights|runs|evals|index|palette|help|diagnostics .{txt,png}
  100x30/   overview|insights|runs|evals|index .{txt,png}
  70x24/    overview|insights|runs|evals|index .{txt,png}
```

- **ANSI text**: `tmux capture-pane -p -e` at exact cell sizes `160x45`, `100x30`, `70x24`.
- **Images**: VHS `Screenshot` PNGs (plus a per-size `_session.gif`) when VHS+ttyd work headless. If image capture is unavailable, text captures still run and the script prints a TODO.

Screens driven: Overview (`1`), Insights (`2`), Runs (`3`), Evals (`4`), Index (`5`). At `160x45` only: command palette (`:`), help (`?`), diagnostics (`!`).

## Implementation

`packages/local/scripts/tui-shots.sh` owns the loop:

1. Fails clearly if `./crux` is missing (does not build TS/Rust).
2. Picks a free non-default port (`--port`).
3. Uses unique tmux session names and a `trap` that always kills the session and port listeners.
4. Scrubs `CI` / CI-like env vars so `--tui` is allowed in agent shells.
5. Generates short-lived VHS tapes under `tapes/out/generated/` (gitignored).

## Legacy golden-cat tapes

The `*.tape` files next to this README (`overview.tape`, …) still exist as historical golden-fixture demos (`cat …golden`). Prefer `make tui-shots` for real app captures.
