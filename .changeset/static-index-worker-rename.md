---
'@use-crux/local': patch
---

Rename the bundled native worker binary from `crux-indexer-worker` to `crux-static-index-worker` to reflect its Static Syntax / Static Index ownership. The `crux` CLI is unchanged and discovers the renamed sibling binary automatically; the only visible change is the binary filename shipped inside the `@use-crux/local-<os>-<cpu>` platform packages.
