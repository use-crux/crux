# Additional Safety boundaries — TDD implementation plan

Status: **ready to implement**

Specifications:

- [Boundary design](../specs/2026-07-27-additional-safety-boundaries-design.md)
- [Cache release-gate contract](../specs/2026-07-27-safety-cache-release-gate-contract.md)

## Operating protocol

Work in the order below. Every task uses red-green-refactor:

1. Add the smallest focused failing runtime or type test.
2. Run it and confirm it fails for the intended reason.
3. Add the minimum production behavior.
4. Run the focused test until green.
5. Refactor types, JSDoc, and module boundaries while green.
6. Run the affected package typecheck before moving on.

Tests assert public behavior and provider-visible requests rather than private
helper calls. Provider tests use fakes and perform no network I/O.

## Delivery order

### 1. Model-ingress types

- Add type tests for `memory`, `handoff`, and `feedback`.
- Prove scalar and readonly-tuple `from` selections narrow `ctx.origin`.
- Prove unsupported media/source combinations remain errors.
- Add the source/origin contracts and public helper JSDoc.

### 2. Resolver classification

- Prove memory recall is evaluated as `memory`, not instructions.
- Prove blackboard context is `memory` with `blackboard-context`.
- Prove handoff context is `handoff`.
- Extract one exhaustive context-family classifier before widening behavior.

### 3. Exact writeback

- Cover standalone `system` delivery and folded system-message delivery.
- Rewrite one selected block while preserving adjacent blocks byte-for-byte.
- Cover mid-run skill amendments through the same classification path.
- Fail closed on provenance or writeback mismatch.

### 4. Feedback ingress

- Prove validation and constraint feedback run as `feedback` before re-prompt.
- Prove enforced rewrite reaches the provider exactly.
- Prove block prevents the retry request.
- Replace or deprecate `boundary.validation.feedback()` according to the
  published surface.

### 5. Memory-write commit

- Prove rewrite occurs before validation and persistence.
- Cover drop, block, warn, report mode, thrown callbacks, and malformed results.
- Prove unsafe candidates are never persisted.
- Route blackboard writes through the same contract when runtime ownership is
  available.

### 6. Tool exposure

- Add root subject/action type tests.
- Prove discovered-tool strip removes the tool from provider exposure and
  executable loop state.
- Cover authored/discovered origin narrowing, block, and report mode.
- Add `.descriptions()` and prove existing text strategies rewrite exact
  provider-visible descriptions without changing names or constraints.

### 7. Evidence and static analysis

- Prove decisions retain identifiers but no protected content.
- Add TypeScript and Go presentation parity.
- Add TypeScript and Rust/Oxc Project Index parity for the new helper/ID.
- Update only cache identities whose unchanged-source output changes.

### 8. Cache release gate

- Implement the companion cache contract one failing behavior at a time.
- Run input guardrails before lookup embedding.
- Re-run validation, output guardrails, and constraints on cache hits.
- Fall through to live generation when an enforcing gate rejects a hit.
- Verify budgets, generate/stream parity, writes, and privacy-safe evidence.

### 9. Documentation and release

- Update Safety, guardrail, memory, validation-retry, tool, and cache guides.
- Put memory recall and memory write next to each other and explain direction.
- Explain tool exposure versus tool execution policy.
- Document internal judge/summarizer/reranker disclosure as a limitation and
  open companion work rather than implying current guardrail coverage.
- Update `.changeset/semantic-model-ingress-safety.md`; do not create a
  duplicate changeset.

## Module boundaries

Follow the `define-adapter-types.ts` / `define-adapter.ts` separation:

```text
safety/
  input-origin.ts
  input-boundary.ts
  input/
    ingress-source.ts
    feedback.ts
    tool-exposure-types.ts
    tool-exposure-boundary.ts
    tool-exposure.ts
  memory-write.ts
```

Extract the per-block branch from `resolved-system.ts` before it crosses 300
lines. Do not add Safety execution concerns to the existing large handoff or
blackboard modules. Keep new production and test files below 300 lines and
split contracts, execution, projection, and presentation when they diverge.

## Public JSDoc contract

Every new public helper and interface includes:

- one semantic summary;
- `@remarks` for lifecycle and security behavior;
- `@param`, `@returns`, and relevant `@throws`;
- `@default` for every optional behavior;
- focused `@example` blocks for inferred origins and report mode; and
- JSDoc on every public option, subject, and origin field.

Use the concise adapter/AI SDK/Next.js style. Examples must not imply that
system role equals trust, that memory reads and writes are the same direction,
or that tool exposure policy governs execution.
