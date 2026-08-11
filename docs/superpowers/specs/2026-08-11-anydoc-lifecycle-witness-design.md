# AnyDoc lifecycle witness design

## Purpose

This design makes terminal workload reporting and cleanup proof separate,
fail-closed facts. It applies to the existing AnyDoc worker boundary only. It
does not enable production routing, relax containment admission, or change a
public API.

## Two independent facts

`WorkloadOutcome` answers what happened to the work. It is one of:

- `success`, after strict accepted output validation;
- `oom`, from the verified memory-limit signal;
- `crash`, for an unexpected worker/runtime termination;
- `cpu-timeout` or `wall-timeout`, from the corresponding verified limit;
- `aborted`, for a host cancellation or teardown before another outcome.

`CleanupProof` answers only whether the execution was reclaimed. It is accepted
only when the exact systemd unit is gone or inactive **and** its exclusively
pinned cgroup is empty or absent. It never upgrades, implies, or substitutes
for `WorkloadOutcome.success`.

## Internal witness and verification order

`LifecycleWitness` is an opaque internal value: adapters and callers cannot
construct, serialize for reuse, or infer one from a status field. The central
supervisor mints it only after all of the following pass, in order:

1. verify the run's unit, cgroup, runtime and PID identity;
2. verify the exact expected peer and one-use authorization/capability;
3. strictly validate either the output envelope or the required observation;
4. refresh resource accounting from the authoritative host records; and
5. receive and validate the host acknowledgement for that exact identity.

The witness binds the unit name, cgroup path, runtime instance, PID/start-time
identity, and exactly one request identity or sealed-probe identity. A mismatch,
missing field, stale identity, duplicate acknowledgement, or unverifiable host
record rejects the witness.

## Adapter boundary

Normal AnyDoc adapters submit a request identity and may return a validated
result candidate. The central verifier alone maps it to `WorkloadOutcome` and,
separately, may mint a witness.

The sealed hostile-probe adapter is intentionally narrower: it has a sealed
probe identity, expected observation contract, and no authority to claim a
normal parse result. Its expected failure is an observation, not success. Both
adapter paths use the same identity binding, central verification, accounting,
host ACK, and cleanup acceptance rules.

## Rejection matrix

| Condition | Workload outcome | Cleanup proof | Witness |
| --- | --- | --- | --- |
| Exact valid output and verified host records | `success` | independently pending/accepted | mint only after ACK |
| Verified OOM, crash, CPU/wall limit, or abort | mapped typed outcome | independently pending/accepted | never a success witness |
| Invalid/oversized/mismatched output | `crash` or typed invalid-result failure | independently pending | reject |
| Wrong peer, auth, unit/cgroup/runtime/PID, request/probe | unresolved/failed closed | reject | reject |
| Missing/stale/duplicate ACK or accounting refresh | retain non-success/unresolved state | reject | reject |
| Unit active, wrong unit, cgroup populated, or non-exclusive cgroup | outcome unchanged | reject | reject cleanup-linked completion |
| Host observation unavailable or ambiguous | fail closed | reject | reject |

No fallback accepts process exit alone, a parser result alone, a cgroup limit
alone, a hostile-probe expectation alone, or cleanup alone.

## Evidence artifacts

The supervisor retains an internal, redacted evidence chain:

`sealed request/probe -> launch authorization -> identity observations -> output or probe observation -> refreshed accounting -> host ACK -> WorkloadOutcome + CleanupProof -> LifecycleWitness`.

Artifacts are keyed by the bound identity, include verifier/version and source
timestamps, and are immutable once recorded. Operator-facing views expose only
safe outcome, cleanup state, and diagnostic codes; they do not expose capability
material, raw payloads, or reusable witness data.

## Migration and removal

Introduce the central verifier behind the existing internal boundary, first
emitting both legacy facts and the new evidence chain for local comparison.
Then make consumers require the witness where they currently combine
`terminalSuccessProof` and `resultACK`. Remove those bespoke fields and their
duplicate validation paths only after every normal adapter and sealed hostile
probe adapter uses the verifier. Preserve explicit outcome and cleanup fields;
do not replace them with a boolean witness. This is documentation-only and
creates no production routing change.

## Validation plan

Local tests cover exact identity/auth/ACK binding, strict output and probe
observation validation, every outcome mapping, accounting refresh, evidence
immutability, and each rejection row. They also prove that accepted cleanup
cannot produce success and that success without accepted cleanup remains
distinct.

A real Linux systemd gate exercises dedicated exclusive cgroup creation,
normal completion, OOM, crash, CPU and wall timeout, abort, stale PID/unit
reuse, forged/missing ACK, and descendant cleanup. It accepts cleanup only for
the exact inactive/gone unit plus empty/absent pinned cgroup. Runners without
the required delegated systemd/cgroup-v2 capability report infrastructure
unavailable; they never report a containment or cleanup pass.

## Rejected alternatives

- **Hostile-only cleanup duplication:** giving hostile probes a separate cleanup
  proof duplicates security-critical lifecycle logic and lets normal adapters
  drift. One central verifier serves both paths.
- **Case-by-case exceptions:** accepting a result, exit status, or cleanup based
  on adapter-specific exceptions weakens identity binding and makes future
  adapters unsafe by default. The contract stays exact and fail-closed.
