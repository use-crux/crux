# Handover: Injectable Intelligence Backend Data

This handover records the backend and read-model work that exposes deeper prompt/context/injectable assembly intelligence. It is intentionally not a visual specification. The goal is to give product/design enough structured context to decide how to reveal authored possibilities, conditional branches, effective schemas, and runtime observations without the UI guessing from source snippets.

## What Is Now Available

The Project Index now treats `injectable(...)` definitions as first-class source-authored definitions alongside prompts, contexts, tools, memory, blackboards, and other Crux primitives.

For prompts, contexts, and injectables, the index can expose:

- Direct and indirect `use` entries, including arrays and simple spreads.
- Resolved target identity when TypeScript can prove it: `targetDefinitionId`, `targetKind`, `targetName`, relation type, and fidelity.
- Conditionality for helper-shaped entries:
  - `always`
  - `when`
  - `match-case`
  - `match-default`
  - `binary-guard`
  - `dynamic`
  - `unknown`
- Branch labels for `match(...)` entries where available.
- Injected tool facts from prompt/context `tools` maps and simple injectable `inject` callback return objects.
- Dynamic/partial markers when code is visible but not statically resolvable.
- Injectable return contribution facts for `constraints`, `guardrails`, and `metadata` keys.
- Effective input contracts:
  - authored `inputSchema`
  - derived `expandedInputSchema`
  - field-level `inputContributions` explaining which injected definition contributed each field.
- Condition source refs for `when(...)`, `match(...)`, and guarded `&&` use entries, including source snippets and branch metadata when known.

## Where It Lives

Static and semantic authoring truth is exposed through:

```txt
GET /api/project/index
GET /api/index
```

Relevant fields are on `ProjectDefinition` objects:

- `kind: "injectable"` for injectable definitions.
- `metadata.facts.useEntries` for normalized use-entry facts.
- `metadata.facts.tools` for injected tool facts.
- `metadata.facts.mayInject` for broad injection capability hints.
- `metadata.facts.contributions` for non-tool injectable return contributions.
- `metadata.intelligence.contract.inputSchema`
- `metadata.intelligence.contract.expandedInputSchema`
- `metadata.intelligence.contract.inputContributions`
- `sourceRefs` with `metadata.extensions.injectionCondition`, `via`, and optional `branch`.

Runtime-observed injection truth is exposed separately through:

```txt
GET /api/project/index/observed-injection?limit=250
```

That endpoint aggregates recent observability traces and returns:

```ts
interface ObservedInjectionReadModel {
  schemaVersion: 1
  runCount: number
  contributionCount: number
  sources: ObservedInjectionSource[]
  inputs?: ObservedPromptInput[]
  drift?: ObservedInjectionDrift[]
}

interface ObservedInjectionSource {
  id: string
  sourceId: string
  definitionId?: string
  definitionKind?: string
  injectableKind?: string
  observedCount: number
  includedCount: number
  excludedCount: number
  droppedBudgetCount: number
  promptIds?: string[]
  runRefs?: ObservedInjectionRunRef[]
  states?: ObservedInjectionCount[]
  injects?: ObservedInjectionCount[]
  tools?: ObservedInjectionCount[]
  branches?: ObservedInjectionBranchCount[]
  cacheStatuses?: ObservedInjectionCount[]
  indexMatch?: ObservedInjectionIndexMatch
  toolIndex?: ObservedInjectionToolIndex[]
}
```

The runtime endpoint currently reads `context.contribution` artifacts, `prompt.budget.dropped` entries, and redacted `prompt.input` previews. It can surface contexts, injectables, memory, blackboards, tools, branch labels, budget drops, and prompt input-key validation summaries when runtime captured those previews.

`inputs` aggregates prompt-level runtime input-key summaries:

```ts
interface ObservedPromptInput {
  promptId: string
  observedCount: number
  passedCount: number
  failedCount: number
  notConfiguredCount: number
  validationStatuses?: ObservedInjectionCount[]
  providedKeys?: ObservedInjectionCount[]
  schemaKeys?: ObservedInjectionCount[]
  requiredKeys?: ObservedInjectionCount[]
  missingKeys?: ObservedInjectionCount[]
  unexpectedKeys?: ObservedInjectionCount[]
  runRefs?: ObservedInjectionRunRef[]
}
```

