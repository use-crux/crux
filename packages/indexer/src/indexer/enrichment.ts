import type { ProjectDefinition, ProjectDefinitionKind, ProjectRelation } from '@use-crux/core/project-index'
import { definition, definitionFingerprintFile, fingerprint, relation, safeId } from './definitions'
import { sourceForFile, sourceSnippet } from './ast/snippets'

export async function resolvedDefinitionFromExport(
  root: string,
  file: string,
  exportName: string,
  value: unknown,
  expected: ProjectDefinition,
): Promise<{ definition: ProjectDefinition; relations: ProjectRelation[] } | undefined> {
  switch (expected.kind) {
    case 'agent':
      return resolvedAgentDefinition(root, file, exportName, value, expected)
    case 'flow':
      return resolvedFlowDefinition(root, file, exportName, value, expected)
    case 'rag.retriever':
      return resolvedRetrieverDefinition(root, file, exportName, value, expected)
    case 'rag.recipe':
      return resolvedRetrievalRecipeDefinition(root, file, exportName, value, expected)
    case 'rag.pipeline':
      return resolvedRetrievalPipelineDefinition(root, file, exportName, value, expected)
    case 'memory':
      return resolvedMemoryDefinition(root, file, exportName, value, expected)
    case 'blackboard':
      return resolvedBlackboardDefinition(root, file, exportName, value, expected)
    case 'constraint':
      return resolvedConstraintDefinition(root, file, exportName, value, expected)
    case 'guardrail':
      return resolvedGuardrailDefinition(root, file, exportName, value, expected)
    case 'scorer':
      return resolvedScorerDefinition(root, file, exportName, value, expected)
    default:
      return undefined
  }
}

async function resolvedAgentDefinition(
  root: string,
  file: string,
  exportName: string,
  value: unknown,
  expected: ProjectDefinition,
): Promise<{ definition: ProjectDefinition; relations: ProjectRelation[] } | undefined> {
  if (!isTaggedObject(value, 'Agent')) return undefined
  const agentValue = value as {
    id: string
    description?: string
    prompt?: { id?: string }
    tools?: unknown
    handoffs?: Array<{ id: string; when?: string }>
  }
  const id = `agent:${safeId(agentValue.id)}`
  const handoffs = agentValue.handoffs ?? []
  const toolNames = toolNamesFromRuntime(agentValue.tools)
  const definitionItem = await resolvedDefinition(
    root,
    file,
    id,
    'agent',
    agentValue.id,
    agentValue.description,
    {
      exportName,
      promptId: agentValue.prompt?.id,
      toolNames,
      handoffs,
    },
    expected,
  )
  const relations = relationsFromExpected(expected, id, file).filter(
    (relationItem) => relationItem.type !== 'agent.uses_prompt' && relationItem.type !== 'agent.uses_tool',
  )
  if (agentValue.prompt?.id) relations.push(relation('agent.uses_prompt', id, `prompt:${agentValue.prompt.id}`, file))
  for (const toolName of toolNames) relations.push(relation('agent.uses_tool', id, `tool:${toolName}`, file))
  for (const handoff of handoffs)
    relations.push(relation('agent.can_handoff_to', id, `agent:${safeId(handoff.id)}`, file))
  return { definition: definitionItem, relations }
}

async function resolvedFlowDefinition(
  root: string,
  file: string,
  exportName: string,
  value: unknown,
  expected: ProjectDefinition,
): Promise<{ definition: ProjectDefinition; relations: ProjectRelation[] } | undefined> {
  if (!isFlowHandle(value)) return undefined
  const flowValue = value as { name: string }
  const id = `flow:${safeId(flowValue.name)}`
  return {
    definition: await resolvedDefinition(
      root,
      file,
      id,
      'flow',
      flowValue.name,
      expected.description,
      {
        exportName,
        stepNames: expected.metadata?.stepNames,
      },
      expected,
    ),
    relations: relationsFromExpected(expected, id, file),
  }
}

async function resolvedRetrieverDefinition(
  root: string,
  file: string,
  exportName: string,
  value: unknown,
  expected: ProjectDefinition,
): Promise<{ definition: ProjectDefinition; relations: ProjectRelation[] } | undefined> {
  if (!isTaggedObject(value, 'Retriever')) return undefined
  const retrieverValue = value as { id: string; namespace: string; mode?: string }
  return {
    definition: await resolvedDefinition(
      root,
      file,
      `rag.retriever:${safeId(retrieverValue.id)}`,
      'rag.retriever',
      retrieverValue.id,
      expected.description,
      {
        exportName,
        namespace: retrieverValue.namespace,
        mode: retrieverValue.mode,
      },
      expected,
    ),
    relations: [],
  }
}

