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

After unit, cgroup, and DynamicUser verification, transfer ownership of the
exact staged source inode to that worker UID at mode 0400 so the read-only
bind is readable without weakening parent directory privacy, hash or identity
revalidation, or containment. Staged-source inspection fstats immediately
before and after hashing and rejects any dev, inode, size, type/mode, uid,
gid, mtime, or ctime drift; post-grant checks require the exact requested
uid and gid, mode 0400, and expected identity, size, and hash.

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

Keep the fully verified sandbox snapshot immutable after verify: later
PID/runtime-attested Reports stay live for peer authorization only, and
RefreshAccounting updates only accounting fields on that verified base for the
exact retained cgroup so mutated properties cannot become the ENOENT reuse
fallback.

Retain a strictly successful terminal status observed during a typed
`StopUnit` missing-unit confirmation, so an immediately unloaded transient
unit can complete cleanup only when the pinned cgroup is absent or empty.

Classify unavailable result receipt and result-socket I/O as containment
failures; reserve fixed `accounting-refresh` result-validation diagnostics for
authenticated, decoded results whose accounting refresh fails, including when
terminal accounting cleanup also fails.

Classify systemd stop fallback failures with fixed cleanup diagnostics without
exposing unit names, D-Bus bodies, or cgroup paths.
