---
"@use-crux/local": patch
---

Harden the Linux Anydoc supervisor with private verified source staging,
attested read-only input mounts, complete job capability digests, and bounded
worker socket reads and acknowledgements.

Record independent workload outcomes and cleanup proofs during Anydoc teardown.
Cleanup now verifies accounting, terminal unit/cgroup, stop/wait/reset, and
staged-source facts without requiring a successful service result after an
already-established parser, crash, CPU or wall timeout, abort, or resource
outcome; unverified and containment failures remain fail-closed.

Preserve authenticated parser-failure outcomes through teardown, and require
an independent lifecycle proof before accepting an idempotent ResetFailedUnit
NoSuchUnit after a failed or nonzero terminal status.

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
exact retained cgroup so mutated properties cannot become a cleanup fallback.

Capture an immutable terminal-success proof only after a complete successful
terminal report, bound to the verified pinned cgroup and runtime snapshot;
allow fully unloaded cleanup only with exclusive pinned-cgroup termination
evidence and an exact final `GetUnit`-gone result.

Classify unavailable result receipt and result-socket I/O as containment
failures; reserve fixed `accounting-refresh` result-validation diagnostics for
authenticated, decoded results whose accounting refresh fails, including when
terminal accounting cleanup also fails.

Route sealed hostile-probe observations through the same private, one-use
lifecycle witness transition as normal results. Require the exact sealed probe,
authorized peer capability, bounded versioned case/invocation observation,
refreshed immutable accounting snapshot, and successful host ACK before minting
a probe-bound witness; malformed, mismatched, resource-limited, or ACK-failed
probes mint nothing and never enter production routing.

Classify systemd stop fallback failures with fixed cleanup diagnostics without
exposing unit names, D-Bus bodies, or cgroup paths.

Treat only an exact typed `ResetFailedUnit` `NoSuchUnit` as idempotent after
the already ordered cleanup proof, without a duplicate terminal-status read;
retain fixed D-Bus-category cleanup failures for every other reset and
private-temp cleanup error. Socket listener closure and socket removal remain
best-effort cleanup.

Classify already-gone cleanup rejection using fixed, allowlisted termination
and terminal-proof diagnostics without exposing systemd or cgroup details.

Split pending `unit-properties-gone` terminal-proof rejection into fixed,
allowlisted no-detail diagnostics for each ordered proof and snapshot check.

Classify unrecognized D-Bus terminal-status failures with a fixed allowlisted
cleanup diagnostic, without exposing D-Bus names or bodies; preserve the
existing generic-unavailable diagnostic for non-D-Bus terminal-status errors.

Preserve sanitized terminal-status operation failures unchanged from systemd
property lookups and classify them by their fixed stage and class for
diagnostics only; they cannot stand in for final terminal proof, including
when the class is exact unit-gone.

Keep a sanitized terminal-status operation diagnosis granular when a cached
accounting snapshot is used after the unit report is gone, even without a
carried `StopUnit` proof; cleanup remains fail-closed.

Keep sanitized terminal-status decode failures granular on that report-gone
cleanup path, without accepting them as terminal proof.

Require already-gone termination evidence to name the exact pinned cgroup
before it can clear cleanup.

Promote `unit-properties-gone` to a pending already-gone validation only from
a verified snapshot for that exact pinned cgroup. Preserve fixed sanitized
terminal-status operation diagnostics on that pending validation path without
allowing a status error to establish terminal proof.

For the existing `unit-properties-gone` path, retain strict inactive-success
service evidence only when it was observed from available systemd properties.
Accept that pending path only when either the retained terminal-success proof
or an ordered result-ACK witness agrees with the verified pinned runtime
snapshot, exclusive pinned-cgroup termination evidence, and a final typed
`GetUnit`-gone result. The ACK witness is usable only after exact peer
authentication, request/result binding, verified-snapshot accounting refresh,
and successful acknowledgement; it rejects mismatched, OOM, oom-kill, and
pids-limited snapshots.

