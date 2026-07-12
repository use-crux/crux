/**
 * Definition-kind coverage manifest.
 *
 * Runtime evidence (whether/how a definition ran) is produced by the
 * server-owned observability graph, while "where defined"/"dependencies"/
 * "where used" come from the compiler-owned Project Index. Not every
 * `ProjectDefinitionKind` is itself the subject of a runtime span: some are
 * only ever referenced by an owner's span, some are structurally nested
 * under a parent kind, some are Quality-owned artifacts correlated through a
 * separate existing join, and a few are genuinely static/declarative and
 * never runtime-observable at all. This manifest is the single source of
 * truth for which of those five treatments applies to each kind, so Catalog
 * and the Go join projection classify every kind identically instead of
 * re-deriving the rule per call site.
 *
 * Because `DEFINITION_KIND_COVERAGE` is typed as a `Record` over the full
 * `ProjectDefinitionKind` union, TypeScript itself refuses to compile if a
 * new kind is added to the union without a corresponding entry here — that
 * compile-time exhaustiveness check is the primary enforcement mechanism.
 *
 * @module
 */

import type { CruxPrimitiveName } from "../observability/contract";
import type { ProjectDefinitionKind } from "./index";

/**
 * The primary coverage treatment for a `ProjectDefinitionKind`.
 *
 * - `directly-observed` — the kind itself is the subject of a runtime span;
 *   Catalog shows a top-level row with a working "View Runs" action.
 * - `runtime-contributor` — referenced by an owner's span/artifacts, but
 *   never itself the subject of one; Catalog shows "referenced by N runs".
 * - `structural-child` — nested under a parent kind for Catalog display,
 *   per the mechanical `<parent>.<child>` rule where `parent` is itself a
 *   `ProjectDefinitionKind` member.
 * - `quality-owned` — correlates through the existing Quality↔observability
 *   join, not the `DefinitionRef` join this workstream adds.
 * - `static-only` — declarative/config; never the target or subject of any
 *   runtime primitive.
 * - `fallback` — the `unknown` sentinel; never a real definition.
 */
export type DefinitionKindCoveragePrimary =
  | "directly-observed"
  | "runtime-contributor"
  | "structural-child"
  | "quality-owned"
  | "static-only"
  | "fallback";

/**
 * A declared secondary treatment layered on top of a kind's `primary`
 * category, for kinds that don't fit a single bucket cleanly.
 *
 * - `direct-runtime` — the kind also has directly-observed runtime evidence
 *   (e.g. `scorer` invoked live as `scoring.judge`) despite its primary
 *   treatment being something else. Every kind declaring this must also
 *   declare at least one entry in `runtimePrimitiveNames`.
 * - `quality-owned` — the kind also correlates through the existing
 *   Quality↔observability join (e.g. `evaluation.case`/`suite.case`, whose
 *   primary treatment is `structural-child` per the mechanical parent rule).
 */
export type DefinitionKindCoverageSecondary = "direct-runtime" | "quality-owned";

/** Coverage classification for a single `ProjectDefinitionKind`. */
export interface CoverageDescriptor {
  /** The kind's primary coverage treatment. */
  readonly primary: DefinitionKindCoveragePrimary;
  /** Additional declared treatments layered on top of `primary`, if any. */
  readonly secondary?: readonly DefinitionKindCoverageSecondary[];
  /**
   * `CRUX_PRIMITIVE_NAMES` values that carry runtime evidence for this kind
   * — the kind's own span name(s) for `directly-observed`/`direct-runtime`
   * treatments, or the primitive(s) that reference it for
   * `runtime-contributor` treatments. Omitted (or empty) when the kind has
   * no runtime primitive mapping at all.
   */
  readonly runtimePrimitiveNames?: readonly CruxPrimitiveName[];
  /**
   * How runtime activity obtains this definition's canonical identity when
   * the primary treatment alone is insufficient.
   *
   * - `definition-ref` — an executed record can carry this definition's exact id.
   * - `parent-derived` — only the indexed parent is directly observed.
   * - `quality` — the existing Quality correlation is authoritative.
   * - `none` — no live runtime identity exists.
   *
   * Directly-observed kinds implicitly use `definition-ref`; static/fallback
   * kinds implicitly use `none`.
   */
  readonly runtimeIdentity?: "definition-ref" | "parent-derived" | "quality" | "none";
}

/**
 * Coverage classification for every `ProjectDefinitionKind`, keyed by the
 * real schema strings — never invented shorthand names. See the module doc
 * above and `01-coverage-contract.md` §1.1/§1.2 for the full rationale.
 */
