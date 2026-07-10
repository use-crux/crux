import type { ProjectDefinitionKind } from "@use-crux/core/project-index";

/**
 * Returns the relation type used by a routing child for its resolved target.
 *
 * The mapping is pure relation policy: it depends only on the child owner kind
 * and target definition kind, and returns undefined for unsupported targets.
 */
export function routingTargetRelationType(
  owner:
    | "router.route"
    | "split.route"
    | "retry.target"
    | "cascade.tier"
    | "fallback.option",
  targetKind: ProjectDefinitionKind,
): string | undefined {
  if (
    !isRoutingTargetKind(targetKind) &&
    targetKind !== "agent" &&
    targetKind !== "prompt"
  )
    return undefined;
  const target = routingRelationTargetName(targetKind);
  if (!target) return undefined;
  return `${owner}.uses_${target}`;
}

/** Returns whether a definition kind can act as a routing target. */
export function isRoutingTargetKind(
  kind: ProjectDefinitionKind | undefined,
): kind is Extract<
  ProjectDefinitionKind,
  | "routing.router"
  | "routing.split"
  | "routing.retry"
  | "routing.cascade"
  | "routing.fallback"
> {
  return (
    kind === "routing.router" ||
    kind === "routing.split" ||
    kind === "routing.retry" ||
    kind === "routing.cascade" ||
    kind === "routing.fallback"
  );
}

/** Returns whether a definition kind represents an evaluation artifact. */
export function isEvalKind(
  kind: ProjectDefinitionKind | undefined,
): kind is Extract<ProjectDefinitionKind, "evaluation"> {
  return kind === "evaluation";
}

/** Returns the relation type used when a flow step targets a definition kind. */
export function flowStepRelationType(
  kind: ProjectDefinitionKind,
): string | undefined {
  if (isRoutingTargetKind(kind)) return "flow.step.uses_routing";
  switch (kind) {
    case "agent":
      return "flow.step.uses_agent";
    case "prompt":
      return "flow.step.uses_prompt";
    case "tool":
      return "flow.step.uses_tool";
    case "memory":
      return "flow.step.uses_memory";
    case "blackboard":
      return "flow.step.uses_blackboard";
    default:
      return undefined;
  }
}

/** Returns the aggregate composition relation type for a target kind. */
export function compositionRelationType(
  kind: ProjectDefinitionKind,
): string | undefined {
  if (isRoutingTargetKind(kind)) return "composition.uses_routing";
  switch (kind) {
    case "agent":
      return "composition.uses_agent";
    case "flow":
      return "composition.uses_flow";
    case "prompt":
      return "composition.uses_prompt";
    case "tool":
      return "composition.uses_tool";
    default:
      return undefined;
  }
}

/** Returns the branch/stage relation type for parallel or pipeline composition. */
export function branchRelationType(
  composition: "parallel" | "pipeline",
  kind: ProjectDefinitionKind,
): string | undefined {
  const prefix =
    composition === "parallel" ? "parallel.branch" : "pipeline.stage";
  if (isRoutingTargetKind(kind)) return `${prefix}.uses_routing`;
  switch (kind) {
    case "agent":
      return `${prefix}.uses_agent`;
    case "flow":
      return `${prefix}.uses_flow`;
    case "prompt":
      return `${prefix}.uses_prompt`;
    case "tool":
      return `${prefix}.uses_tool`;
    default:
      return undefined;
  }
}

/**
 * Maps routing target kinds to the suffix used in routing relation names.
 */
function routingRelationTargetName(
  kind: ProjectDefinitionKind,
): string | undefined {
  switch (kind) {
    case "routing.router":
      return "router";
    case "routing.split":
      return "split";
    case "routing.retry":
      return "retry";
    case "routing.cascade":
      return "cascade";
    case "routing.fallback":
      return "fallback";
    case "agent":
      return "agent";
    case "prompt":
      return "prompt";
    default:
      return undefined;
  }
}
