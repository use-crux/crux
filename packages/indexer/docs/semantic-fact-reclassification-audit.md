# Semantic Fact Reclassification Audit

Status: Phase 5 working note
Date: 2026-07-06

This audit classifies every Project Index fact surface currently emitted by the
semantic tier. The goal is to decide which facts need TypeScript type
information and which only need scope, binding, declaration, and syntax shape
evidence that can move into the Rust/Oxc static+scope tier.

The current first-party semantic analyzers do not call `typesAt` or
`typeStrings` when producing Project Index facts. They use compiler-backed
symbol and declaration resolution through `resolveSemanticExpression`, plus
syntax readers for object, array, call, return, and literal shapes. The
`SemanticReadModel.typeOf` API remains a real `needs-types` surface for
extensions and future rules, but it is not one of the first-party semantic fact
rows below.

| Fact surface | Current semantic producer | Evidence required | Classification | Rust/static move target |
| --- | --- | --- | --- | --- |
| Schema metadata on definitions (`inputSchema`, `outputSchema`, `argsSchema`, `schema`) | `semantic/analyzers/schema.ts` | Resolve schema identifier/property references, read Zod/Convex validator call/object syntax, follow top-level schema constants. | `needs-only-bindings` | Move schema expression resolution and JSON schema projection into Rust/Oxc once schema fixtures are snapshotted. |
| Schema source refs, including nested schema refs | `semantic/analyzers/schema.ts`, `semantic/model/source-refs.ts` | Resolve declarations for schema expressions and nested schema identifiers. | `needs-only-bindings` | Emit as Rust source refs alongside schema metadata. |
| Direct source refs for callback/config properties | `semantic/analyzers/source-ref.ts`, `semantic/source-ref-candidates.ts` | Resolve property initializer declarations for prompt/context/tool/agent/routing callback fields. | `needs-only-bindings` | Emit during Rust config-object projection using Oxc references and declaration spans. |
| Template interpolation source refs | `semantic/analyzers/source-ref.ts`, `semantic/model/source-refs.ts` | Walk template expressions and resolve referenced fragments/functions. | `needs-only-bindings` | Move with source-ref projection after Rust can scan template expression children with scope references. |
| Tool-map source refs | `semantic/analyzers/source-ref.ts`, `semantic/model/source-refs.ts` | Resolve tool map object properties, spreads, and declaration-backed tool map constants. | `needs-only-bindings` | Move with Rust object/spread projection for `tools` properties. |
| Injection condition source refs | `semantic/analyzers/source-ref.ts`, `semantic/model/source-refs.ts` | Resolve condition callback/object/array declarations without evaluating user code. | `needs-only-bindings` | Move with Rust condition-object traversal. |
| Injection `useEntries`, tool facts, and return contributions | `semantic/enrichment-facts.ts` | Resolve `use` arrays/spreads, tool map entries, simple injectable return objects, and contribution object refs. | `needs-only-bindings` | Move into Rust prompt/context/injectable primitive projection; keep unresolved/dynamic entries as static facts. |
| Routing child definitions and target source refs | `semantic/enrichment-facts.ts` | Read local router/cascade/fallback route/tier/option objects and resolve targets. | `needs-only-bindings` | Already covered in tsgo direct projectors; move the canonical emitter into Rust routing projection before deleting TS first-party extraction. |
| Routing target relations | `semantic/relation-facts.ts` | Resolve route/tier/fallback target expressions to known definition ids. | `needs-only-bindings` | Emit from the same Rust routing child projection to avoid duplicate graph logic. |
| Agent prompt, routing, tool, and literal handoff relations | `semantic/relation-facts.ts`, `semantic/agent-handoff-relations.ts` | Resolve config property targets, tool map entries, and literal/static handoff ids. | `needs-only-bindings` | Move into Rust agent primitive projection. |
| Prompt/context/injectable relation edges | `semantic/relation-facts.ts` | Resolve `use` arrays, tool maps, and simple injectable return objects to definition targets. | `needs-only-bindings` | Move with Rust injection fact projection. |
| Flow step target relations | `semantic/relation-facts.ts` | Scan flow handler bodies for `step(label, target)` calls and resolve target arguments. | `needs-only-bindings` | Move after Rust function-body traversal can resolve local helper references precisely. |
| Composition and RAG recipe relations | `semantic/relation-facts.ts` | Read object/array config shapes and resolve participant, retriever, scorer, judge, reranker, and step targets. | `needs-only-bindings` | Move into Rust composition/RAG primitive projection with binding-aware target resolution. |
| Storage metadata, source refs, and relations | `semantic/storage-facts.ts` | Resolve storage factory calls, bundle/scope references, and primitive storage config targets. | `needs-only-bindings` | Move into Rust storage projection; preserve typed metadata shape before replacing `serde_json::Value` where feasible. |
| Memory block definitions/metadata/schema refs | `semantic/enrichment-facts.ts` | Resolve `blocks` arrays/spreads, block factory calls, optional block schemas, and block schema declarations. | `needs-only-bindings` | Move into Rust memory projection; reuse the schema projection path for block schemas. |
| Workspace mount metadata and mount-path relations | `semantic/enrichment-facts.ts` | Read `mounts` arrays, mount object literals, source helper calls, and literal properties. | `needs-only-bindings` | Move into Rust workspace projection. |
| Callback access relations (`reads_*`, `writes_*`, `queries_retriever`, `uses_scorer`, `runs_eval`) | `semantic/access-relations.ts` | Resolve callback functions/helpers and scan call expressions against known target definitions. | `needs-only-bindings` | Move only after Rust owns scope-aware function-body traversal and one-level helper following. |
| Safety target relations | `semantic/relation-facts.ts` | Resolve `appliesTo`/`target`/`targets`/`for` expressions. | `needs-only-bindings` | Move into Rust constraint/guardrail projection. |
| Index lint findings from semantic graph | `semantic/analyzers/lint-fact.ts` | Inspect merged definitions and relations for state-resource writes without reads. | `needs-only-bindings` | Keep as index-level graph analysis or move to the Rust/Go fact-store layer; no compiler types needed. |
| Semantic diagnostics evidence | `semantic/evidence/facts.ts` | Analyzer-produced diagnostics are currently empty; backend failure diagnostics are infrastructure facts. | `needs-only-bindings` for current rows | Keep backend diagnostics in the semantic service; do not block Rust fact migration on diagnostics. |
| Public semantic read-model `typeOf` | `docs/adr/0006-analysis-tiers-and-semantic-read-model.md` | Type checker or equivalent type engine. | `needs-types` | Keep in TS/tsgo semantic backends; non-goal for Rust static cutover. |

## Migration Notes

- The mandatory P5.4 first-party fact snapshot is captured as
  `contracts/fixtures/rust-first-party-static-golden.json`, a root-stable
  digest over the Rust/Oxc static output. Use it as the Rust oracle for bundled
  first-party static output drift.
- The first Rust move should target facts already expressible as primitive
  config projection: schema metadata/source refs, direct callback source refs,
  injection facts, routing children/relations, and agent config relations.
- Callback access relations and flow handler scans are still binding-only, but
  they should move later because they need precise function-body traversal and
  helper-following parity fixtures.
- No first-party Project Index fact currently justifies keeping a full
  TypeScript semantic pass solely for type information. The semantic pass still
  remains for the public semantic read model, backend parity, and any future
  type-aware extension/rule work.
