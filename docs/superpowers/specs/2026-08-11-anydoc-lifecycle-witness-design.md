# AnyDoc lifecycle witness design

## Purpose

This design makes terminal workload reporting, containment-probe reporting, and
cleanup independently verified, fail-closed facts at the existing AnyDoc worker
boundary. It does not enable production routing, relax containment admission,
or change a public API.

## Independent facts

`WorkloadOutcome` is a closed, deterministic value for every normal execution:
`success`, `invalid-result`, `oom`, `crash`, `cpu-timeout`, `wall-timeout`,
`aborted`, or `unverified`. `invalid-result` means a result was presented but
failed the strict envelope/size/identity validation. `unverified` means no
single trusted terminal account can be established, including missing evidence,
identity mismatch, or conflicting trusted evidence; it is never silently
coerced to `crash` or `success`.

Trusted host evidence is evaluated before peer output: a verified cancellation
or resource-limit record wins over a later result candidate; otherwise the
earliest trusted terminal record wins (ties use the listed order: `aborted`,
`wall-timeout`, `cpu-timeout`, `oom`, `crash`, `invalid-result`, `success`). A
conflict in run identity, ordering, or terminal records that cannot be resolved
by that rule produces `unverified`. Untrusted or merely peer-supplied claims
never override trusted evidence.

`ProbeOutcome` is separate and closed: `contained`, `breach`, or `unverified`.
For a sealed containment probe, `contained` means the exact sealed action was
observed to be denied or contained according to its contract, with no permitted
side effect outside its declared boundary. It is not `WorkloadOutcome.success`.
A probe may mint a `ContainmentProbeWitness` only for `ProbeOutcome.contained`;
a normal request may mint a `ResultAckWitness` only for
`WorkloadOutcome.success`.

`CleanupProof` concerns only the original execution's processes and cgroup.
It is accepted only when the original systemd invocation has a verified terminal
stop record and its exclusively pinned cgroup is empty or absent. It does not
mean that staged files, private directories, or sockets were removed.
`ArtifactCleanupProof` separately verifies teardown of the run-bound staging
area, private area, and declared sockets. Overall cleanup is accepted only when
both proofs are accepted, but neither proof upgrades, implies, or substitutes
for an outcome or witness.

## Run identity, witness, and acknowledgement

At launch the supervisor records an immutable run identity: host boot ID,
systemd manager identity, unit name, systemd `InvocationID`, invocation/start
monotonic timestamps, cgroup path and inode, runtime instance, and main
PID/start-time. Later evidence must bind to this original invocation, not just
a currently matching unit name or cgroup path. A name/cgroup reuse, PID reuse,
missing stop record, or a different invocation fails closed.

Witnesses are opaque, internal, one-use capabilities. The central verifier
alone follows this required order: it validates the bound run identity,
peer/capability, and result or probe observation; calls `RefreshAccounting`
to obtain the exact verified authoritative snapshot; successfully writes the
verified host ACK for that exact request/probe binding (peer receipt
confirmation is not required); and only then atomically mints the immutable
`ResultAckWitness` or `ContainmentProbeWitness`. An ACK write failure mints no
witness. The ACK and witness cannot be replayed, duplicated, transferred to
another run, or reused for cleanup.

Witness minting is independent of cleanup. Cleanup may still be pending or may
later fail after a valid witness; conversely cleanup can never mint one.

## Adapter boundary and evidence

Normal adapters submit a request identity and result candidate. Sealed hostile
probe adapters submit a sealed probe identity and observation candidate, with
no authority to claim a normal parse result. The central verifier maps each
candidate to its appropriate closed outcome and mints only its corresponding
witness.

The supervisor retains an internal, redacted, immutable evidence graph:

`sealed request/probe -> launch authorization -> original run identity -> result/probe observation + refreshed accounting -> WorkloadOutcome/ProbeOutcome -> verified host ACK -> result/probe witness`

`original run identity -> process/cgroup observations -> CleanupProof`

`original run identity -> staged/private/socket observations -> ArtifactCleanupProof`

Artifacts are keyed by the bound identity and include verifier/version and
source timestamps. Operator views expose only safe outcomes, cleanup states,
and diagnostic codes; never capabilities, raw payloads, or reusable witnesses.

## Rejection matrix

| Condition | Recorded fact | Witness/cleanup effect |
| --- | --- | --- |
| Valid result, authoritative records, then host ACK | `WorkloadOutcome.success` | mint one `ResultAckWitness`; cleanup independent |
| Valid contained probe, authoritative records, then host ACK | `ProbeOutcome.contained` | mint one `ContainmentProbeWitness`; cleanup independent |
| Invalid/oversized/mismatched result | `WorkloadOutcome.invalid-result` | reject result witness |
| Verified cancellation, limit, or crash | corresponding `WorkloadOutcome` | reject result witness |
| Missing, stale, contradictory, or unverifiable trusted evidence | `unverified` outcome | reject witness and affected proof |
| Wrong peer/capability/run identity or duplicate ACK | `unverified` outcome | reject witness and affected proof |
| Original invocation not terminal, cgroup nonempty/nonexclusive, or reused | outcome unchanged | reject `CleanupProof` |
| Staged/private path or declared socket remains or is unverifiable | outcome unchanged | reject `ArtifactCleanupProof` |

No fallback accepts exit status, parser output, a cgroup limit, hostile-probe
expectation, ACK, or either cleanup proof alone.

## Migration and removal

Introduce the central verifier behind the existing internal boundary and emit
the legacy facts alongside the new evidence chain for comparison. Persist the
determined `WorkloadOutcome` before any cleanup attempt. A cleanup failure may
make overall lifecycle completion fail closed, but never overwrites that stored
outcome.

During compatibility, legacy consumers use `terminalSuccessProof` **or**
`resultACKWitness` on their respective legacy fallback paths; these are not two
facts to combine and neither is a new witness. Move each consumer to the new
typed witness, then remove both legacy fallbacks and duplicate validation only
after all normal and sealed-probe adapters use the verifier. Preserve explicit
outcome and both cleanup fields; do not replace them with a boolean witness.

## Validation plan

Local tests cover closed outcome mapping and precedence, trusted-evidence
conflicts, one-use ACK binding, result/probe distinction, witness independence
from cleanup, and both cleanup proofs. A real Linux systemd gate covers normal
completion, each terminal outcome, stale PID/unit/name/cgroup reuse, forged or
missing ACK, descendants, and staged/private/socket teardown. It reports
infrastructure unavailable when delegated systemd/cgroup-v2 support is absent;
it never reports containment or cleanup pass.

## Rejected alternatives

- **Hostile-only cleanup duplication:** separate probe cleanup logic lets
  adapters drift. One central verifier produces distinct typed facts.
- **Case-by-case exceptions:** accepting a result, exit status, or cleanup from
  adapter-specific exceptions weakens binding. The contract remains exact and
  fail-closed.