export const DEFINITION_KIND_COVERAGE = {
  // Category A — directly observed execution owner (24 kinds).
  prompt: { primary: "directly-observed", runtimePrimitiveNames: ["prompt.resolve", "prompt.budget"] },
  context: {
    primary: "directly-observed",
    runtimePrimitiveNames: ["context.resolve", "context.predicate", "context.cache"],
  },
  tool: { primary: "directly-observed", runtimePrimitiveNames: ["tool.call", "tool.approval"] },
  agent: { primary: "directly-observed", runtimePrimitiveNames: ["agent.run"] },
  flow: { primary: "directly-observed", runtimePrimitiveNames: ["flow.run"] },
  task: { primary: "directly-observed", runtimePrimitiveNames: ["task.operation"] },
  "composition.parallel": { primary: "directly-observed", runtimePrimitiveNames: ["composition.parallel"] },
  "composition.pipeline": { primary: "directly-observed", runtimePrimitiveNames: ["composition.pipeline"] },
  "composition.swarm": { primary: "directly-observed", runtimePrimitiveNames: ["composition.swarm"] },
  "composition.consensus": { primary: "directly-observed", runtimePrimitiveNames: ["composition.consensus"] },
  "routing.router": { primary: "directly-observed", runtimePrimitiveNames: ["routing.router"] },
  "routing.split": { primary: "directly-observed", runtimePrimitiveNames: ["routing.split"] },
  "routing.retry": { primary: "directly-observed", runtimePrimitiveNames: ["routing.retry"] },
  "routing.cascade": { primary: "directly-observed", runtimePrimitiveNames: ["routing.cascade"] },
  "routing.fallback": { primary: "directly-observed", runtimePrimitiveNames: ["routing.fallback"] },
  "rag.recipe": { primary: "directly-observed", runtimePrimitiveNames: ["retrieval.recipe"] },
  "rag.reranker": { primary: "directly-observed", runtimePrimitiveNames: ["retrieval.step"] },
  "rag.retriever": {
    primary: "directly-observed",
    runtimePrimitiveNames: ["retrieval.retrieve", "retrieval.query"],
  },
  skill: { primary: "directly-observed", runtimePrimitiveNames: ["skill.load"] },
  memory: { primary: "directly-observed", runtimePrimitiveNames: ["memory.read", "memory.write"] },
  workspace: { primary: "directly-observed", runtimePrimitiveNames: ["workspace.operation"] },
  constraint: { primary: "directly-observed", runtimePrimitiveNames: ["constraint.check", "constraint.retry"] },
  guardrail: { primary: "directly-observed", runtimePrimitiveNames: ["guardrail.run"] },
  // Rides the generic memory primitives (no dedicated `blackboard.*` primitive exists);
  // `config.id` is required and in hand at every span (`blackboard.ts`), stamped as
  // `sourceDefinitionId: blackboard:<id>`.
  blackboard: { primary: "directly-observed", runtimePrimitiveNames: ["memory.read", "memory.write"] },

  // Category B — runtime contributor/dependency (6 kinds). Referenced by an
  // owner's span, never itself the subject of one.
  injectable: { primary: "runtime-contributor", runtimeIdentity: "parent-derived", runtimePrimitiveNames: ["prompt.resolve", "context.resolve"] },
  "rag.knowledgeBase": {
    primary: "runtime-contributor",
    runtimeIdentity: "definition-ref",
    runtimePrimitiveNames: ["retrieval.retrieve", "retrieval.query"],
  },
  "storage.recordStore": {
    primary: "runtime-contributor",
    runtimeIdentity: "parent-derived",
    runtimePrimitiveNames: ["indexing.pipeline", "ingest.parse", "corpus.sync"],
  },
  "storage.vectorStore": {
    primary: "runtime-contributor",
    runtimeIdentity: "parent-derived",
    runtimePrimitiveNames: ["embedding.call", "retrieval.retrieve", "retrieval.query"],
  },
  "storage.blobStore": {
    primary: "runtime-contributor",
    runtimeIdentity: "parent-derived",
    runtimePrimitiveNames: ["ingest.parse", "corpus.sync"],
  },
  toolPolicy: { primary: "runtime-contributor", runtimeIdentity: "definition-ref", runtimePrimitiveNames: ["tool.call", "tool.approval"] },

  // Category C — structural child (14 kinds; `evaluation.case`/`suite.case`
  // are also Quality-owned via `secondary`). Classified mechanically: a
  // `<parent>.<child>` kind whose `parent` is itself a union member.
  "flow.step": { primary: "structural-child", runtimeIdentity: "definition-ref", runtimePrimitiveNames: ["flow.step"] },
  "composition.parallel.branch": { primary: "structural-child", runtimeIdentity: "definition-ref", runtimePrimitiveNames: ["agent.run"] },
  "composition.pipeline.stage": { primary: "structural-child", runtimeIdentity: "parent-derived" },
  "routing.router.route": { primary: "structural-child", runtimeIdentity: "parent-derived" },
  "routing.split.route": { primary: "structural-child", runtimeIdentity: "parent-derived" },
  "routing.retry.target": { primary: "structural-child", runtimeIdentity: "parent-derived" },
  "routing.cascade.tier": { primary: "structural-child", runtimeIdentity: "parent-derived" },
  "routing.fallback.option": { primary: "structural-child", runtimeIdentity: "parent-derived" },
  "rag.recipe.step": { primary: "structural-child", runtimeIdentity: "definition-ref", runtimePrimitiveNames: ["retrieval.step"] },
  "rag.pipeline.stage": { primary: "structural-child", runtimeIdentity: "none", runtimePrimitiveNames: ["retrieval.stage"] },
  "memory.store": { primary: "structural-child", runtimeIdentity: "parent-derived" },
  "memory.block": { primary: "structural-child", runtimeIdentity: "parent-derived" },
  "evaluation.case": { primary: "structural-child", secondary: ["quality-owned"], runtimeIdentity: "quality" },
  "suite.case": { primary: "structural-child", secondary: ["quality-owned"], runtimeIdentity: "quality" },

  // Category D — Quality-owned artifact (10 kinds total; `evaluation.case`/
  // `suite.case` above account for the other 2). `scorer` is dual-use:
  // Quality-primary, but must not omit live `scoring.judge` spans.
  scorer: { primary: "quality-owned", secondary: ["direct-runtime"], runtimeIdentity: "definition-ref", runtimePrimitiveNames: ["scoring.judge"] },
  dataset: { primary: "quality-owned" },
  evaluation: { primary: "quality-owned" },
  suite: { primary: "quality-owned" },
  "eval.prompt": { primary: "quality-owned" },
  "eval.flow": { primary: "quality-owned" },
  "eval.rag": { primary: "quality-owned" },
  "eval.quality": { primary: "quality-owned" },

  // Category E — genuinely static-only (4 kinds). Declarative/config; never
  // the target or subject of any runtime primitive.
  registry: { primary: "static-only" },
  "storage.bundle": { primary: "static-only" },
  "storage.scope": { primary: "static-only" },
  // Refuted category-A claim: no first-party emitter, compiled-definition
  // builder (JS-TypeScript semantic or native Rust/Oxc), or public pipeline
  // execution API exists for `rag.pipeline` anywhere in the repo — only dead
  // runtime-join-metadata switch cases in `definition-builder.ts`/`join.rs`
  // that no producer ever reaches. `retrieval.pipeline` stays a reserved
  // `CRUX_PRIMITIVE_NAMES` entry for a future real pipeline subsystem, but
  // nothing emits it today. `rag.pipeline.stage` keeps its mechanical
  // `structural-child` classification independent of this.
  "rag.pipeline": { primary: "static-only" },

  // Category F — fallback sentinel (1, not a real category).
  unknown: { primary: "fallback" },
} as const satisfies Record<ProjectDefinitionKind, CoverageDescriptor>;

/**
 * The set of `ProjectDefinitionKind`s whose `primary` coverage treatment is
 * `directly-observed` — the kinds that are themselves the subject of a runtime
 * span and therefore must carry a canonical `DefinitionRef` as runtime
 * evidence. Derived structurally from {@link DEFINITION_KIND_COVERAGE}, so
 * adding a directly-observed kind to the manifest automatically widens this
 * union and forces the `DefinitionRef` role/builder map in
 * `../observability/definition-ref` to cover it (a compile error otherwise).
 *
 * Kinds whose runtime evidence is only a `secondary: ["direct-runtime"]`
 * treatment (e.g. `scorer`) are intentionally excluded: they correlate through
 * the Quality↔observability join, not the `DefinitionRef` join.
 */
export type DirectlyObservedKind = {
  [K in keyof typeof DEFINITION_KIND_COVERAGE]: (typeof DEFINITION_KIND_COVERAGE)[K]["primary"] extends "directly-observed"
    ? K
    : never;
}[keyof typeof DEFINITION_KIND_COVERAGE];
