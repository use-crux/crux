# TUI keybind contract

The Quality Workbench has three layers of keybindings. Screen authors MUST respect this contract — if a screen needs an action that doesn't fit a polymorphic verb, pick a new letter.

## Layer 1 — truly global (shell-owned, always work)

| Key | Action |
|---|---|
| `:` | open command palette |
| `?` | open help overlay |
| `/` | search-this-pane (focused pane scopes the query) |
| `g {letter}` | jump to nav-rail item (`o` overview, `i` insights, `r` runs, `x` experiments, `c` compare, `s` suites, `b` baselines, `f` feedback, `k` cassettes) |
| `1`–`9` | numeric nav-rail jump |
| `q` | quit |
| `j` / `k` | next / prev row in focused pane |
| `h` / `l` | next / prev pane |
| `g g` | top |
| `G` | bottom |
| `↵` | open / expand the focused row |
| `esc` | back / cancel / close overlay |

These are reserved. Screens MUST NOT bind them to anything else.

## Layer 2 — polymorphic verbs (same letter, semantically equivalent per screen)

A screen that implements one of these verbs MUST match the documented meaning. If a screen needs a different action, it picks a Layer-3 letter instead.

| Key | Verb family | Examples |
|---|---|---|
| `s` | save what's focused into the appropriate sink | Insights: save linked failures as Cases. Runs: save run output to a Case. Cassettes: save selected entry to a fixture set. |
| `r` | re-execute what's focused, producing a new record | Insights: run variant. Runs: re-run case. Experiments: re-run experiment. Comparisons: re-run candidate. |
| `c` | compare what's focused against its reference | Experiments: compare two variants. Insights: compare candidate vs baseline. Runs: compare run against baseline run. |
| `p` | promote what's focused to its next lifecycle state | Experiments: promote winner variant to Baseline. Insights: promote proposed fix to Variant. Cassettes: `p` is **NOT** used — Cassettes uses lowercase `p` for "play once" which conflicts, see exception below. |
| `x` | dismiss / discard what's focused (reversible — no permanent loss) | Insights: dismiss. Feedback: dismiss. Suites case: delete (with confirm modal — destructive variant of dismiss). |
| `e` | export what's focused | Experiments: export csv. Runs: export run. |
| `o` | open in external viewer | Runs: open in browser/devtools. |

### Polymorphic-verb exceptions

- **Cassettes** has three exceptions to the Layer-2 contract, all earned by the fact that a Cassette is a fixture file, not a record being acted on:
  - `p` means "play once" (not promote). A cassette has no promote-shaped action, and "play" is the dominant verb in fixture-replay UIs.
  - `R` means "re-record selected" (not run). Uppercase because re-recording overwrites the existing entries.
  - `e` means "edit the focused entry in `$EDITOR`" (not export). Cassettes have no useful export action — the cassette already _is_ a file on disk — so `e` is reassigned to the editing affordance. The `^e` chord used elsewhere (Suites' edit-field-in-`$EDITOR`) is not needed on Cassettes because the entry is the whole unit, not a field of a record.
  
  If we ever add promote-shaped, run-shaped, or export-shaped semantics to cassettes, we will pick new letters rather than reclaim these.

## Layer 3 — screen-local (one-off letters)

Screens may bind any letter not in Layer 1 or 2 to a screen-specific action. Examples:

| Key | Screen | Action |
|---|---|---|
| `t` | Insights, Compare | open linked traces (= filter Runs by the focused record's run set) |
| `f` | Insights | mark insight fixed |
| `d` | Cassettes | diff vs main |
| `n` | Experiments | new experiment |
| `R` | Cassettes | re-record selected |
| `D` | any | hard-delete with confirm (capital — destructive) |

## Capitalisation = destructiveness

- **lowercase** = reversible or non-destructive (`r` re-run produces a new record; the old one stays).
- **UPPERCASE** = destructive or replacing (`R` re-record overwrites the cassette; `D` deletes permanently). Uppercase actions MUST trigger a confirm modal before executing.
- **`x` is the exception**: lowercase `x` is the universal dismiss/discard verb across vim, lazygit, k9s. We keep it lowercase for muscle memory. Genuinely destructive deletes use `D`.

## Help overlay is contextual

Pressing `?` shows the *current screen's* Layer-2 + Layer-3 bindings plus the truly-global Layer-1 set. There is no shared "save means save these four things" line — that lies. Each screen lists the literal action `s` performs *on that screen*. Screen authors export their keymap to the help renderer the same way they export it to the bottom status bar.

## Status bar shows what's pressable right now

The bottom status bar reflects the focused screen's `Keybinds()` output, never a static list. If a screen returns empty, the bar shows only Layer 1 (`: cmd · ? help · g jump · / search`).

## Editor (case-edit) keys

When the Suites case editor is the focused widget, it owns its full keymap and reports a different set of binds to the status bar:

| Key | Action |
|---|---|
| `esc` | back to row navigation |
| `^s` | save edits |
| `^z` | undo |
| `tab` / `shift+tab` | next / prev field |
| `^↵` | run case in-place |

Long-form fields (Case input JSON, expected rubric, Insight proposed-fix YAML, Cassette entry body) shell out to `$EDITOR` — they are not edited inline. See [ADR 0050](../../../docs/adr/0050-tui-is-modeless-inspection-workbench.md).
