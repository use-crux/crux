/**
 * DefinitionRef builders for runtime evidence.
 *
 * Runtime records join back to Project Index definitions through a
 * {@link DefinitionRef}. Every directly-observed `ProjectDefinitionKind` — one
 * whose runtime span is itself the subject — has exactly one
 * {@link DefinitionRefRole}. Most use `<kind>:<safeId(authoredId)>`; Effect
 * definitions use their composite `(id, version)` identity.
 * That kind→role mapping is closed in {@link DIRECTLY_OBSERVED_DEFINITION_REF_ROLES}
 * and enforced against the coverage manifest at compile time, so a new
 * directly-observed kind cannot be added without giving it a role here.
 *
 * ## What the id must match
 *
 * The id is compared byte-for-byte against the indexer's `ProjectDefinition.ID`
 * so callers must pass the *authored* identity
 * the indexer read — not the model-facing key, the runtime instance id, or a
 * step label. When the authored id is absent, the indexer falls back to the
 * compile-time local/variable name, which the runtime cannot observe; callers
 * must then skip the ref entirely rather than guess. Id normalization and the
 * empty-input fingerprint fallback live in `./definition-ref-safe-id`.
 *
 * ## Source
 *
 * Built-in emitters intentionally omit `source`: they hold only an absolute
 * host path (or nothing), and read-time Project Index resolution supplies the
 * current definition location. The `source` parameter exists for the rare
 * caller that holds a genuine compiled source *and* a project root; it is
 * sanitized to a repo-relative pointer by `./definition-ref-source` and dropped
 * if it cannot be proven safe. A ref never carries an absolute host path.
 *
 * @module
 */

import type {
  DefinitionRef,
  DefinitionRefRole,
  SanitizedSourceRef,
} from "./contract";
import type { DirectlyObservedKind } from "../project-index/definition-kind-coverage";
import { safeDefinitionId } from "./definition-ref-safe-id";
import {
  sanitizeDefinitionSource,
  type DefinitionSourceInput,
  type SanitizeDefinitionSourceOptions,
} from "./definition-ref-source";

export {
  sanitizeDefinitionSource,
  type DefinitionSourceInput,
  type SanitizeDefinitionSourceOptions,
};
export { safeDefinitionId } from "./definition-ref-safe-id";

/**
 * Closed map from every directly-observed `ProjectDefinitionKind` to the single
 * {@link DefinitionRefRole} its runtime evidence carries. Typed as a total
 * `Record<DirectlyObservedKind, …>`: because {@link DirectlyObservedKind} is
 * derived from `DEFINITION_KIND_COVERAGE`, TypeScript refuses to compile if a
 * manifest kind is promoted to `directly-observed` without a role here, or if a
 * role here names a kind that is no longer directly-observed. This is the
 * machine-readable guard tying the coverage manifest to the ref builders.
 */
export const DIRECTLY_OBSERVED_DEFINITION_REF_ROLES: Record<
  DirectlyObservedKind,
  DefinitionRefRole
> = {
  prompt: "resolved-prompt",
  context: "resolved-context",
  tool: "invoked-tool",
  "mcp.server": "resolved-mcp-server",
  agent: "invoked-agent",
  flow: "invoked-flow",
  task: "invoked-task",
  effect: "invoked-effect",
  "composition.parallel": "invoked-composition",
  "composition.pipeline": "invoked-composition",
  "composition.consensus": "invoked-composition",
  "composition.swarm": "invoked-composition",
  "routing.router": "invoked-routing",
  "routing.split": "invoked-routing",
  "routing.retry": "invoked-routing",
  "routing.cascade": "invoked-routing",
  "routing.fallback": "invoked-routing",
  "rag.recipe": "invoked-recipe",
  "rag.reranker": "invoked-reranker",
  "rag.retriever": "invoked-retriever",
  skill: "loaded-skill",
  memory: "invoked-memory",
  workspace: "invoked-workspace",
  constraint: "invoked-constraint",
  guardrail: "invoked-guardrail",
  blackboard: "invoked-blackboard",
  scorer: "invoked-scorer",
};