Keep the fixed mounted authorization socket connectable during startup so a
worker blocks on the centrally verified one-shot capability instead of exiting
before attestation; the result socket stays closed and capability delivery
continues to require exact `SO_PEERCRED` UID, MainPID, and cgroup identity.
Discard foreign early authorization connections and continue accepting until
the exact attested worker connects, without writing a request to any rejected
peer.

Classify exact systemd unit-unload report failures with a fixed allowlisted
diagnostic without masking exact-cgroup ENOENT. Reuse a verified accounting
snapshot only for exact-cgroup ENOENT or report-gone, always retaining the
exact pinned cgroup identity. Report-gone reuse also requires exact pinned
absent-or-empty termination evidence and strict successful terminal status;
malformed, unavailable, live, or cgroup-only evidence remains fail-closed.

Permit terminal accounting to retain an already verified runtime-tree identity
only after the worker has exited and the exact pinned MainPID's `/proc/<pid>/root`
entry is typed absent. The proc root is probed for existence and expected symlink
shape before its runtime tree is walked; active, mismatched, unverified,
malformed, partial-disappearance, unreadable, and digest-mismatched reports
continue to fail closed.

Expose only fixed sanitized terminal-accounting diagnostics for failed runtime
attestation: proc-root availability or safety, missing runtime target, unsafe or
unreadable runtime tree, runtime digest mismatch, and failed verified-snapshot
identity reuse. These diagnostics preserve the exact proc-root disappearance
fallback and never include paths, process IDs, digests, D-Bus data, or source
error values.

When the systemd namespace runtime bind is missing while `/proc/<pid>/root`
still exists, defer immutable accounting-snapshot reuse until an ordered,
immutable result-ACK witness proves the authenticated, request-bound result
was decoded, exact-snapshot accounting refreshed, and acknowledged. Cleanup
also requires exact typed `GetUnit` disappearance and exclusive pinned-cgroup
termination; it rejects live, unavailable, stale, OOM, pids-limited,
mismatched, malformed, failed, and nonzero-exit evidence.

Expose fixed, path-specific runtime-target-missing cleanup diagnostics for the
capture path, ACK witness and snapshot mismatches, termination evidence, and
final terminal-status outcomes, without exposing raw runtime, D-Bus, request,
or snapshot values.

When runtime-target cleanup cannot be verified, retain a prior typed result
validation or peer-authentication diagnostic instead of replacing it with the
later missing-witness cleanup reason; the outer outcome remains containment
unavailable and `Cleaned` remains false.

When runtime-target accounting falls back to that witness, available terminal
status remains authoritative: a claimed success still requires strict inactive
success status, while inactive failed, nonzero, and OOM states may prove
cleanup with the valid witness and exact termination evidence while retaining
their truthful crash or OOM workload outcome. Both `memory.events` `oom` and
`oom_kill` reject the witness route.

Replace the mutable result-ACK record with an opaque internal lifecycle witness.
It is atomically minted once after exact peer authentication, strict
result/request validation, accounting refresh against the verified immutable
snapshot, and the unchanged successful host ACK write. The witness binds the
unit, cgroup, runtime digest, MainPID, request digest, and nonce, and retains a
deep-copied resource snapshot including OOM and PID-limit evidence.

Permit the same deferred immutable result-ACK proof during teardown when the
typed runtime-tree read is unreadable after the worker exits. It still requires
the exact verified snapshot, successful accounting refresh and ACK witness,
typed final `GetUnit` disappearance, and exclusive pinned-cgroup termination;
unsafe, malformed, digest-mismatched, and generic runtime-attestation failures
remain fail-closed.

Allow an independently valid retained terminal-success proof to authorize the
pending `unit-properties-gone` cleanup path even when result binding or ACK
delivery failed; preserve that typed result-validation cause and its non-success
workload outcome rather than converting it into containment failure.

Keep OOM, OOM-kill, and PID-limit workload outcomes separate from the retained
terminal-success cleanup proof on that path. A PID-limited ACK witness without
that independent proof remains ineligible and returns its fixed cleanup
diagnostic; unavailable final-status and nonexclusive-termination diagnostics
remain equally granular.

Keep retained peer-authorization diagnostics within the fixed containment
stage/reason allowlists, including the typed systemd `NoSuchUnit` category.
