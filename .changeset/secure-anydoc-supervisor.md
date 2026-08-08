---
"@use-crux/local": patch
---

Harden the Linux Anydoc supervisor with private verified source staging,
attested read-only input mounts, complete job capability digests, and bounded
worker socket reads and acknowledgements.

Package and attest the pinned Linux x64 GNU Anydoc native runtime before
launching its isolated Node runner.

Reject writable Node executable ancestry and scrub native-loader environment
variables from the isolated service.

Verify the launched Node executable and require a trusted glibc host before
native Anydoc extraction.