/**
 * Build the canonical {@link DefinitionRef} for a directly-observed kind.
 *
 * Produces `{ id: "<kind>:<safeId(authoredId)>", kind, role }`, the single
 * construction every named builder below delegates to. Pass the authored
 * identity the indexer read for `kind`; the role is looked up from
 * {@link DIRECTLY_OBSERVED_DEFINITION_REF_ROLES}.
 */
export function definitionRef<
  K extends Exclude<DirectlyObservedKind, "effect">,
>(kind: K, authoredId: string, source?: SanitizedSourceRef): DefinitionRef {
  return {
    id: `${kind}:${safeDefinitionId(authoredId)}`,
    kind,
    role: DIRECTLY_OBSERVED_DEFINITION_REF_ROLES[kind],
    ...(source ? { source } : {}),
  };
}

function relatedDefinitionRef(
  kind: DefinitionRef["kind"],
  id: string,
  role: DefinitionRefRole,
  source?: SanitizedSourceRef,
): DefinitionRef {
  return { id, kind, role, ...(source ? { source } : {}) };
}

/** Build an authored knowledge-base contributor ref. */
export function knowledgeBaseDefinitionRef(
  id: string,
  source?: SanitizedSourceRef,
): DefinitionRef {
  return relatedDefinitionRef(
    "rag.knowledgeBase",
    `rag.knowledgeBase:${safeDefinitionId(id)}`,
    "contributed-knowledge-base",
    source,
  );
}

/** Build an authored tool-policy contributor ref. */
export function toolPolicyDefinitionRef(
  id: string,
  source?: SanitizedSourceRef,
): DefinitionRef {
  return relatedDefinitionRef(
    "toolPolicy",
    `toolPolicy:${safeDefinitionId(id)}`,
    "contributed-tool-policy",
    source,
  );
}

/** Build the canonical server ref carried by MCP preparation and tool spans. */
export function mcpServerDefinitionRef(
  id: string,
  source?: SanitizedSourceRef,
): DefinitionRef {
  return definitionRef("mcp.server", id, source);
}

/** Build the canonical child ref for an executed authored flow step. */
export function flowStepDefinitionRef(
  flowName: string,
  stepLabel: string,
  source?: SanitizedSourceRef,
): DefinitionRef {
  return relatedDefinitionRef(
    "flow.step",
    `flow.step:${safeDefinitionId(flowName)}:${safeDefinitionId(stepLabel)}`,
    "invoked-flow-step",
    source,
  );
}

/** Build the canonical child ref for an executed parallel-composition branch. */
export function parallelBranchDefinitionRef(
  compositionId: string,
  branchId: string,
  source?: SanitizedSourceRef,
): DefinitionRef {
  return relatedDefinitionRef(
    "composition.parallel.branch",
    `composition.parallel:${safeDefinitionId(compositionId)}:branch:${safeDefinitionId(branchId)}`,
    "invoked-composition-branch",
    source,
  );
}

/** Build the canonical child ref for an executed retrieval-recipe step. */
export function recipeStepDefinitionRef(
  recipeId: string,
  stepId: string,
  source?: SanitizedSourceRef,
): DefinitionRef {
  return relatedDefinitionRef(
    "rag.recipe.step",
    `rag.recipe:${safeDefinitionId(recipeId)}:step:${safeDefinitionId(stepId)}`,
    "invoked-recipe-step",
    source,
  );
}

/** Build an authored scorer ref for a live scoring invocation. */
export function scorerDefinitionRef(
  id: string,
  source?: SanitizedSourceRef,
): DefinitionRef {
  return relatedDefinitionRef(
    "scorer",
    `scorer:${safeDefinitionId(id)}`,
    "invoked-scorer",
    source,
  );
}

/** Composition modes that own a canonical `composition.<kind>` definition. */
export type CompositionRefKind =
  | "parallel"
  | "pipeline"
  | "consensus"
  | "swarm";

/** Routing modes that own a canonical `routing.<kind>` definition. */
export type RoutingRefKind =
  | "router"
  | "split"
  | "retry"
  | "cascade"
  | "fallback";

/**
 * Build the `resolved-prompt` ref for a prompt-resolution span. Matches the
 * indexer's `prompt:<safeId(id)>` (`crates/primitives/src/prompt/facts.rs`).
 * Pass the authored `id`; an absent id means the indexer used the local
 * variable name, so callers must skip the ref rather than guess.
 */
