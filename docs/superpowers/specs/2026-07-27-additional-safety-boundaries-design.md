# Additional Safety boundaries design

Status: **approved**

Related: [#175](https://github.com/use-crux/crux/issues/175),
[#176](https://github.com/use-crux/crux/issues/176), and
[#261](https://github.com/use-crux/crux/issues/261).

Companion documents:

- [Cache release-gate contract](./2026-07-27-safety-cache-release-gate-contract.md)
- [TDD implementation plan](../plans/2026-07-27-additional-safety-boundaries-plan.md)

## Summary

Crux Safety boundaries describe semantic commit points, not every internal
lifecycle event. This design completes model ingress with provenance for
memory, handoff, and framework feedback; adds a canonical tool-exposure gate;
and makes the existing memory-write contract enforceable.

It does not add separate boundaries for system prompt construction, context
injection, memory reads, or agent handoff. Those names describe where content
was assembled rather than what it is about to do. Content that reaches a model
is governed at model ingress, with privacy-safe origin data identifying its
semantic owner.

## User problems

Applications need to prevent:

- recalled memory and shared blackboard state from becoming persistent prompt
  injection;
- handoff content produced by one agent from being obeyed by another;
- validation or constraint feedback from echoing unsafe content into a model;
- runtime-discovered tool descriptions from instructing the model;
- unapproved discovered tools from being offered at all;
- secrets, PII, or instruction-shaped content from becoming durable memory;
- stale cache entries from bypassing current Safety and quality policies; and
- audit evidence from retaining the content those policies protect.

The public API should answer three questions:

1. What is about to leave or enter a model trust boundary?
2. What action is about to execute?
3. What content is about to become durable?

Provenance answers where the content came from without creating another
boundary ID for every primitive.

## Taxonomy

Three approaches were considered.

### Destination plus provenance (selected)

Boundaries describe model ingress, model egress, tool behavior, or durable
commit. Typed origins describe user, tool, retrieval, memory, handoff,
feedback, instruction, or tool-source provenance.

This continues #261, keeps policy attachment predictable, and avoids evaluating
the same bytes once at context construction and again at model ingress.

### Per-primitive boundaries (rejected)

Names such as `system.prompt`, `context.inject`, `memory.read`, and
`agent.handoff` are discoverable in isolation but duplicate model ingress. They
also collide conceptually with observability primitives and invite a new
boundary for every future context family.

### Trust levels only (rejected)

Trusted/untrusted/derived labels are concise but discard attribution and make
source-specific policy, remediation, and Devtools presentation difficult.

## Model-text ingress

`TextInputSource` expands to:

```ts
export type TextInputSource =
  | "user"
  | "tool"
  | "retrieval"
  | "memory"
  | "handoff"
  | "feedback";
```

The existing optionless helper matches every supported text source:

```ts
boundary.input.text();
boundary.input.text({ from: "memory" });
boundary.input.text({ from: ["handoff", "feedback"] });
```

Origins are discriminated unions:

- `memory` includes `memory-context` and `blackboard-context`;
- `handoff` includes `handoff-context`; and
- `feedback` includes `validation-feedback` and `constraint-feedback`.

Blackboards use the `memory` source because they are shared state and are not
necessarily agent-authored. Exact kinds retain the distinction for policy
callbacks and Devtools.

Option selection must narrow `ctx.origin` without explicit generics. Invalid
source/shape combinations, such as memory media before canonical support
exists, remain compile-time errors.

## Instructions

`boundary.input.instructions()` continues to cover authored developer/system
instructions, ordinary contexts, skills, and trusted provider adaptations.
It gains privacy-safe origin coordinates such as context family and context ID,
but no source filter in this release.

The following helpers are not added:

- `boundary.system.prompt()`;
- `boundary.context.inject()`; and
- `boundary.skill.load()`.

A system-role message is not trusted merely because of its role. Resolver
provenance classifies each contribution before evaluation. Memory, blackboard,
handoff, retrieval, and feedback content must not fall through to instruction
guardrails.

## Tool exposure

Runtime-discovered tool definitions are an uncovered model-ingress shape.
This design adds:

```ts
boundary.input.tools();
boundary.input.tools({ from: "discovered" });
boundary.input.tools().descriptions();
```

The root subject is one canonical, provider-ready tool definition with its
name, description, compiled input schema, and privacy-safe origin.

Root actions are:

- `allow`;
- `warn`;
- `block`; and
- `strip`.

`strip` means the tool is not offered for the logical call. `block` terminates
the call. Report-mode strip records intent without changing the exposed set.
Arbitrary root rewrites are forbidden because changing names or schemas can
break execution integrity.

`.descriptions()` selects rewritable provider-visible description strings,
including JSON Schema title/description fields. It supports existing text
strategies and the closed text actions `allow`, `warn`, `block`, and `rewrite`.
Names and schema constraints are not silently rewritten.

Tool origins distinguish authored definitions from discovered definitions.
Discovered origins expose stable source ID and source kind, never transport
credentials, descriptions, or schemas.

The user-facing distinction is:

> `toolPolicy` controls what an offered tool may do.
> `boundary.input.tools()` controls what the model is told exists.

Static MCP `allow`/`deny` selection remains the simplest admission mechanism.
The new boundary adds global policy, report mode, runtime discovery checks, and
description inspection.

## Feedback ingress

Validation and constraint feedback are framework-produced model input:

```ts
boundary.input.text({ from: "feedback" });
```

`boundary.validation.feedback()` should be replaced before release when it is
still unreleased. If a published version exists, it becomes a deprecated
forwarding alias for one release rather than remaining authorable but inert.

An enforced block prevents the retry request. Feedback rewrites must be the
exact text delivered to the provider.

## Memory-write commit

`boundary.memory.write<T>()` remains a distinct durable commit gate and must
execute before persistence.

The order is:

1. apply block-local redaction;
2. run global memory-write guardrails;
3. validate the resulting candidate;
4. evaluate `shouldRemember`; and
5. persist.

Memory-specific results include:

- `rewrite`, followed by validation;
- `drop`, which suppresses persistence while allowing generation to succeed;
- `block`, which suppresses persistence and fails the operation; and
- ordinary `allow` and `warn`.

Malformed policy results and thrown policy errors never permit the write and
propagate as typed failures. Report mode records drop/block/rewrite intent
without mutating the candidate or suppressing persistence.

Blackboard writes should ultimately enter the same commit contract. Until then,
their `memory.write` spans are observability evidence rather than proof that
global memory guardrails executed.

## Boundaries not added

| Candidate                                       | Owning mechanism                                            |
| ----------------------------------------------- | ----------------------------------------------------------- |
| System prompt and ordinary context construction | `input.instructions()`                                      |
| Memory read entering a model                    | `input.text({ from: 'memory' })`                            |
| Handoff entering a model                        | `input.text({ from: 'handoff' })`                           |
| Retrieval result entering a model               | `input.text({ from: 'retrieval' })`                         |
| Retrieval query                                 | Tool policy or retriever preprocessing                      |
| Embedding input                                 | Embedding preprocessors and disclosure documentation        |
| Workspace and storage operations                | Authorization, mounts, limits, transactions                 |
| Observability export                            | Capture policy and #176                                     |
| Stream release                                  | Existing boundary refinements and stream commit gates       |
| Semantic-cache hits                             | Internal release-gate lifecycle; see the companion contract |
| Internal judge/summarizer/reranker calls        | Explicit disclosure follow-up                               |

## Failure posture and privacy

- No applicable policy preserves existing behavior.
- Authored policies default to enforce mode.
- Report mode records intent without enforcement.
- Malformed results, ambiguous provenance, and inexact writeback fail closed.
- Runtime and infrastructure errors retain their identity.
- Exact rewrites preserve adjacent resolver blocks byte-for-byte.
- Tool exposure runs once per logical call after discovery and normalization,
  before the first provider request.

Safety evidence may retain source kind, stable source ID, tool name, context ID,
memory/block ID, handoff ID, and feedback kind. It never retains prompt text,
memory or blackboard values, handoff payloads, feedback text, tool
descriptions, schemas, tool results, or provider objects.

## Project Index and Devtools

Project Index gains the canonical tool-ingress boundary ID and helper mapping.
`from` selectors remain syntax evidence only and are not materialized into
normalized Safety facts.

Indexer cache identities are updated only where unchanged source would produce
different static, semantic, or Go-owned snapshot output. Type-only source
expansion does not justify unrelated epoch bumps.

Devtools presents the canonical boundary, source label, safe identifier,
effective mode, action, and cache/provider candidate origin. TypeScript and Go
decision projections must remain equivalent.

## Release

This is new and corrected public behavior for `@use-crux/core`. Implementation
updates the existing
`.changeset/semantic-model-ingress-safety.md` release theme instead of creating
a duplicate changeset. Final bump levels must be checked against the published
surface; unreleased #261 behavior can remain within its pending minor release.

Internal cache lifecycle changes do not add a public cache API. They do change
runtime behavior by ensuring cached candidates receive current gates and must
be included in the user-facing release note.
