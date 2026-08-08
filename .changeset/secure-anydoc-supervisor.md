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

Bind launches to opaque host-prepared runtime and Node attestations, then
re-attest the exact read-only runtime tree through the worker mount namespace
before releasing its one-shot job capability.

Deny visibility of unrelated host data, grant the dynamic worker access only
to its private runtime directory, and gate the real systemd sandbox against
network, filesystem, privilege, task, memory, CPU, timeout, crash, abort, and
descendant-escape probes.

Bind the selected closed document format and every source, result, expansion,
asset, diagnostic, memory, CPU, wall-time, and process ceiling into the
one-shot worker capability. Return parser failures as strict typed outcomes
that remain distinct from containment and worker infrastructure failures.

Preflight the native document graph and its nested result encoding before
serialization, recompute raw-parser accounting in the Go supervisor from a
strict bounded payload, and keep test-only parser capabilities separate from
the evidence-gated production admission policy.

Map packaged runner stage failures to fixed allowlisted exit codes
(authorization, request/source validation, native load, conversion, result
delivery, acknowledgement) so CI diagnostics can name the failed stage without
leaking paths, nonces, or document content.