export function promptDefinitionRef(
  id: string,
  source?: SanitizedSourceRef,
): DefinitionRef {
  return definitionRef("prompt", id, source);
}

/**
 * Build the `resolved-context` ref for a context-resolution span. Matches the
 * indexer's `context:<safeId(id)>` (`crates/primitives/src/context/facts.rs`).
 * An absent authored `id` means the indexer used the local variable name;
 * callers must skip the ref rather than guess.
 */
export function contextDefinitionRef(
  id: string,
  source?: SanitizedSourceRef,
): DefinitionRef {
  return definitionRef("context", id, source);
}

/**
 * Build the `invoked-tool` ref for a `tool.call` span. Matches the indexer's
 * `tool:<safeId(name || title)>` (`crates/primitives/src/tool/facts.rs`). Pass
 * the authored `name`/`title`, not the model-facing tool-map key.
 */
export function toolDefinitionRef(
  name: string,
  source?: SanitizedSourceRef,
): DefinitionRef {
  return definitionRef("tool", name, source);
}

/**
 * Build the `invoked-agent` ref for an `agent.run` span. Matches the indexer's
 * `agent:<safeId(id)>` (`crates/primitives/src/agent/facts.rs`). Composition
 * stages backed by a plain function have no compiled agent identity; skip the
 * ref for those.
 */
export function agentDefinitionRef(
  id: string,
  source?: SanitizedSourceRef,
): DefinitionRef {
  return definitionRef("agent", id, source);
}

/**
 * Build the `invoked-flow` ref for a `flow.run` span. Matches the indexer's
 * `flow:<safeId(name)>` (`crates/primitives/src/flow/facts.rs`). Pass the
 * authored first-arg name, not the random per-execution `flowId`.
 */
export function flowDefinitionRef(
  name: string,
  source?: SanitizedSourceRef,
): DefinitionRef {
  return definitionRef("flow", name, source);
}

/**
 * Build the `invoked-task` ref for a `task.operation` span emitted by
 * executing a `durableTask()` target. Matches the indexer's
 * `task:<safeId(name)>` (`crates/primitives/src/runtime/task.rs`), where
 * `name` is the required first-arg literal of `durableTask()`. Pass that
 * authored name; the unrelated Plans & Tasks ledger `tasks()`/`task()` CRUD
 * records (`../plan/tasks.ts`) have no compiled Project Index definition and
 * must never carry this ref.
 */
export function taskDefinitionRef(
  name: string,
  source?: SanitizedSourceRef,
): DefinitionRef {
  return definitionRef("task", name, source);
}

/**
 * Build the `invoked-effect` ref for an `effect.run` span. Effect definitions
 * use the composite `(id, version)` identity, with normalization applied only
 * to the authored id so the version suffix stays byte-identical to Static
 * Index output.
 */
export function effectDefinitionRef(
  id: string,
  version: number,
  source?: SanitizedSourceRef,
): DefinitionRef {
  return {
    id: `effect:${safeDefinitionId(id)}:v${version}`,
    kind: "effect",
    role: DIRECTLY_OBSERVED_DEFINITION_REF_ROLES.effect,
    ...(source ? { source } : {}),
  };
}

/**
 * Build the `invoked-retriever` ref for a `retrieval.query`/`retrieval.retrieve`
 * span. Matches the indexer's `rag.retriever:<safeId(id)>`
 * (`crates/primitives/src/rag/facts.rs`). Pass the authored `config.id`.
 */
export function retrieverDefinitionRef(
  id: string,
  source?: SanitizedSourceRef,
): DefinitionRef {
  return definitionRef("rag.retriever", id, source);
}

/**
 * Build the `invoked-recipe` ref for a `retrieval.recipe` span. Matches the
 * indexer's `rag.recipe:<safeId(name)>` (`crates/primitives/src/rag/facts.rs`).
 * Pass the authored recipe name.
 */
export function recipeDefinitionRef(
  name: string,
  source?: SanitizedSourceRef,
): DefinitionRef {
  return definitionRef("rag.recipe", name, source);
}

