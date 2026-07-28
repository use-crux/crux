/**
 * Synthesizes stable targets for legacy static refs without definition ids.
 *
 * The closed relation-type table remains isolated from binding/accounting so
 * changes to compatibility fallbacks cannot obscure unresolved-ref handling.
 */
export function fallbackRelationTargetId(
  type: string,
  variableName: string | undefined,
): string | undefined {
  if (!variableName) return undefined;
  switch (type) {
    case "agent.uses_prompt":
    case "flow.step.uses_prompt":
      return `prompt:${safeVariableId(variableName)}`;
    case "prompt.uses_context":
    case "context.uses_context":
    case "injectable.uses_context":
      return `context:${safeVariableId(variableName)}`;
    case "prompt.uses_injectable":
    case "context.uses_injectable":
      return `injectable:${safeVariableId(variableName)}`;
    case "prompt.uses_tool":
    case "context.uses_tool":
    case "injectable.uses_tool":
    case "agent.uses_tool":
    case "flow.step.uses_tool":
      return `tool:${variableName}`;
    case "prompt.uses_memory":
    case "context.uses_memory":
    case "agent.reads_memory":
    case "agent.writes_memory":
    case "prompt.reads_memory":
    case "prompt.writes_memory":
    case "context.reads_memory":
    case "context.writes_memory":
    case "tool.reads_memory":
    case "tool.writes_memory":
    case "flow.step.uses_memory":
    case "flow.step.reads_memory":
    case "flow.step.writes_memory":
    case "swarm.uses_memory":
      return `memory:${safeVariableId(variableName)}`;
    case "prompt.uses_blackboard":
    case "context.uses_blackboard":
    case "agent.reads_blackboard":
    case "agent.writes_blackboard":
    case "prompt.reads_blackboard":
    case "prompt.writes_blackboard":
    case "context.reads_blackboard":
    case "context.writes_blackboard":
    case "tool.reads_blackboard":
    case "tool.writes_blackboard":
    case "flow.step.uses_blackboard":
    case "flow.step.reads_blackboard":
    case "flow.step.writes_blackboard":
    case "swarm.uses_blackboard":
      return `blackboard:${safeVariableId(variableName)}`;
    case "agent.reads_workspace":
    case "agent.writes_workspace":
    case "prompt.reads_workspace":
    case "prompt.writes_workspace":
    case "context.reads_workspace":
    case "context.writes_workspace":
    case "tool.reads_workspace":
    case "tool.writes_workspace":
    case "flow.step.reads_workspace":
    case "flow.step.writes_workspace":
      return `workspace:${safeVariableId(variableName)}`;
    case "flow.step.uses_agent":
    case "composition.uses_agent":
    case "parallel.branch.uses_agent":
    case "pipeline.stage.uses_agent":
    case "consensus.includes_agent":
    case "swarm.includes_agent":
      return `agent:${safeVariableId(variableName)}`;
    case "composition.uses_prompt":
    case "parallel.branch.uses_prompt":
    case "pipeline.stage.uses_prompt":
      return `prompt:${safeVariableId(variableName)}`;
    case "composition.uses_tool":
    case "parallel.branch.uses_tool":
    case "pipeline.stage.uses_tool":
    case "workspace.exposes_tool":
      return `tool:${variableName}`;
    case "composition.uses_flow":
    case "parallel.branch.uses_flow":
    case "pipeline.stage.uses_flow":
      return `flow:${safeVariableId(variableName)}`;
    case "agent.uses_routing":
    case "flow.step.uses_routing":
    case "composition.uses_routing":
    case "parallel.branch.uses_routing":
    case "pipeline.stage.uses_routing":
      return `routing.router:${safeVariableId(variableName)}`;
    case "consensus.uses_scorer":
    case "rag.recipe.step.uses_scorer":
    case "rag.pipeline.stage.uses_scorer":
      return `scorer:${safeVariableId(variableName)}`;
    case "rag.recipe.step.uses_reranker":
      return `rag.reranker:${safeVariableId(variableName)}`;
    case "consensus.uses_judge":
      return `agent:${safeVariableId(variableName)}`;
    case "rag.recipe.uses_retriever":
    case "rag.recipe.step.uses_retriever":
    case "rag.pipeline.uses_retriever":
    case "rag.pipeline.stage.uses_retriever":
      return `rag.retriever:${safeVariableId(variableName)}`;
    case "storage.bundle.uses_record_store":
    case "rag.retriever.uses_record_store":
    case "workspace.uses_record_store":
      return `storage.recordStore:${safeVariableId(variableName)}`;
    case "storage.bundle.uses_vector_store":
    case "rag.retriever.uses_vector_store":
    case "workspace.uses_vector_store":
      return `storage.vectorStore:${safeVariableId(variableName)}`;
    case "storage.bundle.uses_asset_store":
    case "rag.retriever.uses_asset_store":
    case "workspace.uses_asset_store":
      return `storage.assetStore:${safeVariableId(variableName)}`;
    case "storage.scope.wraps_storage":
    case "rag.retriever.uses_storage":
    case "workspace.uses_storage":
      return `storage.bundle:${safeVariableId(variableName)}`;
    case "constraint.applies_to":
    case "guardrail.applies_to":
    case "eval.covers_definition":
      return variableName.includes(":") ? variableName : undefined;
    default:
      return undefined;
  }
}

function safeVariableId(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
