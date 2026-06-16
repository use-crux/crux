# ADR 0009: Code Is Config For Project Discovery

Status: Accepted

Date: 2026-06-16

## Context

Crux's mission is "Same Prompt. Same Output. Every Time." The harness graph has to be observable and
testable, but users should not have to maintain a second registry that repeats the graph they already
authored in code.

The current `config()` surface can become a trap because it mixes several different concerns:

- primitive registration, such as prompts, contexts, and tools;
- runtime behavior, such as plugins, stores, observability, and middleware;
- local Quality discovery and run defaults;
- indexer extension trust and lint policy;
- future cloud/training upload, retention, and raw-content policy.

That mix creates "forgot to add it to config" failures even when the code already contains enough
information for Crux to discover the relationship. It also makes future cloud/dashboard config risk
becoming a second product model.

The product direction should match proven developer-tooling patterns:

- Vercel detects frameworks and uses project config to override defaults for builds, routing, and
  related behavior.
- Vite resolves a conventional config file automatically and lets the CLI override the config path.
- Tailwind CSS v4 moved toward automatic source detection, ignores generated/dependency paths by
  default, and offers explicit source overrides when heuristics are not enough.
- Turborepo treats config as behavior, task, input, and cache policy rather than a restatement of
  every source file.

Crux should apply the same lesson to harness engineering: infer ordinary project structure and
authored relationships, then require explicit config only at trust, privacy, cost, persistence,
upload, or behavior boundaries.

## Decision

Crux project discovery follows this rule:

> Explicit construction decides behavior; Crux discovery provides visibility.

Local tooling must not require duplicate primitive registration when authored source already contains
the relationship. The Project Index and local runtime evidence are responsible for discovering:

- prompts, contexts, tools, memories, retrieval definitions, flows, agents, safety definitions,
  scorers, and quality suites;
- `use[]` relationships and prompt/context tree paths;
- source roots, package roots, workspace roots, package manager, and framework/runtime signals;
- conventional Quality assets such as `*.eval.ts`, `.crux/quality`, cassettes, and baselines;
- runtime joins from stable ids and emitted attributes.

Config is reserved for policy, trust, overrides, and explicit behavior:

- source include/exclude overrides and unusual monorepo roots;
- lint profiles and rule options;
- third-party Indexer Extension references and trust policy;
- custom tokenizer defaults;
- runtime plugins, stores, model/provider choices, and production telemetry;
- cloud upload, training export, raw-content capture, redaction, retention, and tenant policy;
- destructive workspace permissions and other explicit capability boundaries.

Every resolved project-model field should carry provenance:

- `source`: inferred from authored source;
- `runtime`: observed from runtime evidence;
- `filesystem`: loaded from local conventions such as `.crux/quality`;
- `config`: explicitly provided by project config or CLI policy.

If inference is ambiguous or incomplete, Crux emits diagnostics. Diagnostics should prefer fixes such
as "add a stable id", "make this relationship statically visible", "add an include override", or
"choose an explicit trust/policy boundary." They should not default to "add this primitive to config"
unless the missing value is actually policy, trust, ownership, cost, privacy, or persistence.

## Consequences

- A future local tooling experience can work with no `crux.config.ts` for conventional projects.
- `crux.config.ts` becomes smaller and clearer: policy and behavior, not primitive inventory.
- `crux config inspect` or an equivalent Project Model view becomes important because users need to
  see what Crux inferred, what came from runtime evidence, and what came from explicit policy.
- Quality discovery should default to package id, `.crux/quality`, `evals/**/*.eval.ts`, and
  `**/*.eval.ts`.
- Ambient `quality.setup` should become a compatibility path rather than the recommended model-backed
  eval pattern. Evals should import explicit local helpers for executor/model choices when possible.
- Replay posture should be primarily a CLI/run-tier decision such as `--ci`, `--replay
  replay-strict`, `--replay live`, or `--replay record-new`.
- Local devtools auto-attachment is acceptable only for local Crux dev environments. Production
  telemetry and cloud export remain explicit.

This ADR narrows older config examples that used `config({ prompts, ... })` as the main local tooling
path. Those examples can remain as runtime compatibility or escape hatches, but new local tooling
docs and APIs should lead with source discovery.

## Validation

Implementation should proceed test-first through public behavior:

1. A conventional project with eval files and no `crux.config.ts` can be discovered by Quality
   tooling.
2. A project with authored prompts/contexts/tools but no primitive registry still appears in the
   Project Index when source discovery can prove it.
3. Ambiguous dynamic code produces diagnostics with suggested fixes instead of silently disappearing.
4. Explicit policy config overrides discovery without duplicating primitive relationships.
5. The resolved Project Model exposes inferred versus explicit provenance.
6. Type-level tests protect the discriminated provenance/diagnostic unions with exhaustive handling.

Tests should use public APIs and CLI-facing seams where practical. Avoid tests that couple to private
scanner helper names.
