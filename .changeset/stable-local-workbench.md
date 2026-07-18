---
"@use-crux/local": patch
---

Make TUI input routing deterministic so focused filters consume text before
workspace shortcuts, each key dispatches at most one action, and help plus pane
footers show only executable actions. Derive optional Dataset support from the
injected production client and keep unsupported screens out of navigation.
Preserve exact record identities across Overview drills and restore logical
route, pane focus, and stable selections when navigating Back.
