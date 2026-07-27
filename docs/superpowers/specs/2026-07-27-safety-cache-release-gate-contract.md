# Safety cache release-gate contract

Status: **approved**

Companion to:
[Additional Safety boundaries design](./2026-07-27-additional-safety-boundaries-design.md).

## Summary

Semantic caching gains no new public Safety boundary or configuration surface.
A cache hit is an output candidate, not a durable approval. It passes through
the same current schema validation, output guardrails, and constraints as a
provider candidate before publication.

Input guardrails run before cache lookup and before cache-query embedding.
This prevents unscreened input from reaching the embedding provider or
selecting a cache entry.

## Lifecycle

```text
resolve input
  -> run input guardrails
  -> cache lookup using the approved query projection
  -> obtain cached or provider candidate
  -> validate current schema
  -> run current output guardrails
  -> run current constraints
  -> publish
  -> cache only the accepted result
```

The release gate is independent of candidate origin.

| Gate                        | Provider candidate    | Cached candidate                         |
| --------------------------- | --------------------- | ---------------------------------------- |
| Input guardrails            | Before provider I/O   | Before lookup/embedding                  |
| Schema validation           | Before release        | Before release                           |
| Output guardrails           | Before release        | Before release                           |
| Constraints                 | Before release        | Before release                           |
| Validation/constraint retry | Normal provider retry | Reject hit, then start live generation   |
| Observability               | Provider origin       | Cache origin and safe rejection category |

## Rejected cache candidates

A cached candidate rejected by current schema validation, an enforcing output
guardrail, or an enforcing constraint becomes a cache miss.

- Live generation begins through the normal provider lifecycle.
- Cache rejection consumes no provider step, retry, or billing budget.
- Report-mode findings do not reject the hit.
- The rejected entry is not globally evicted because another tenant, scope, or
  policy set may still accept it.
- A live candidate subsequently rejected by a gate follows normal retry or
  terminal behavior.

Constraint feedback may be used only after live generation begins. A stale
cached value is not a provider attempt and must not fabricate a retry round or
consume its budget.

## Writes

Only a candidate that has cleared current validation, output guardrails, and
constraints is eligible for a semantic-cache write. Persisted entries contain
the accepted canonical result, never an earlier raw provider candidate.

The cache plugin must not publish or persist through a path that bypasses the
owning operation's release gate. Generate and stream replay follow equivalent
rules.

## Identity and public API

Re-running current release gates is the correctness guarantee. Automatic
policy fingerprints may reduce unusable hits but cannot reliably fingerprint
arbitrary custom callbacks.

The existing public cache `version` remains useful for application-level
prompt, schema, or semantic changes. Users should not need to change it solely
because a guardrail or constraint changed.

No `boundary.cache.*`, Safety-specific cache option, or public cache-policy
fingerprint is added.

## Privacy-safe evidence

Cache decisions may retain:

- hit, miss, accepted, or rejected state;
- prompt and cache IDs already allowed by the cache contract;
- policy ID, boundary ID, constraint ID, and action; and
- a stable rejection category such as schema, guardrail, or constraint.

They never retain the cached text/object, rewritten value, failed validation
payload, guardrail subject, constraint feedback, embedding query, or provider
objects.

## Failure posture

- Cache transport/storage failures retain their existing configured behavior.
- Gate failures retain the gate's typed identity.
- Malformed guardrail or constraint results cannot release the cached value.
- If exact current validation cannot be performed, the cache candidate is
  rejected rather than treated as approved.
- Cancellation before or during live fallback stops the operation normally.

## Verification

Focused tests must prove:

1. input rewrites happen before cache-query embedding;
2. cache hits re-run current schema validation and output guardrails;
3. cache hits re-run current constraints;
4. report mode records without rejecting;
5. enforcing rejection falls through to one live provider call;
6. rejection consumes no provider retry or billing budget;
7. accepted canonical results, not pre-gate candidates, are written;
8. generate and stream replay have equivalent release guarantees; and
9. decisions and artifacts contain no candidate content.
