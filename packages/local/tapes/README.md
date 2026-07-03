# TUI Review Tapes

These VHS source files replay deterministic TUI fixture frames for visual review.

Run from the repository root after installing `vhs`:

```bash
vhs packages/local/tapes/overview.tape
```

Each tape writes its GIF to `packages/local/tapes/out/<screen>.gif`; that output directory is gitignored.
The frames come from committed goldens, except `index.tape`, which uses the gated visual dump harness
because the Index screen does not have a golden fixture.