async function resolvedRetrievalPipelineDefinition(
  root: string,
  file: string,
  exportName: string,
  value: unknown,
  expected: ProjectDefinition,
): Promise<{ definition: ProjectDefinition; relations: ProjectRelation[] } | undefined> {
  if (!isTaggedObject(value, 'RetrievalPipeline')) return undefined
  const pipelineValue = value as {
    id?: string
    namespace?: string
    mode?: string
    base?: { id?: string }
    stages?: Array<{ name?: string; phase?: string; kind?: string }>
  }
  const id = expected.id
  const retrieverId = pipelineValue.base?.id
  const definitionItem = await resolvedDefinition(
    root,
    file,
    id,
    'rag.pipeline',
    expected.name || exportName,
    expected.description,
    {
      exportName,
      retrieverId,
      namespace: pipelineValue.namespace,
      mode: pipelineValue.mode,
      stageNames: (pipelineValue.stages ?? [])
        .map((stage) => stage.name)
        .filter((name): name is string => typeof name === 'string'),
      stages: (pipelineValue.stages ?? []).map((stage) => ({
        name: stage.name,
        phase: stage.phase,
        kind: stage.kind,
      })),
    },
    expected,
  )
  const relations = relationsFromExpected(expected, id, file).filter(
    (relationItem) => relationItem.type !== 'rag.pipeline.uses_retriever',
  )
  if (retrieverId)
    relations.push(relation('rag.pipeline.uses_retriever', id, `rag.retriever:${safeId(retrieverId)}`, file))
  return { definition: definitionItem, relations }
}

async function resolvedRetrievalRecipeDefinition(
  root: string,
  file: string,
  exportName: string,
  value: unknown,
  expected: ProjectDefinition,
): Promise<{ definition: ProjectDefinition; relations: ProjectRelation[] } | undefined> {
  if (!isTaggedObject(value, 'RetrievalRecipe')) return undefined
  const recipeValue = value as {
    id: string
    inspect?: () => { retrieverIds?: readonly string[]; stepCount?: number }
  }
  const inspected = typeof recipeValue.inspect === 'function' ? recipeValue.inspect() : undefined
  const id = `rag.recipe:${safeId(recipeValue.id)}`
  const definitionItem = await resolvedDefinition(
    root,
    file,
    id,
    'rag.recipe',
    recipeValue.id,
    expected.description,
    {
      exportName,
      retrieverIds: inspected?.retrieverIds,
      stepCount: inspected?.stepCount,
    },
    expected,
  )
  const relations = relationsFromExpected(expected, id, file).filter(
    (relationItem) => relationItem.type !== 'rag.recipe.uses_retriever',
  )
  for (const retrieverId of inspected?.retrieverIds ?? []) {
    relations.push(relation('rag.recipe.uses_retriever', id, `rag.retriever:${safeId(retrieverId)}`, file))
  }
  return { definition: definitionItem, relations }
}

async function resolvedMemoryDefinition(
  root: string,
  file: string,
  exportName: string,
  value: unknown,
  expected: ProjectDefinition,
): Promise<{ definition: ProjectDefinition; relations: ProjectRelation[] } | undefined> {
  if (!isTaggedObject(value, 'Memory')) return undefined
  const memoryValue = value as { id: string; blocks?: Array<{ id?: string; kind?: string; priority?: number }> }
  return {
    definition: await resolvedDefinition(
      root,
      file,
      `memory:${safeId(memoryValue.id)}`,
      'memory',
      memoryValue.id,
      expected.description,
      {
        exportName,
        blocks: (memoryValue.blocks ?? []).map((block) => ({
          id: block.id,
          kind: block.kind,
          priority: block.priority,
        })),
        blockCount: memoryValue.blocks?.length ?? 0,
      },
      expected,
    ),
    relations: [],
  }
}