/**
 * Build the `invoked-reranker` ref for a `retrieval.step` reranker span.
 * Matches the indexer's `rag.reranker:<safeId(id)>`
 * (`crates/primitives/src/rag/facts.rs`). The authored reranker id is required:
 * an anonymous reranker has no stable shared identity, so there is no ref.
 */
export function rerankerDefinitionRef(
  id: string,
  source?: SanitizedSourceRef,
): DefinitionRef {
  return definitionRef("rag.reranker", id, source);
}

/**
 * Build the `loaded-skill` ref for a `skill.load` span. Matches the indexer's
 * `skill:<safeId(identifier)>` (`crates/primitives/src/registry/facts.rs`),
 * where `identifier` is `"<registryName>:<path>"`. Pass that composite
 * identifier exactly as the indexer assembled it.
 */
export function skillDefinitionRef(
  identifier: string,
  source?: SanitizedSourceRef,
): DefinitionRef {
  return definitionRef("skill", identifier, source);
}

/**
 * Build the `invoked-memory` ref for a `memory.capture`, `memory.read`, or
 * `memory.write` span.
 * Matches the indexer's `memory:<safeId(definitionKey)>`
 * (`crates/primitives/src/memory/facts.rs`). Pass the authored definition key
 * (the literal `id`), not a runtime-computed prefixed instance id.
 */
export function memoryDefinitionRef(
  definitionKey: string,
  source?: SanitizedSourceRef,
): DefinitionRef {
  return definitionRef("memory", definitionKey, source);
}

/**
 * Build the `invoked-workspace` ref for a `workspace.operation` span. Matches
 * the indexer's `workspace:<safeId(id)>`
 * (`crates/primitives/src/workspace/facts.rs`). Pass the authored `config.id`.
 */
export function workspaceDefinitionRef(
  id: string,
  source?: SanitizedSourceRef,
): DefinitionRef {
  return definitionRef("workspace", id, source);
}

/**
 * Build the `invoked-guardrail` ref for a `guardrail.run` span. Matches the
 * indexer's `guardrail:<safeId(policyId)>`
 * (`crates/primitives/src/safety/facts.rs`). `id` is a required field on
 * `guardrail()`, so this ref is always canonical.
 */
export function guardrailDefinitionRef(
  id: string,
  source?: SanitizedSourceRef,
): DefinitionRef {
  return definitionRef("guardrail", id, source);
}

/**
 * Build the `invoked-constraint` ref for a `constraint.check`/`constraint.retry`
 * span. Matches the indexer's `constraint:<safeId(policyId)>`
 * (`crates/primitives/src/safety/facts.rs`). `id` is a required field on
 * `constraint()`, so this ref is always canonical.
 */
export function constraintDefinitionRef(
  id: string,
  source?: SanitizedSourceRef,
): DefinitionRef {
  return definitionRef("constraint", id, source);
}

/**
 * Build the `invoked-routing` ref for a routing span. Matches the indexer's
 * `routing.<kind>:<safeId(id)>` (`crates/primitives/src/routing/*.rs`). Pass the
 * authored `config.id`; an absent id means the indexer used the variable name,
 * so callers skip the ref rather than guess.
 */
export function routingDefinitionRef(
  kind: RoutingRefKind,
  id: string,
  source?: SanitizedSourceRef,
): DefinitionRef {
  return definitionRef(`routing.${kind}`, id, source);
}

/**
 * Build the `invoked-composition` ref for a composition root span. Matches the
 * indexer's `composition.<kind>:<safeId(id)>`
 * (`crates/primitives/src/composition/facts.rs`).
 */
export function compositionDefinitionRef(
  kind: CompositionRefKind,
  id: string,
  source?: SanitizedSourceRef,
): DefinitionRef {
  return definitionRef(`composition.${kind}`, id, source);
}

/**
 * Build the `invoked-blackboard` ref for a blackboard memory span. Matches the
 * indexer's `blackboard:<safeId(id)>`
 * (`crates/primitives/src/blackboard/facts.rs`). `config.id` is required and in
 * hand at every blackboard span.
 */
export function blackboardDefinitionRef(
  id: string,
  source?: SanitizedSourceRef,
): DefinitionRef {
  return definitionRef("blackboard", id, source);
}
