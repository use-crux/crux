---
"@use-crux/local": patch
---

Publish Linux and macOS `crux` and static-index worker binaries with executable
permissions, and verify an installed platform tarball by running `crux --help`
before stable or nightly publication. Keep the workspace/npm `crux.cjs`
launcher executable as well, so pnpm workspace bins can invoke it directly.
Successful automated nightlies are also listed as GitHub pre-releases.
