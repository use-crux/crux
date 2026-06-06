import type { ProjectDefinition, ProjectRelation } from '@crux/core/catalog'
import { projectRelation } from './relation-registry'
import type { StaticFoundDefinition } from './types'

export function relationsFromStaticDefinitions(
  found: readonly StaticFoundDefinition[],
  importedDefinitions = new Map<string, ProjectDefinition>(),
): ProjectRelation[] {
  const byVariable = new Map(found.map((item) => [item.variableName, item.definition]))
  return found.flatMap((item) =>
    item.relationRefs.flatMap((ref) => {
      const source = ref.fromVariable ? (byVariable.get(ref.fromVariable) ?? importedDefinitions.get(ref.fromVariable)) : undefined
      const target = ref.toVariable ? (byVariable.get(ref.toVariable) ?? importedDefinitions.get(ref.toVariable)) : undefined
      const targetId = ref.toId ?? target?.id ?? fallbackRelationTargetId(ref.type, ref.toVariable)
      const sourceId = ref.fromId ?? source?.id ?? item.definition.id
      const type = target?.kind && ref.typeByTargetKind?.[target.kind] ? ref.typeByTargetKind[target.kind] : ref.type
      if (!targetId || !type) return []
      const sourceFidelity = ref.fromId ? item.definition.fidelity : (source?.fidelity ?? item.definition.fidelity)
      const targetFidelity = ref.toId ? 'resolved' : target?.fidelity
      const fidelity = sourceFidelity === 'resolved' && targetFidelity === 'resolved' ? 'resolved' : 'partial'
      return [
        projectRelation({
          type,
          from: sourceId,
          to: targetId,
          fidelity,
          source: item.definition.source,
        }),
      ]
    }),
  )
}

function fallbackRelationTargetId(type: string, variableName: string | undefined): string | undefined {
  if (!variableName) return undefined
  switch (type) {
    case 'agent.uses_prompt':
    case 'flow.step.uses_prompt':
      return `prompt:${safeVariableId(variableName)}`
    case 'agent.uses_tool':
    case 'flow.step.uses_tool':
      return `tool:${variableName}`
    case 'agent.reads_memory':
    case 'agent.writes_memory':
    case 'prompt.reads_memory':
    case 'prompt.writes_memory':
    case 'context.reads_memory':
    case 'context.writes_memory':
    case 'tool.reads_memory':
    case 'tool.writes_memory':
      return `memory:${safeVariableId(variableName)}`
    case 'agent.reads_blackboard':
    case 'agent.writes_blackboard':
    case 'prompt.reads_blackboard':
    case 'prompt.writes_blackboard':
    case 'context.reads_blackboard':
    case 'context.writes_blackboard':
    case 'tool.reads_blackboard':
    case 'tool.writes_blackboard':
      return `blackboard:${safeVariableId(variableName)}`
    case 'agent.reads_workspace':
    case 'agent.writes_workspace':
    case 'prompt.reads_workspace':
    case 'prompt.writes_workspace':
    case 'context.reads_workspace':
    case 'context.writes_workspace':
    case 'tool.reads_workspace':
    case 'tool.writes_workspace':
      return `workspace:${safeVariableId(variableName)}`
    case 'flow.step.uses_agent':
      return `agent:${safeVariableId(variableName)}`
    case 'flow.step.uses_memory':
    case 'flow.step.reads_memory':
    case 'flow.step.writes_memory':
    case 'swarm.uses_memory':
      return `memory:${safeVariableId(variableName)}`
    case 'flow.step.uses_blackboard':
    case 'flow.step.reads_blackboard':
    case 'flow.step.writes_blackboard':
    case 'swarm.uses_blackboard':
      return `blackboard:${safeVariableId(variableName)}`
    case 'flow.step.reads_workspace':
    case 'flow.step.writes_workspace':
      return `workspace:${safeVariableId(variableName)}`
    case 'composition.uses_prompt':
    case 'parallel.branch.uses_prompt':
    case 'pipeline.stage.uses_prompt':
      return `prompt:${safeVariableId(variableName)}`
    case 'composition.uses_tool':
    case 'parallel.branch.uses_tool':
    case 'pipeline.stage.uses_tool':
    case 'workspace.exposes_tool':
      return `tool:${variableName}`
    case 'composition.uses_flow':
    case 'parallel.branch.uses_flow':
    case 'pipeline.stage.uses_flow':
      return `flow:${safeVariableId(variableName)}`
    case 'composition.uses_agent':
    case 'parallel.branch.uses_agent':
    case 'pipeline.stage.uses_agent':
    case 'consensus.includes_agent':
    case 'swarm.includes_agent':
      return `agent:${safeVariableId(variableName)}`
    case 'agent.uses_routing':
    case 'flow.step.uses_routing':
    case 'composition.uses_routing':
    case 'parallel.branch.uses_routing':
    case 'pipeline.stage.uses_routing':
      return `routing.router:${safeVariableId(variableName)}`
    case 'consensus.uses_scorer':
    case 'rag.pipeline.stage.uses_scorer':
      return `scorer:${safeVariableId(variableName)}`
    case 'consensus.uses_judge':
      return `agent:${safeVariableId(variableName)}`
    case 'rag.pipeline.uses_retriever':
    case 'rag.pipeline.stage.uses_retriever':
      return `rag.retriever:${safeVariableId(variableName)}`
    case 'constraint.applies_to':
    case 'guardrail.applies_to':
    case 'eval.covers_definition':
      return variableName.includes(':') ? variableName : undefined
    default:
      return undefined
  }
}

function safeVariableId(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
