# Context-limit routing

## Goal

Allow model routing to recover when exact authorized input fits neither the selected model's context capacity nor its configured input budget.

## Design

Add `input_limit` to the public `ErrorCategory` taxonomy. Classify a `RequestCompositionError` with code `REQUEST_TOO_LARGE` as `input_limit`, including when an adapter boundary preserves it in a bounded, cycle-safe `cause` chain.

Routing wrappers may retain multiple underlying errors. An exhausted fallback or aggregate classifies as `input_limit` only when its non-empty bounded error collection unanimously classifies as `input_limit`; mixed or unknown collections remain unclassified. This lets an outer cascade escalate a nested all-capacity fallback without relabeling mixed provider failures.

An ordered `fallback()` treats `input_limit` like other classified failures and tries its next candidate by default. A `cascade()` tier may opt into `escalateOn: ['input_limit']`. Routing `retry()` must not retry the same model for this category because its capacity cannot change between attempts. Its public `on` type excludes `input_limit`, and runtime logic rejects retry even for untyped JavaScript/configuration input.

Other request-composition failures remain unclassified. Existing custom `shouldFallback` behavior and safety-policy terminal behavior remain unchanged.

Update the public routing reference and guides so the category and the fallback/cascade distinction are discoverable.

## Verification

Test direct and adapter-wrapped `REQUEST_TOO_LARGE` classification, unanimous and mixed exhausted-wrapper classification, default fallback to a larger-capacity candidate, explicit cascade escalation, and compile-time plus runtime absence of same-model retry. Preserve existing behavior for unrelated request-composition errors.