async function resolvedBlackboardDefinition(
  root: string,
  file: string,
  exportName: string,
  value: unknown,
  expected: ProjectDefinition,
): Promise<{ definition: ProjectDefinition; relations: ProjectRelation[] } | undefined> {
  if (!isTaggedObject(value, 'Blackboard')) return undefined
  const blackboardValue = value as { id: string }
  return {
    definition: await resolvedDefinition(
      root,
      file,
      `blackboard:${safeId(blackboardValue.id)}`,
      'blackboard',
      blackboardValue.id,
      expected.description,
      {
        exportName,
      },
      expected,
    ),
    relations: [],
  }
}

async function resolvedConstraintDefinition(
  root: string,
  file: string,
  exportName: string,
  value: unknown,
  expected: ProjectDefinition,
): Promise<{ definition: ProjectDefinition; relations: ProjectRelation[] } | undefined> {
  if (!isTaggedObject(value, 'Constraint')) return undefined
  const constraintValue = value as { name: string; severity?: string; maxRetries?: number }
  return {
    definition: await resolvedDefinition(
      root,
      file,
      `constraint:${safeId(constraintValue.name)}`,
      'constraint',
      constraintValue.name,
      expected.description,
      {
        exportName,
        severity: constraintValue.severity,
        maxRetries: constraintValue.maxRetries,
      },
      expected,
    ),
    relations: [],
  }
}

async function resolvedGuardrailDefinition(
  root: string,
  file: string,
  exportName: string,
  value: unknown,
  expected: ProjectDefinition,
): Promise<{ definition: ProjectDefinition; relations: ProjectRelation[] } | undefined> {
  if (!isTaggedObject(value, 'Guardrail')) return undefined
  const guardrailValue = value as { name: string; phase?: string }
  return {
    definition: await resolvedDefinition(
      root,
      file,
      `guardrail:${safeId(guardrailValue.name)}`,
      'guardrail',
      guardrailValue.name,
      expected.description,
      {
        exportName,
        phase: guardrailValue.phase,
      },
      expected,
    ),
    relations: [],
  }
}

async function resolvedScorerDefinition(
  root: string,
  file: string,
  exportName: string,
  value: unknown,
  expected: ProjectDefinition,
): Promise<{ definition: ProjectDefinition; relations: ProjectRelation[] } | undefined> {
  if (!isJudgeInstance(value)) return undefined
  const scorerValue = value as { id: string }
  return {
    definition: await resolvedDefinition(
      root,
      file,
      `scorer:${safeId(scorerValue.id)}`,
      'scorer',
      scorerValue.id,
      expected.description,
      {
        exportName,
      },
      expected,
    ),
    relations: [],
  }
}

async function resolvedDefinition(
  root: string,
  file: string,
  id: string,
  kind: ProjectDefinitionKind,
  name: string,
  description: string | undefined,
  metadata: Record<string, unknown>,
  staticBase?: ProjectDefinition,
): Promise<ProjectDefinition> {
  const source = staticBase?.source ?? sourceForFile(file)
  return {
    id,
    kind,
    name,
    description,
    source,
    sourceSnippet: staticBase?.sourceSnippet ?? (await sourceSnippet(root, file)),
    fidelity: 'resolved',
    status: 'active',
    fingerprint: fingerprint({
      kind,
      name,
      description,
      metadata,
      file: definitionFingerprintFile(root, file),
    }),
    metadata,
  }
}

function relationsFromExpected(expected: ProjectDefinition, from: string, file: string): ProjectRelation[] {
  const sourceRelations = (expected.metadata?.staticRelations as Array<{ type: string; to: string }> | undefined) ?? []
  return sourceRelations.map((relationItem) => relation(relationItem.type, from, relationItem.to, file))
}

function isTaggedObject(value: unknown, tag: string): boolean {
  return Boolean(value && typeof value === 'object' && (value as { _tag?: unknown })._tag === tag)
}

function isFlowHandle(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && typeof (value as { name?: unknown }).name === 'string')
}

function isJudgeInstance(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as { id?: unknown }).id === 'string' &&
    typeof (value as { score?: unknown }).score === 'function',
  )
}

function toolNamesFromRuntime(tools: unknown): string[] {
  if (!tools) return []
  if (Array.isArray(tools)) {
    return tools
      .map((tool) =>
        tool && typeof tool === 'object' && typeof (tool as { name?: unknown }).name === 'string'
          ? (tool as { name: string }).name
          : undefined,
      )
      .filter((name): name is string => typeof name === 'string')
  }
  if (typeof tools === 'object') return Object.keys(tools)
  return []
}