The runtime records only top-level key names and validation status. It does not record field values.

The endpoint also compares runtime observations with the current Project Index:

- `indexMatch.status`
  - `indexed`
  - `not-indexed`
  - `indexed-not-predicted-for-prompt`
  - `runtime-only`
  - `unknown`
- `indexMatch.predictedByPromptIds` lists observed prompt ids that the authored relation graph connects to the observed source.
- `toolIndex.status`
  - `predicted`
  - `indexed-not-predicted-for-source`
  - `not-indexed`
- top-level `drift` contains soft review leads such as:
  - `runtime.observed_source_not_indexed`
  - `runtime.observed_source_not_predicted_for_prompt`
  - `runtime.observed_tool_not_indexed`
  - `runtime.observed_tool_not_predicted_for_source`

These are not lint findings yet. They are trace-versus-index comparison evidence and should be presented as reviewable runtime signals, not as proof that authored source is wrong.

## Why Runtime Data Is Separate

`/api/project/index` is source-derived design truth:

- It answers what the project appears able to do.
- It is deterministic for a given source tree and indexer version.
- It is appropriate for source navigation, schema expansion, and authored lint findings.

`/api/project/index/observed-injection` is trace-derived runtime truth:

- It answers what actually happened in recent runs.
- It depends on available observability data and the `limit` query parameter.
- It is incomplete by nature; an unobserved branch may simply not have run yet.

Keeping these planes separate prevents runtime traces from mutating or overstating the authored Project Index. A UI can still compose them into a "possible vs observed" experience, but it should keep the reliability distinction visible.

## Reliability Notes

High confidence:

- Direct injectable definitions.
- Direct/import-safe prompt/context/injectable `use` arrays.
- Imported schemas and tool maps with statically visible initializers.
- `when(...)`, `match(...)`, and guarded `&&` source refs when helper shapes are recognizable.
- Runtime observed source ids, states, tools, branches, and budget drops when emitted as structured observability artifacts.

Medium confidence:

- Branch labels from complex `match(...)` config objects.
- Tool maps with spreads where some members are resolvable and some are dynamic.
- Injectable `inject` callbacks that return simple object literals or imported/spread tool maps.

Explicitly partial/dynamic:

- Computed `use` arrays.
- Runtime-dependent tool maps.
- Callback bodies that branch in ways static analysis cannot safely reduce.
- Any code path that would require executing user code to know the result.

Not available yet:

- Static-vs-runtime drift lint rules. The endpoint now exposes comparison evidence, but promoting that evidence into lint findings still needs product/design decisions around severity, stale traces, and suppression behavior.

## Design Opportunities

The data supports several possible surfaces. These are prompts for design, not requirements:

- A prompt/context detail area that distinguishes authored input from effective input.
- Field-level provenance for effective input schema fields.
- Conditional badges or branch groupings for `when`, `match`, and guarded contributions.
- A dependency section that separates direct dependencies from deep injected dependencies.
- A tool-surface section that distinguishes authored tools from injected tools.
- A "possible vs observed" runtime panel that shows observed counts, branches, tools, and recent run refs.
- A runtime comparison panel that distinguishes "indexed", "not indexed", and "observed but not statically predicted".
- A runtime input-key panel that shows missing/unexpected key counts without exposing values.
- Reliability markers for resolved, partial, dynamic, and runtime-observed facts.
- Source-ref affordances that link conditional lints back to the controlling `when`/`match`/guard expression.

## Current Implementation Files

Static/semantic indexer:

- `packages/indexer/indexer/static/injection-read-model.ts`
- `packages/indexer/indexer/semantic/model/definitions.ts`
- `packages/indexer/indexer/semantic/model/relations.ts`
- `packages/indexer/indexer/semantic/model/source-refs.ts`
- `packages/indexer/indexer/lints/findings.ts`

Runtime observed read model:

- `packages/local/internal/devtools/observed_injection_readmodel.go`
- `packages/local/internal/devtools/devtools_service.go`
- `packages/local/internal/server/http.go`
- `packages/local/internal/devtools/observability_readmodels_test.go`

Docs/plan:

- `../../plans/crux-injectable-intelligence-lints-and-runtime-plan.md`
- `apps/docs/content/docs/reference/crux-core/project-index.mdx`
- `apps/docs/content/docs/guides/observability/devtools.mdx`
