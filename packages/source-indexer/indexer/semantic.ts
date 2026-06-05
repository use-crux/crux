import ts from 'typescript'
import type { JsonSchema, ProjectDefinition, ProjectDefinitionKind, ProjectRelation, ProjectSourceRef, ProjectSourceRefRole } from '@crux/core/catalog'
import { collectTopLevelInitializers } from './ast/initializers'
import { propertyName, stringProperty } from './ast/literals'
import { expressionToJsonSchema } from './ast/schemas'
import { sourceForNode, sourceSnippetForNode } from './ast/snippets'
import { foldedCatalogChild } from './catalog-presentation'
import { stateResourceWriteWithoutReadFindings } from './catalog-lints'
import { safeId } from './definitions'
import type { CatalogPatchFacts } from './patches'
import { projectRelation } from './relation-registry'

type SemanticDefinitionKind = Extract<
  ProjectDefinition['kind'],
  | 'prompt'
  | 'context'
  | 'tool'
  | 'agent'
  | 'flow'
  | 'composition.parallel'
  | 'composition.pipeline'
  | 'composition.swarm'
  | 'composition.consensus'
  | 'routing.router'
  | 'routing.cascade'
  | 'routing.fallback'
  | 'constraint'
  | 'guardrail'
  | 'memory'
  | 'memory.block'
  | 'blackboard'
  | 'workspace'
>
type SemanticSchemaProperty = 'input' | 'output' | 'parameters' | 'args' | 'schema'
type SemanticSchemaMetadataKey = 'inputSchema' | 'outputSchema' | 'argsSchema' | 'schema'

interface SemanticDefinitionCandidate {
  readonly definitionId: string
  readonly kind: SemanticDefinitionKind
  readonly name: string
  readonly object: ts.ObjectLiteralExpression
  readonly call?: ts.CallExpression
}

interface SemanticSchemaCandidate extends SemanticDefinitionCandidate {
  readonly property: SemanticSchemaProperty
  readonly metadataKey: SemanticSchemaMetadataKey
  readonly expression: ts.Expression
}

interface SemanticSourceRefCandidate extends SemanticDefinitionCandidate {
  readonly property: string
  readonly role: ProjectSourceRefRole
  readonly expression: ts.Expression
  readonly metadata?: ProjectSourceRef['metadata']
}

interface SemanticResolvedSource {
  readonly symbol: string
  readonly sourceFile: ts.SourceFile
  readonly declaration: ts.Declaration
  readonly expression?: ts.Expression
  readonly functionName?: string
}

interface SemanticTarget {
  readonly id: string
  readonly kind: ProjectDefinitionKind
}

interface SemanticDefinitionEnrichment {
  readonly definition: ProjectDefinition
  readonly sourceRefs?: readonly ProjectSourceRef[]
  readonly relations?: readonly ProjectRelation[]
}

export function semanticCatalogFacts(root: string, files: readonly string[]): CatalogPatchFacts {
  if (files.length === 0) return { diagnostics: [] }
  const program = ts.createProgram({
    rootNames: [...files],
    options: {
      allowJs: false,
      noEmit: true,
      skipLibCheck: true,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
      strict: false,
    },
  })
  const checker = program.getTypeChecker()
  const sourceFileSet = new Set(files)
  const definitionPatches = new Map<string, ProjectDefinition>()
  const sourceRefs: { definitionId: string; ref: ProjectSourceRef }[] = []
  const seenSourceRefs = new Set<string>()
  const relations: ProjectRelation[] = []
  const seenRelations = new Set<string>()

  for (const sourceFile of program.getSourceFiles()) {
    if (!sourceFileSet.has(sourceFile.fileName)) continue
    for (const candidate of semanticDefinitionCandidates(sourceFile)) {
      for (const schemaCandidate of semanticSchemaCandidates(candidate)) {
        const resolved = resolveSemanticExpression(schemaCandidate.expression, checker)
        if (!resolved?.expression) continue
        const schema = semanticExpressionToJsonSchema(resolved, checker)
        if (!schema) continue

        mergeDefinitionPatch(definitionPatches, {
          ...semanticDefinitionPatchBase(schemaCandidate),
          metadata: { [schemaCandidate.metadataKey]: schema },
        })
        addSourceRef(sourceRefs, seenSourceRefs, schemaCandidate.definitionId, semanticSchemaSourceRef(schemaCandidate, resolved, Boolean(schema)))
        for (const nested of semanticNestedSchemaSourceRefs(schemaCandidate, resolved, checker)) {
          addSourceRef(sourceRefs, seenSourceRefs, schemaCandidate.definitionId, nested)
        }
      }

      for (const refCandidate of semanticSourceRefCandidates(candidate)) {
        const resolved = resolveSemanticExpression(refCandidate.expression, checker)
        if (!resolved) continue
        addSourceRef(sourceRefs, seenSourceRefs, refCandidate.definitionId, semanticSourceRef(refCandidate, resolved))
      }

      for (const ref of semanticTemplateInterpolationSourceRefs(candidate, checker)) {
        addSourceRef(sourceRefs, seenSourceRefs, candidate.definitionId, ref)
      }

      for (const ref of semanticAgentToolMapSourceRefs(candidate, checker)) {
        addSourceRef(sourceRefs, seenSourceRefs, candidate.definitionId, ref)
      }

      for (const relation of semanticRelationsForCandidate(candidate, checker)) {
        addRelation(relations, seenRelations, relation)
      }

      for (const enrichment of semanticDefinitionEnrichments(candidate, checker)) {
        mergeDefinitionPatch(definitionPatches, enrichment.definition)
        for (const ref of enrichment.sourceRefs ?? []) {
          addSourceRef(sourceRefs, seenSourceRefs, enrichment.definition.id, ref)
        }
        for (const relation of enrichment.relations ?? []) {
          addRelation(relations, seenRelations, relation)
        }
      }
    }
  }

  return {
    definitions: [...definitionPatches.values()],
    sourceRefs,
    relations,
    lintFindings: stateResourceWriteWithoutReadFindings({
      definitions: [...definitionPatches.values()],
      relations,
    }),
    diagnostics: [],
  }
}

function semanticDefinitionCandidates(sourceFile: ts.SourceFile): SemanticDefinitionCandidate[] {
  const candidates: SemanticDefinitionCandidate[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const firstArg = node.arguments[0]
      const object = firstArg && ts.isObjectLiteralExpression(firstArg) ? firstArg : undefined
      const callName = callExpressionName(node)
      const fallbackCandidate = callName === 'fallback' ? semanticFallbackCandidate(node, variableNameForNode(node)) : undefined
      const candidate = fallbackCandidate ?? (object ? semanticDefinitionCandidateForCall(callName, object, variableNameForNode(node)) : undefined)
      if (candidate) candidates.push({ ...candidate, call: node })
    }
    if (ts.isNewExpression(node) && callExpressionName(node) === 'Agent') {
      const object = node.arguments?.find((argument): argument is ts.ObjectLiteralExpression =>
        ts.isObjectLiteralExpression(argument),
      )
      if (object) candidates.push(semanticAgentCandidate(object, variableNameForNode(node)))
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return candidates
}

function semanticDefinitionCandidateForCall(
  callName: string | undefined,
  object: ts.ObjectLiteralExpression,
  variableName: string | undefined,
): SemanticDefinitionCandidate | undefined {
  switch (callName) {
    case 'prompt': {
      const name = stringProperty(object, 'id') ?? variableName ?? 'anonymous'
      return { definitionId: `prompt:${safeId(name)}`, kind: 'prompt', name, object }
    }
    case 'context': {
      const name = stringProperty(object, 'id') ?? variableName ?? 'anonymous'
      return { definitionId: `context:${safeId(name)}`, kind: 'context', name, object }
    }
    case 'tool':
    case 'createTool': {
      const name = stringProperty(object, 'name') ?? stringProperty(object, 'title') ?? variableName ?? 'anonymous'
      return { definitionId: `tool:${safeId(name)}`, kind: 'tool', name, object }
    }
    case 'agent':
    case 'convexAgent':
      return semanticAgentCandidate(object, variableName)
    case 'flow':
    case 'cruxFlow': {
      const name = stringProperty(object, 'name') ?? variableName ?? 'anonymous'
      return { definitionId: `flow:${safeId(name)}`, kind: 'flow', name, object }
    }
    case 'parallel':
      return { definitionId: `composition.parallel:${safeId(variableName ?? 'anonymous')}`, kind: 'composition.parallel', name: variableName ?? 'anonymous', object }
    case 'pipeline':
      return { definitionId: `composition.pipeline:${safeId(variableName ?? 'anonymous')}`, kind: 'composition.pipeline', name: variableName ?? 'anonymous', object }
    case 'swarm':
      return { definitionId: `composition.swarm:${safeId(variableName ?? 'anonymous')}`, kind: 'composition.swarm', name: variableName ?? 'anonymous', object }
    case 'consensus':
      return { definitionId: `composition.consensus:${safeId(variableName ?? 'anonymous')}`, kind: 'composition.consensus', name: variableName ?? 'anonymous', object }
    case 'router': {
      const name = stringProperty(object, 'id') ?? variableName ?? 'anonymous'
      return { definitionId: `routing.router:${safeId(name)}`, kind: 'routing.router', name, object }
    }
    case 'cascade': {
      const name = stringProperty(object, 'id') ?? variableName ?? 'anonymous'
      return { definitionId: `routing.cascade:${safeId(name)}`, kind: 'routing.cascade', name, object }
    }
    case 'constraint': {
      const name = stringProperty(object, 'name') ?? variableName ?? 'anonymous'
      return { definitionId: `constraint:${safeId(name)}`, kind: 'constraint', name, object }
    }
    case 'guardrail': {
      const name = stringProperty(object, 'name') ?? variableName ?? 'anonymous'
      return { definitionId: `guardrail:${safeId(name)}`, kind: 'guardrail', name, object }
    }
    case 'memory': {
      const name = semanticAuthoredResourceName(object, variableName)
      return { definitionId: `memory:${safeId(name)}`, kind: 'memory', name, object }
    }
    case 'blackboard': {
      const name = semanticAuthoredResourceName(object, variableName)
      return { definitionId: `blackboard:${safeId(name)}`, kind: 'blackboard', name, object }
    }
    case 'workspace': {
      const name = stringProperty(object, 'id') ?? variableName ?? 'anonymous'
      return { definitionId: `workspace:${safeId(name)}`, kind: 'workspace', name, object }
    }
    default:
      return undefined
  }
}

function semanticFallbackCandidate(
  call: ts.CallExpression,
  variableName: string | undefined,
): SemanticDefinitionCandidate | undefined {
  const options = semanticFallbackOptions(call)
  if (!options) return undefined
  const name = (options ? stringProperty(options, 'id') : undefined) ?? variableName ?? 'anonymous'
  return {
    definitionId: `routing.fallback:${safeId(name)}`,
    kind: 'routing.fallback',
    name,
    object: options,
    call,
  }
}

function semanticAuthoredResourceName(object: ts.ObjectLiteralExpression, variableName: string | undefined): string {
  const id = propertyInitializer(object, 'id')
  if (!id) return variableName ?? 'anonymous'
  const expression = unwrapExpression(id)
  if (ts.isStringLiteralLike(expression)) return expression.text
  const prefix = semanticCreateMemoryIdPrefix(expression)
  if (prefix) return prefix.endsWith(':') ? prefix.slice(0, -1) : prefix
  if (ts.isIdentifier(expression)) return expression.text
  return variableName ?? 'anonymous'
}

function semanticCreateMemoryIdPrefix(expression: ts.Expression): string | undefined {
  if (!ts.isCallExpression(expression) || callExpressionName(expression) !== 'createMemoryId') return undefined
  const [typeArg] = expression.arguments
  if (!typeArg || !ts.isStringLiteralLike(typeArg)) return undefined
  switch (typeArg.text) {
    case 'session':
      return 'session:'
    case 'semantic':
      return 'project-knowledge:'
    case 'episodic':
      return 'user-episodes:'
    case 'blackboard':
      return 'thread:'
    default:
      return undefined
  }
}

function semanticAgentCandidate(
  object: ts.ObjectLiteralExpression,
  variableName: string | undefined,
): SemanticDefinitionCandidate {
  const name = stringProperty(object, 'id') ?? stringProperty(object, 'name') ?? variableName ?? 'anonymous'
  return { definitionId: `agent:${safeId(name)}`, kind: 'agent', name, object }
}

function semanticSchemaCandidates(candidate: SemanticDefinitionCandidate): SemanticSchemaCandidate[] {
  const candidates: SemanticSchemaCandidate[] = []
  pushSchemaCandidate(candidates, candidate, 'input', 'inputSchema')
  pushSchemaCandidate(candidates, candidate, 'output', 'outputSchema')
  pushSchemaCandidate(candidates, candidate, 'parameters', 'inputSchema')
  pushSchemaCandidate(candidates, candidate, 'args', 'argsSchema')
  pushSchemaCandidate(candidates, candidate, 'schema', 'schema')
  return candidates
}

function pushSchemaCandidate(
  candidates: SemanticSchemaCandidate[],
  candidate: SemanticDefinitionCandidate,
  property: SemanticSchemaProperty,
  metadataKey: SemanticSchemaMetadataKey,
): void {
  const expression = propertyInitializer(candidate.object, property)
  if (!expression || !isResolvableSourceExpression(expression)) return
  candidates.push({ ...candidate, property, metadataKey, expression })
}

function semanticSourceRefCandidates(candidate: SemanticDefinitionCandidate): SemanticSourceRefCandidate[] {
  const candidates: SemanticSourceRefCandidate[] = []
  for (const spec of sourceRefPropertySpecs(candidate.kind)) {
    const expression = propertyInitializer(candidate.object, spec.property)
    if (!expression || !isResolvableSourceExpression(expression)) continue
    candidates.push({ ...candidate, ...spec, expression })
  }
  return candidates
}

function sourceRefPropertySpecs(
  kind: SemanticDefinitionKind,
): Array<{ property: string; role: ProjectSourceRefRole; metadata?: ProjectSourceRef['metadata'] }> {
  switch (kind) {
    case 'prompt':
      return [
        { property: 'system', role: 'system', metadata: { fragment: true } },
        { property: 'prompt', role: 'prompt' },
      ]
    case 'context':
      return [
        { property: 'system', role: 'system', metadata: { fragment: true } },
        { property: 'resolve', role: 'resolver' },
        { property: 'render', role: 'callback' },
        { property: 'handler', role: 'handler' },
        { property: 'when', role: 'policy' },
      ]
    case 'tool':
      return [
        { property: 'execute', role: 'execute' },
        { property: 'run', role: 'callback' },
        { property: 'handler', role: 'handler' },
      ]
    case 'agent':
      return [
        { property: 'prompt', role: 'config' },
        { property: 'tools', role: 'config' },
        { property: 'contextHandler', role: 'callback' },
        { property: 'usageHandler', role: 'callback' },
        { property: 'prepare', role: 'callback' },
      ]
    case 'routing.router':
      return [
        { property: 'classify', role: 'callback' },
      ]
    case 'routing.fallback':
      return [
        { property: 'shouldFallback', role: 'policy' },
        { property: 'onAttemptError', role: 'callback' },
      ]
    default:
      return []
  }
}

function semanticRelationsForCandidate(
  candidate: SemanticDefinitionCandidate,
  checker: ts.TypeChecker,
): ProjectRelation[] {
  const accessRelations = semanticCallbackAccessRelations(candidate, checker)
  switch (candidate.kind) {
    case 'prompt':
    case 'context':
    case 'tool':
      return accessRelations
    case 'agent':
      return [...semanticAgentRelations(candidate, checker), ...accessRelations]
    case 'flow':
      return [...semanticFlowRelations(candidate, checker), ...semanticFlowAccessRelations(candidate, checker)]
    case 'composition.parallel':
    case 'composition.pipeline':
    case 'composition.swarm':
    case 'composition.consensus':
      return semanticCompositionRelations(candidate, checker)
    case 'routing.router':
      return [...semanticRouterRelations(candidate, checker), ...accessRelations]
    case 'routing.cascade':
      return semanticCascadeRelations(candidate, checker)
    case 'routing.fallback':
      return [...semanticFallbackRelations(candidate, checker), ...accessRelations]
    case 'constraint':
    case 'guardrail':
      return semanticSafetyRelations(candidate, checker)
    default:
      return []
  }
}

function semanticDefinitionEnrichments(
  candidate: SemanticDefinitionCandidate,
  checker: ts.TypeChecker,
): SemanticDefinitionEnrichment[] {
  switch (candidate.kind) {
    case 'memory':
      return semanticMemoryDefinitionEnrichments(candidate, checker)
    case 'workspace':
      return semanticWorkspaceDefinitionEnrichments(candidate, checker)
    case 'routing.router':
      return semanticRouterDefinitionEnrichments(candidate, checker)
    case 'routing.cascade':
      return semanticCascadeDefinitionEnrichments(candidate, checker)
    case 'routing.fallback':
      return semanticFallbackDefinitionEnrichments(candidate, checker)
    default:
      return []
  }
}

function semanticRouterRelations(
  candidate: SemanticDefinitionCandidate,
  checker: ts.TypeChecker,
): ProjectRelation[] {
  const routes = semanticObjectProperty(candidate.object, 'routes', checker)
  if (!routes) return []
  const relations: ProjectRelation[] = []
  for (const property of routes.properties) {
    const routeKey = semanticObjectPropertyName(property)
    const expression = objectMemberExpression(property)
    if (!routeKey || !expression) continue
    const target = semanticTargetForExpression(expression, checker)
    const type = target ? routingTargetRelationType('router.route', target.kind) : undefined
    if (!target || !type) continue
    relations.push(semanticRelation(candidate, type, `${candidate.definitionId}:route:${safeId(routeKey)}`, target.id))
  }
  return relations
}

function semanticCascadeRelations(
  candidate: SemanticDefinitionCandidate,
  checker: ts.TypeChecker,
): ProjectRelation[] {
  const tiers = semanticArrayProperty(candidate.object, 'tiers', checker)
  if (!tiers) return []
  const relations: ProjectRelation[] = []
  tiers.elements.forEach((element, index) => {
    if (!ts.isObjectLiteralExpression(element)) return
    const model = propertyInitializer(element, 'model')
    if (!model) return
    const target = semanticTargetForExpression(model, checker)
    const type = target ? routingTargetRelationType('cascade.tier', target.kind) : undefined
    if (!target || !type) return
    relations.push(semanticRelation(candidate, type, `${candidate.definitionId}:tier:${index + 1}`, target.id))
  })
  return relations
}

function semanticFallbackRelations(
  candidate: SemanticDefinitionCandidate,
  checker: ts.TypeChecker,
): ProjectRelation[] {
  if (!candidate.call) return []
  const options = semanticFallbackOptions(candidate.call)
  const modelArgs = candidate.call.arguments.filter((argument) => argument !== options)
  const relations: ProjectRelation[] = []
  modelArgs.forEach((argument, index) => {
    if (!ts.isExpression(argument)) return
    const target = semanticTargetForExpression(argument, checker)
    const type = target ? routingTargetRelationType('fallback.option', target.kind) : undefined
    if (!target || !type) return
    relations.push(semanticRelation(candidate, type, `${candidate.definitionId}:option:${index + 1}`, target.id))
  })
  return relations
}

function semanticRouterDefinitionEnrichments(
  candidate: SemanticDefinitionCandidate,
  checker: ts.TypeChecker,
): SemanticDefinitionEnrichment[] {
  const routes = semanticObjectProperty(candidate.object, 'routes', checker)
  if (!routes) return []
  return routes.properties.flatMap((property, index) => {
    const routeKey = semanticObjectPropertyName(property)
    const expression = objectMemberExpression(property)
    if (!routeKey || !expression) return []
    const target = semanticTargetForExpression(expression, checker)
    const ref = semanticRoutingTargetSourceRef(
      `${candidate.definitionId}:route:${safeId(routeKey)}`,
      'routes',
      expression,
      checker,
    )
    return ref
      ? [{
          definition: semanticRoutingChildPatch(`${candidate.definitionId}:route:${safeId(routeKey)}`, 'routing.router.route', routeKey, target, index),
          sourceRefs: [ref],
        }]
      : target
        ? [{
            definition: semanticRoutingChildPatch(`${candidate.definitionId}:route:${safeId(routeKey)}`, 'routing.router.route', routeKey, target, index),
          }]
      : []
  })
}

function semanticCascadeDefinitionEnrichments(
  candidate: SemanticDefinitionCandidate,
  checker: ts.TypeChecker,
): SemanticDefinitionEnrichment[] {
  const tiers = semanticArrayProperty(candidate.object, 'tiers', checker)
  if (!tiers) return []
  return tiers.elements.flatMap((element, index) => {
    if (!ts.isObjectLiteralExpression(element)) return []
    const definitionId = `${candidate.definitionId}:tier:${index + 1}`
    const sourceRefs: ProjectSourceRef[] = []
    const model = propertyInitializer(element, 'model')
    const target = model ? semanticTargetForExpression(model, checker) : undefined
    const targetRef = model ? semanticRoutingTargetSourceRef(definitionId, 'model', model, checker) : undefined
    if (targetRef) sourceRefs.push(targetRef)
    const evaluate = propertyInitializer(element, 'evaluate')
    const evaluateRef = evaluate ? semanticResolvedSourceRef(definitionId, 'evaluate', 'callback', evaluate, checker) : undefined
    if (evaluateRef) sourceRefs.push(evaluateRef)
    return sourceRefs.length > 0
      ? [{
          definition: semanticRoutingChildPatch(definitionId, 'routing.cascade.tier', `tier ${index + 1}`, target, index),
          sourceRefs,
        }]
      : target
        ? [{
            definition: semanticRoutingChildPatch(definitionId, 'routing.cascade.tier', `tier ${index + 1}`, target, index),
          }]
      : []
  })
}

function semanticFallbackDefinitionEnrichments(
  candidate: SemanticDefinitionCandidate,
  checker: ts.TypeChecker,
): SemanticDefinitionEnrichment[] {
  if (!candidate.call) return []
  const options = semanticFallbackOptions(candidate.call)
  const modelArgs = candidate.call.arguments.filter((argument) => argument !== options)
  return modelArgs.flatMap((argument, index) => {
    if (!ts.isExpression(argument)) return []
    const definitionId = `${candidate.definitionId}:option:${index + 1}`
    const target = semanticTargetForExpression(argument, checker)
    const ref = semanticRoutingTargetSourceRef(definitionId, 'model', argument, checker)
    return ref
      ? [{
          definition: semanticRoutingChildPatch(definitionId, 'routing.fallback.option', `option ${index + 1}`, target, index),
          sourceRefs: [ref],
        }]
      : target
        ? [{
            definition: semanticRoutingChildPatch(definitionId, 'routing.fallback.option', `option ${index + 1}`, target, index),
          }]
      : []
  })
}

function semanticRoutingChildPatch(
  id: string,
  kind: Extract<ProjectDefinitionKind, 'routing.router.route' | 'routing.cascade.tier' | 'routing.fallback.option'>,
  name: string,
  target?: SemanticTarget,
  order?: number,
): ProjectDefinition {
  const presentation = semanticRoutingChildPresentation(id, kind, order)
  return {
    id,
    kind,
    name,
    fidelity: 'resolved',
    status: 'active',
    metadata: {
      catalogPresentation: presentation,
      ...(target ? { targetKind: target.kind, targetDefinitionId: target.id } : {}),
    },
  }
}

function semanticRoutingChildPresentation(
  id: string,
  kind: Extract<ProjectDefinitionKind, 'routing.router.route' | 'routing.cascade.tier' | 'routing.fallback.option'>,
  order?: number,
) {
  if (kind === 'routing.router.route') {
    return foldedCatalogChild({
      parentDefinitionId: id.split(':route:')[0],
      parentRelationType: 'router.includes_route',
      role: 'route',
      order,
    })
  }
  if (kind === 'routing.cascade.tier') {
    return foldedCatalogChild({
      parentDefinitionId: id.split(':tier:')[0],
      parentRelationType: 'cascade.includes_tier',
      role: 'tier',
      order,
    })
  }
  return foldedCatalogChild({
    parentDefinitionId: id.split(':option:')[0],
    parentRelationType: 'fallback.includes_option',
    role: 'option',
    order,
  })
}

interface SemanticMemoryBlock {
  readonly id?: string
  readonly kind?: string
  readonly schema?: JsonSchema
  readonly schemaExpression?: ts.Expression
  readonly schemaResolved?: SemanticResolvedSource
  readonly object: ts.ObjectLiteralExpression
}

function semanticMemoryDefinitionEnrichments(
  candidate: SemanticDefinitionCandidate,
  checker: ts.TypeChecker,
): SemanticDefinitionEnrichment[] {
  const blocksExpression = propertyInitializer(candidate.object, 'blocks')
  if (!blocksExpression) return []
  const blocks = semanticArrayExpression(blocksExpression, checker, new Set())
  if (!blocks) return []

  const blockMetadata: Array<Record<string, unknown>> = []
  const enrichments: SemanticDefinitionEnrichment[] = []
  const relations: ProjectRelation[] = []

  for (const [index, element] of blocks.elements.entries()) {
    if (!ts.isExpression(element)) continue
    const block = semanticMemoryBlockForExpression(element, checker)
    if (!block) continue
    const blockId = block.id ?? block.kind ?? 'block'
    const definitionId = `memory.block:${safeId(candidate.name)}:${safeId(blockId)}`
    const sourceRefs = block.schemaResolved && block.schemaExpression
      ? [
          semanticSchemaSourceRef(
            {
              definitionId,
              kind: 'memory.block',
              name: blockId,
              object: block.object,
              property: 'schema',
              metadataKey: 'schema',
              expression: block.schemaExpression,
            },
            block.schemaResolved,
            Boolean(block.schema),
          ),
        ]
      : []
    const metadata = {
      memoryId: candidate.definitionId,
      blockId: block.id,
      blockKind: block.kind,
      catalogPresentation: foldedCatalogChild({
        parentDefinitionId: candidate.definitionId,
        parentRelationType: 'memory.includes_block',
        role: 'block',
        order: index,
      }),
      schema: block.schema,
    }
    blockMetadata.push({
      id: block.id,
      kind: block.kind,
      schema: block.schema,
    })
    enrichments.push({
      definition: {
        id: definitionId,
        kind: 'memory.block',
        name: blockId,
        fidelity: 'resolved',
        status: 'active',
        metadata,
      },
      sourceRefs,
    })
    relations.push(semanticRelation(candidate, 'memory.includes_block', candidate.definitionId, definitionId))
  }

  if (blockMetadata.length === 0) return []
  const schemas = blockMetadata
    .map((block) => block.schema)
    .filter((schema): schema is JsonSchema => Boolean(schema))
  const workingSchemas = blockMetadata
    .filter((block) => block.kind === 'working' && block.schema)
    .map((block) => block.schema)
    .filter((schema): schema is JsonSchema => Boolean(schema))
  enrichments.unshift({
    definition: {
      ...semanticDefinitionPatchBase(candidate),
      metadata: {
        blocks: blockMetadata,
        blockCount: blockMetadata.length,
        schema: workingSchemas.length === 1 ? workingSchemas[0] : schemas.length === 1 ? schemas[0] : undefined,
      },
    },
    relations,
  })
  return enrichments
}

function semanticMemoryBlockForExpression(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  seen = new Set<string>(),
): SemanticMemoryBlock | undefined {
  const unwrapped = unwrapExpression(expression)
  if (ts.isCallExpression(unwrapped)) return semanticMemoryBlockForCall(unwrapped, checker)
  if (!isResolvableSourceExpression(unwrapped)) return undefined
  const resolved = resolveSemanticExpression(unwrapped, checker)
  if (!resolved?.expression) return undefined
  const key = semanticResolvedKey(resolved)
  if (seen.has(key)) return undefined
  const nextSeen = new Set(seen)
  nextSeen.add(key)
  return semanticMemoryBlockForExpression(resolved.expression, checker, nextSeen)
}

function semanticMemoryBlockForCall(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
): SemanticMemoryBlock | undefined {
  const callName = callExpressionName(call)
  const [firstArg] = call.arguments
  if (!firstArg || !ts.isObjectLiteralExpression(firstArg)) return undefined
  const kind = semanticMemoryBlockKindForCall(callName, firstArg)
  if (!kind) return undefined
  const schemaExpression = propertyInitializer(firstArg, 'schema')
  const resolvedSchema = schemaExpression ? resolveSemanticExpression(schemaExpression, checker) : undefined
  const schema = resolvedSchema ? semanticExpressionToJsonSchema(resolvedSchema, checker) : undefined
  return {
    id: stringProperty(firstArg, 'id'),
    kind,
    schema,
    schemaExpression,
    schemaResolved: resolvedSchema,
    object: firstArg,
  }
}

function semanticMemoryBlockKindForCall(callName: string | undefined, object: ts.ObjectLiteralExpression): string | undefined {
  switch (callName) {
    case 'workingState':
      return 'working'
    case 'recentMessages':
      return 'recent'
    case 'episodes':
      return 'episodes'
    case 'facts':
      return 'facts'
    case 'procedures':
      return 'procedures'
    case 'reflections':
      return 'reflections'
    case 'memoryBlock':
      return stringProperty(object, 'kind') ?? 'custom'
    default:
      return undefined
  }
}

function semanticWorkspaceDefinitionEnrichments(
  candidate: SemanticDefinitionCandidate,
  checker: ts.TypeChecker,
): SemanticDefinitionEnrichment[] {
  const mountsExpression = propertyInitializer(candidate.object, 'mounts')
  if (!mountsExpression) return []
  const mounts = semanticArrayExpression(mountsExpression, checker, new Set())
  if (!mounts) return []
  const metadata = mounts.elements
    .filter((element): element is ts.ObjectLiteralExpression => ts.isObjectLiteralExpression(unwrapExpression(element)))
    .map((element) => unwrapExpression(element) as ts.ObjectLiteralExpression)
    .map((mount) => ({
      path: semanticStringLiteralProperty(mount, 'path'),
      access: semanticStringLiteralProperty(mount, 'access'),
      description: semanticStringLiteralProperty(mount, 'description'),
    }))
    .filter((mount) => mount.path || mount.access || mount.description)
  if (metadata.length === 0) return []
  return [
    {
      definition: {
        ...semanticDefinitionPatchBase(candidate),
        metadata: {
          mounts: metadata,
        },
      },
      relations: metadata.flatMap((mount) =>
        mount.path
          ? [semanticRelation(candidate, 'workspace.mounts_path', candidate.definitionId, `workspace.path:${safeId(candidate.name)}:${safeId(mount.path)}`)]
          : [],
      ),
    },
  ]
}

function semanticAgentRelations(
  candidate: SemanticDefinitionCandidate,
  checker: ts.TypeChecker,
): ProjectRelation[] {
  const relations: ProjectRelation[] = []
  const prompt = propertyInitializer(candidate.object, 'prompt')
  const promptTarget = prompt ? semanticTargetForExpression(prompt, checker) : undefined
  if (promptTarget?.kind === 'prompt') {
    relations.push(semanticRelation(candidate, 'agent.uses_prompt', candidate.definitionId, promptTarget.id))
  }

  for (const property of ['model', 'languageModel'] as const) {
    const model = propertyInitializer(candidate.object, property)
    const modelTarget = model ? semanticTargetForExpression(model, checker) : undefined
    if (modelTarget && isRoutingTargetKind(modelTarget.kind)) {
      relations.push(semanticRelation(candidate, 'agent.uses_routing', candidate.definitionId, modelTarget.id))
    }
  }

  const tools = propertyInitializer(candidate.object, 'tools')
  if (tools) {
    for (const target of semanticToolMapTargets(toExpression(tools), checker)) {
      relations.push(semanticRelation(candidate, 'agent.uses_tool', candidate.definitionId, target.id))
    }
  }
  return relations
}

function semanticFlowRelations(
  candidate: SemanticDefinitionCandidate,
  checker: ts.TypeChecker,
): ProjectRelation[] {
  const handler = propertyInitializer(candidate.object, 'handler')
  if (!handler) return []
  const relations: ProjectRelation[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'step') {
      const [stepArg, targetArg] = node.arguments
      if (stepArg && ts.isStringLiteralLike(stepArg) && targetArg) {
        const target = semanticTargetForExpression(targetArg, checker)
        const type = target ? flowStepRelationType(target.kind) : undefined
        if (target && type) {
          relations.push(
            semanticRelation(
              candidate,
              type,
              `flow.step:${safeId(candidate.name)}:${safeId(stepArg.text)}`,
              target.id,
            ),
          )
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(handler)
  return relations
}

function semanticCompositionRelations(
  candidate: SemanticDefinitionCandidate,
  checker: ts.TypeChecker,
): ProjectRelation[] {
  switch (candidate.kind) {
    case 'composition.parallel':
      return semanticParallelRelations(candidate, checker)
    case 'composition.pipeline':
      return semanticPipelineRelations(candidate, checker)
    case 'composition.consensus':
      return semanticConsensusRelations(candidate, checker)
    case 'composition.swarm':
      return semanticSwarmRelations(candidate, checker)
    default:
      return []
  }
}

function semanticParallelRelations(
  candidate: SemanticDefinitionCandidate,
  checker: ts.TypeChecker,
): ProjectRelation[] {
  const agents = objectProperty(candidate.object, 'agents')
  if (!agents) return []
  const relations: ProjectRelation[] = []
  for (const property of agents.properties) {
    const branchId = semanticObjectPropertyName(property)
    const expression = objectMemberExpression(property)
    if (!branchId || !expression) continue
    const target = semanticTargetForExpression(expression, checker)
    if (!target) continue
    const compositionType = compositionRelationType(target.kind)
    const branchType = branchRelationType('parallel', target.kind)
    if (compositionType) relations.push(semanticRelation(candidate, compositionType, candidate.definitionId, target.id))
    if (branchType) {
      relations.push(
        semanticRelation(
          candidate,
          branchType,
          `${candidate.definitionId}:branch:${safeId(branchId)}`,
          target.id,
        ),
      )
    }
  }
  return relations
}

function semanticPipelineRelations(
  candidate: SemanticDefinitionCandidate,
  checker: ts.TypeChecker,
): ProjectRelation[] {
  const steps = arrayProperty(candidate.object, 'steps')
  if (!steps) return []
  const relations: ProjectRelation[] = []
  steps.elements.forEach((element, index) => {
    if (!ts.isObjectLiteralExpression(element)) return
    const stageName = stringProperty(element, 'name') ?? `stage-${index + 1}`
    for (const property of ['agent', 'flow', 'prompt', 'tool'] as const) {
      const expression = propertyInitializer(element, property)
      if (!expression) continue
      const target = semanticTargetForExpression(expression, checker)
      if (!target) continue
      const compositionType = compositionRelationType(target.kind)
      const stageType = branchRelationType('pipeline', target.kind)
      if (compositionType) relations.push(semanticRelation(candidate, compositionType, candidate.definitionId, target.id))
      if (stageType) {
        relations.push(
          semanticRelation(
            candidate,
            stageType,
            `${candidate.definitionId}:stage:${safeId(stageName)}`,
            target.id,
          ),
        )
      }
    }
  })
  return relations
}

function semanticConsensusRelations(
  candidate: SemanticDefinitionCandidate,
  checker: ts.TypeChecker,
): ProjectRelation[] {
  const relations: ProjectRelation[] = []
  for (const expression of arrayPropertyExpressions(candidate.object, 'agents')) {
    const target = semanticTargetForExpression(expression, checker)
    if (target?.kind !== 'agent') continue
    relations.push(semanticRelation(candidate, 'composition.uses_agent', candidate.definitionId, target.id))
    relations.push(semanticRelation(candidate, 'consensus.includes_agent', candidate.definitionId, target.id))
  }
  const judge = propertyInitializer(candidate.object, 'judge')
  const judgeTarget = judge ? semanticTargetForExpression(judge, checker) : undefined
  if (judgeTarget?.kind === 'agent' || judgeTarget?.kind === 'scorer') {
    relations.push(semanticRelation(candidate, 'consensus.uses_judge', candidate.definitionId, judgeTarget.id))
  }
  const scorer = propertyInitializer(candidate.object, 'scorer')
  const scorerTarget = scorer ? semanticTargetForExpression(scorer, checker) : undefined
  if (scorerTarget?.kind === 'scorer') {
    relations.push(semanticRelation(candidate, 'consensus.uses_scorer', candidate.definitionId, scorerTarget.id))
  }
  return relations
}

function semanticSwarmRelations(
  candidate: SemanticDefinitionCandidate,
  checker: ts.TypeChecker,
): ProjectRelation[] {
  const relations: ProjectRelation[] = []
  const agents = objectProperty(candidate.object, 'agents')
  if (agents) {
    for (const property of agents.properties) {
      const expression = objectMemberExpression(property)
      if (!expression) continue
      const target = semanticTargetForExpression(expression, checker)
      if (target?.kind !== 'agent') continue
      relations.push(semanticRelation(candidate, 'composition.uses_agent', candidate.definitionId, target.id))
      relations.push(semanticRelation(candidate, 'swarm.includes_agent', candidate.definitionId, target.id))
    }
  }
  const blackboard = propertyInitializer(candidate.object, 'blackboard')
  const blackboardTarget = blackboard ? semanticTargetForExpression(blackboard, checker) : undefined
  if (blackboardTarget?.kind === 'blackboard') {
    relations.push(semanticRelation(candidate, 'swarm.uses_blackboard', candidate.definitionId, blackboardTarget.id))
  }
  for (const expression of propertyInitializer(candidate.object, 'memory') ? propertyExpressions(candidate.object, 'memory') : []) {
    const target = semanticTargetForExpression(expression, checker)
    if (target?.kind === 'memory') relations.push(semanticRelation(candidate, 'swarm.uses_memory', candidate.definitionId, target.id))
  }
  return relations
}

function semanticSafetyRelations(
  candidate: SemanticDefinitionCandidate,
  checker: ts.TypeChecker,
): ProjectRelation[] {
  const relationType = candidate.kind === 'constraint' ? 'constraint.applies_to' : 'guardrail.applies_to'
  const relations: ProjectRelation[] = []
  for (const property of ['appliesTo', 'target', 'targets', 'for'] as const) {
    for (const expression of propertyExpressions(candidate.object, property)) {
      const target = semanticTargetForExpression(expression, checker)
      if (target) relations.push(semanticRelation(candidate, relationType, candidate.definitionId, target.id))
    }
  }
  return relations
}

interface SemanticAccess {
  readonly kind: 'read' | 'write' | 'query' | 'score' | 'eval'
  readonly target: SemanticTarget
  readonly sourceFile: ts.SourceFile
  readonly node: ts.Node
}

function semanticCallbackAccessRelations(
  candidate: SemanticDefinitionCandidate,
  checker: ts.TypeChecker,
): ProjectRelation[] {
  return semanticCallbackProperties(candidate.kind)
    .flatMap((property) => {
      const expression = propertyInitializer(candidate.object, property)
      return expression ? semanticAccessesForExpression(expression, checker) : []
    })
    .flatMap((access) => semanticAccessRelation(candidate.kind, candidate.definitionId, access))
}

function semanticFlowAccessRelations(
  candidate: SemanticDefinitionCandidate,
  checker: ts.TypeChecker,
): ProjectRelation[] {
  const handler = propertyInitializer(candidate.object, 'handler')
  if (!handler) return []
  const relations: ProjectRelation[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'step') {
      const [stepArg, targetArg] = node.arguments
      if (stepArg && ts.isStringLiteralLike(stepArg) && targetArg) {
        const from = `flow.step:${safeId(candidate.name)}:${safeId(stepArg.text)}`
        for (const access of semanticAccessesForExpression(targetArg, checker)) {
          relations.push(...semanticAccessRelation('flow.step', from, access))
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(handler)
  return relations
}

function semanticCallbackProperties(kind: SemanticDefinitionKind): string[] {
  switch (kind) {
    case 'prompt':
      return ['prompt', 'system']
    case 'context':
      return ['resolve', 'render', 'handler', 'when', 'system']
    case 'tool':
      return ['execute', 'run', 'handler']
    case 'agent':
      return ['handler', 'run', 'execute', 'contextHandler', 'usageHandler', 'prepare']
    default:
      return []
  }
}

function semanticAccessesForExpression(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): SemanticAccess[] {
  const root = semanticAccessRootForExpression(expression, checker)
  if (!root) return []
  return semanticAccessesForNode(root.node, root.sourceFile, checker, new Set(), 1)
}

function semanticAccessRootForExpression(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): { node: ts.Node; sourceFile: ts.SourceFile } | undefined {
  const unwrapped = unwrapExpression(expression)
  if (semanticIsFunctionLike(unwrapped)) return { node: unwrapped, sourceFile: unwrapped.getSourceFile() }
  if (!isResolvableSourceExpression(unwrapped)) return undefined
  const resolved = resolveSemanticExpression(unwrapped, checker)
  if (!resolved) return undefined
  const node = semanticAccessNodeForResolved(resolved)
  return node ? { node, sourceFile: node.getSourceFile() } : undefined
}

function semanticAccessNodeForResolved(resolved: SemanticResolvedSource): ts.Node | undefined {
  if (resolved.expression) {
    const expression = unwrapExpression(resolved.expression)
    if (semanticIsFunctionLike(expression)) return expression
  }
  if (semanticIsFunctionLike(resolved.declaration)) return resolved.declaration
  return undefined
}

function semanticAccessesForNode(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  seen: Set<string>,
  helperDepth: number,
): SemanticAccess[] {
  const accesses: SemanticAccess[] = []
  const visit = (child: ts.Node): void => {
    if (ts.isCallExpression(child)) {
      accesses.push(...semanticAccessesForCall(child, sourceFile, checker))
      if (helperDepth > 0 && ts.isIdentifier(child.expression)) {
        const resolved = resolveSemanticExpression(child.expression, checker)
        const helperNode = resolved ? semanticAccessNodeForResolved(resolved) : undefined
        if (resolved && helperNode) {
          const key = semanticResolvedKey(resolved)
          if (!seen.has(key)) {
            const nextSeen = new Set(seen)
            nextSeen.add(key)
            accesses.push(...semanticAccessesForNode(helperNode, helperNode.getSourceFile(), checker, nextSeen, helperDepth - 1))
          }
        }
      }
    }
    ts.forEachChild(child, visit)
  }
  visit(node)
  return accesses
}

function semanticAccessesForCall(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
): SemanticAccess[] {
  if (!ts.isPropertyAccessExpression(call.expression)) {
    const target = semanticTargetForExpression(call.expression, checker)
    if (target?.kind === 'scorer') return [{ kind: 'score', target, sourceFile, node: call }]
    if (isEvalKind(target?.kind)) return [{ kind: 'eval', target, sourceFile, node: call }]
    return []
  }
  const target = semanticTargetForExpression(call.expression.expression, checker)
  if (!target) return []
  const method = call.expression.name.text
  const kind = semanticInvocationKind(method, target.kind)
  if (!kind) return []
  return [{ kind, target, sourceFile, node: call }]
}

function semanticInvocationKind(method: string, targetKind: ProjectDefinitionKind): SemanticAccess['kind'] | undefined {
  if (targetKind === 'memory' || targetKind === 'blackboard' || targetKind === 'workspace') return semanticDataAccessKind(method)
  if (targetKind === 'rag.retriever' && ['get', 'read', 'query', 'find', 'search', 'list', 'retrieve', 'run', 'load'].includes(method)) return 'query'
  if (targetKind === 'scorer' && ['score', 'judge', 'run', 'evaluate', 'call'].includes(method)) return 'score'
  if (isEvalKind(targetKind) && ['run', 'evaluate', 'execute', 'call'].includes(method)) return 'eval'
  return undefined
}

function semanticDataAccessKind(method: string): 'read' | 'write' | undefined {
  if (['get', 'read', 'query', 'find', 'search', 'list', 'readFile', 'load'].includes(method)) return 'read'
  if (['set', 'write', 'update', 'append', 'delete', 'put', 'writeFile', 'edit', 'deleteFile', 'save'].includes(method)) return 'write'
  return undefined
}

function semanticAccessRelation(
  fromKind: SemanticDefinitionKind | 'flow.step',
  from: string,
  access: SemanticAccess,
): ProjectRelation[] {
  const type = semanticAccessRelationType(fromKind, access.kind, access.target.kind)
  if (!type) return []
  return [
    projectRelation({
      type,
      from,
      to: access.target.id,
      fidelity: 'resolved',
      source: sourceForNode(access.sourceFile, access.node),
    }),
  ]
}

function semanticAccessRelationType(
  fromKind: SemanticDefinitionKind | 'flow.step',
  accessKind: SemanticAccess['kind'],
  targetKind: ProjectDefinitionKind,
): string | undefined {
  if (accessKind === 'query' && targetKind === 'rag.retriever') return `${fromKind}.queries_retriever`
  if (accessKind === 'score' && targetKind === 'scorer') return `${fromKind}.uses_scorer`
  if (accessKind === 'eval' && isEvalKind(targetKind)) return `${fromKind}.runs_eval`
  if (accessKind !== 'read' && accessKind !== 'write') return undefined
  const action = accessKind === 'read' ? 'reads' : 'writes'
  switch (targetKind) {
    case 'memory':
      return `${fromKind}.${action}_memory`
    case 'blackboard':
      return `${fromKind}.${action}_blackboard`
    case 'workspace':
      return `${fromKind}.${action}_workspace`
    default:
      return undefined
  }
}

function routingTargetRelationType(
  owner: 'router.route' | 'cascade.tier' | 'fallback.option',
  targetKind: ProjectDefinitionKind,
): string | undefined {
  if (!isRoutingTargetKind(targetKind) && targetKind !== 'agent' && targetKind !== 'prompt') return undefined
  const target = routingRelationTargetName(targetKind)
  if (!target) return undefined
  return `${owner}.uses_${target}`
}

function routingRelationTargetName(kind: ProjectDefinitionKind): string | undefined {
  switch (kind) {
    case 'routing.router':
      return 'router'
    case 'routing.cascade':
      return 'cascade'
    case 'routing.fallback':
      return 'fallback'
    case 'agent':
      return 'agent'
    case 'prompt':
      return 'prompt'
    default:
      return undefined
  }
}

function isRoutingTargetKind(kind: ProjectDefinitionKind | undefined): kind is Extract<ProjectDefinitionKind, 'routing.router' | 'routing.cascade' | 'routing.fallback'> {
  return kind === 'routing.router' || kind === 'routing.cascade' || kind === 'routing.fallback'
}

function isEvalKind(kind: ProjectDefinitionKind | undefined): kind is Extract<ProjectDefinitionKind, 'eval.prompt' | 'eval.flow' | 'eval.rag' | 'eval.quality'> {
  return kind === 'eval.prompt' || kind === 'eval.flow' || kind === 'eval.rag' || kind === 'eval.quality'
}

function semanticIsFunctionLike(node: ts.Node): node is ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)
}

function semanticRelation(
  candidate: SemanticDefinitionCandidate,
  type: string,
  from: string,
  to: string,
): ProjectRelation {
  return projectRelation({
    type,
    from,
    to,
    fidelity: 'resolved',
    source: sourceForNode(candidate.object.getSourceFile(), candidate.object),
  })
}

function semanticToolMapTargets(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  seen = new Set<string>(),
): SemanticTarget[] {
  const object = semanticObjectExpression(expression, checker, seen)
  if (!object) {
    const target = semanticTargetForExpression(expression, checker, seen)
    return target?.kind === 'tool' ? [target] : []
  }
  const targets: SemanticTarget[] = []
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) {
      targets.push(...semanticToolMapTargets(property.expression, checker, seen))
      continue
    }
    const member = objectMemberExpression(property)
    if (!member) continue
    const target = semanticTargetForExpression(member, checker, seen)
    if (target?.kind === 'tool') targets.push(target)
  }
  return dedupeTargets(targets)
}

function semanticTargetForExpression(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  seen = new Set<string>(),
): SemanticTarget | undefined {
  const unwrapped = unwrapExpression(expression)
  const direct = semanticTargetForDefinitionExpression(unwrapped, expressionSymbolName(unwrapped))
  if (direct) return direct

  if (!isResolvableSourceExpression(unwrapped)) return undefined
  const resolved = resolveSemanticExpression(unwrapped, checker)
  if (!resolved) return undefined
  return semanticTargetForResolved(resolved, checker, seen)
}

function semanticTargetForResolved(
  resolved: SemanticResolvedSource,
  checker: ts.TypeChecker,
  seen: Set<string>,
): SemanticTarget | undefined {
  if (!resolved.expression) return undefined
  const key = semanticResolvedKey(resolved)
  if (seen.has(key)) return undefined
  const nextSeen = new Set(seen)
  nextSeen.add(key)
  const expression = unwrapExpression(resolved.expression)
  return (
    semanticTargetForDefinitionExpression(expression, symbolNameForDeclaration(resolved.declaration) ?? resolved.symbol) ??
    semanticTargetForExpression(expression, checker, nextSeen)
  )
}

function semanticTargetForDefinitionExpression(
  expression: ts.Expression,
  variableName: string | undefined,
): SemanticTarget | undefined {
  if (ts.isCallExpression(expression)) {
    const callName = callExpressionName(expression)
    if (callName === 'fallback') {
      const target = semanticFallbackTarget(expression, variableName)
      if (target) return target
    }
    const firstArg = expression.arguments[0]
    const object = firstArg && ts.isObjectLiteralExpression(firstArg) ? firstArg : undefined
    if (object) {
      const candidate = semanticDefinitionCandidateForCall(callName, object, variableName)
      if (candidate) return { id: candidate.definitionId, kind: candidate.kind }
    }
    if (callName === 'retriever') {
      const name = object ? stringProperty(object, 'id') : undefined
      return { id: `rag.retriever:${safeId(name ?? variableName ?? 'anonymous')}`, kind: 'rag.retriever' }
    }
    if (callName === 'retrievalPipeline') {
      return { id: `rag.pipeline:${safeId(variableName ?? 'anonymous')}`, kind: 'rag.pipeline' }
    }
    if (callName === 'scorer' || callName === 'llmJudge') {
      const name = object ? stringProperty(object, 'id') ?? stringProperty(object, 'name') : undefined
      return { id: `scorer:${safeId(name ?? variableName ?? 'anonymous')}`, kind: 'scorer' }
    }
    if (callName === 'evaluation') {
      const name = object ? stringProperty(object, 'name') : undefined
      return { id: `eval.prompt:${safeId(name ?? variableName ?? 'anonymous')}`, kind: 'eval.prompt' }
    }
    if (callName === 'flowEvaluation') {
      const name = object ? stringProperty(object, 'name') : undefined
      return { id: `eval.flow:${safeId(name ?? variableName ?? 'anonymous')}`, kind: 'eval.flow' }
    }
    if (callName === 'ragEvaluation') {
      const name = object ? stringProperty(object, 'id') ?? stringProperty(object, 'name') : undefined
      return { id: `eval.rag:${safeId(name ?? variableName ?? 'anonymous')}`, kind: 'eval.rag' }
    }
  }
  if (ts.isNewExpression(expression) && callExpressionName(expression) === 'Agent') {
    const object = expression.arguments?.find((arg): arg is ts.ObjectLiteralExpression => ts.isObjectLiteralExpression(arg))
    if (!object) return undefined
    const candidate = semanticAgentCandidate(object, variableName)
    return { id: candidate.definitionId, kind: candidate.kind }
  }
  return undefined
}

function semanticFallbackTarget(call: ts.CallExpression, variableName: string | undefined): SemanticTarget | undefined {
  const options = semanticFallbackOptions(call)
  const name = (options ? stringProperty(options, 'id') : undefined) ?? variableName
  return name ? { id: `routing.fallback:${safeId(name)}`, kind: 'routing.fallback' } : undefined
}

function semanticObjectExpression(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  seen: Set<string>,
): ts.ObjectLiteralExpression | undefined {
  const unwrapped = unwrapExpression(expression)
  if (ts.isObjectLiteralExpression(unwrapped)) return unwrapped
  if (!isResolvableSourceExpression(unwrapped)) return undefined
  const resolved = resolveSemanticExpression(unwrapped, checker)
  if (!resolved?.expression) return undefined
  const key = semanticResolvedKey(resolved)
  if (seen.has(key)) return undefined
  const nextSeen = new Set(seen)
  nextSeen.add(key)
  return semanticObjectExpression(resolved.expression, checker, nextSeen)
}

function flowStepRelationType(kind: ProjectDefinitionKind): string | undefined {
  if (isRoutingTargetKind(kind)) return 'flow.step.uses_routing'
  switch (kind) {
    case 'agent':
      return 'flow.step.uses_agent'
    case 'prompt':
      return 'flow.step.uses_prompt'
    case 'tool':
      return 'flow.step.uses_tool'
    case 'memory':
      return 'flow.step.uses_memory'
    case 'blackboard':
      return 'flow.step.uses_blackboard'
    default:
      return undefined
  }
}

function compositionRelationType(kind: ProjectDefinitionKind): string | undefined {
  if (isRoutingTargetKind(kind)) return 'composition.uses_routing'
  switch (kind) {
    case 'agent':
      return 'composition.uses_agent'
    case 'flow':
      return 'composition.uses_flow'
    case 'prompt':
      return 'composition.uses_prompt'
    case 'tool':
      return 'composition.uses_tool'
    default:
      return undefined
  }
}

function branchRelationType(
  composition: 'parallel' | 'pipeline',
  kind: ProjectDefinitionKind,
): string | undefined {
  const prefix = composition === 'parallel' ? 'parallel.branch' : 'pipeline.stage'
  if (isRoutingTargetKind(kind)) return `${prefix}.uses_routing`
  switch (kind) {
    case 'agent':
      return `${prefix}.uses_agent`
    case 'flow':
      return `${prefix}.uses_flow`
    case 'prompt':
      return `${prefix}.uses_prompt`
    case 'tool':
      return `${prefix}.uses_tool`
    default:
      return undefined
  }
}

function objectProperty(object: ts.ObjectLiteralExpression, name: string): ts.ObjectLiteralExpression | undefined {
  const property = propertyInitializer(object, name)
  return property && ts.isObjectLiteralExpression(toExpression(property)) ? toExpression(property) as ts.ObjectLiteralExpression : undefined
}

function semanticObjectProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
  checker: ts.TypeChecker,
): ts.ObjectLiteralExpression | undefined {
  const property = propertyInitializer(object, name)
  return property ? semanticObjectExpression(toExpression(property), checker, new Set()) : undefined
}

function arrayProperty(object: ts.ObjectLiteralExpression, name: string): ts.ArrayLiteralExpression | undefined {
  const property = propertyInitializer(object, name)
  return property && ts.isArrayLiteralExpression(toExpression(property)) ? toExpression(property) as ts.ArrayLiteralExpression : undefined
}

function semanticArrayProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
  checker: ts.TypeChecker,
): ts.ArrayLiteralExpression | undefined {
  const property = propertyInitializer(object, name)
  return property ? semanticArrayExpression(toExpression(property), checker, new Set()) : undefined
}

function semanticArrayExpression(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  seen: Set<string>,
): ts.ArrayLiteralExpression | undefined {
  const unwrapped = unwrapExpression(expression)
  if (ts.isArrayLiteralExpression(unwrapped)) return unwrapped
  if (!isResolvableSourceExpression(unwrapped)) return undefined
  const resolved = resolveSemanticExpression(unwrapped, checker)
  if (!resolved?.expression) return undefined
  const key = semanticResolvedKey(resolved)
  if (seen.has(key)) return undefined
  const nextSeen = new Set(seen)
  nextSeen.add(key)
  return semanticArrayExpression(resolved.expression, checker, nextSeen)
}

function semanticStringLiteralProperty(object: ts.ObjectLiteralExpression, name: string): string | undefined {
  const initializer = propertyInitializer(object, name)
  if (!initializer) return undefined
  const expression = unwrapExpression(initializer)
  return ts.isStringLiteralLike(expression) ? expression.text : undefined
}

function semanticFallbackOptions(call: ts.CallExpression): ts.ObjectLiteralExpression | undefined {
  const last = call.arguments.at(-1)
  if (!last || !ts.isObjectLiteralExpression(last)) return undefined
  const hasOptionsShape = Boolean(
    stringProperty(last, 'id') ||
      stringProperty(last, 'description') ||
      propertyInitializer(last, 'timeout') ||
      propertyInitializer(last, 'timeoutMs') ||
      propertyInitializer(last, 'on') ||
      propertyInitializer(last, 'shouldFallback') ||
      propertyInitializer(last, 'onAttemptError'),
  )
  return hasOptionsShape ? last : undefined
}

function propertyExpressions(object: ts.ObjectLiteralExpression, name: string): ts.Expression[] {
  const property = propertyInitializer(object, name)
  if (!property) return []
  const expression = toExpression(property)
  return ts.isArrayLiteralExpression(expression) ? expression.elements.filter((item): item is ts.Expression => ts.isExpression(item)) : [expression]
}

function arrayPropertyExpressions(object: ts.ObjectLiteralExpression, name: string): ts.Expression[] {
  return arrayProperty(object, name)?.elements.filter((item): item is ts.Expression => ts.isExpression(item)) ?? []
}

function objectMemberExpression(property: ts.ObjectLiteralElementLike): ts.Expression | undefined {
  if (ts.isShorthandPropertyAssignment(property)) return property.name
  if (ts.isPropertyAssignment(property)) return property.initializer
  return undefined
}

function semanticObjectPropertyName(property: ts.ObjectLiteralElementLike): string | undefined {
  if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property) || ts.isMethodDeclaration(property)) {
    return propertyName(property.name)
  }
  return undefined
}

function toExpression(value: ts.Expression | ts.ShorthandPropertyAssignment): ts.Expression {
  return ts.isShorthandPropertyAssignment(value) ? value.name : value
}

function expressionSymbolName(expression: ts.Expression): string | undefined {
  return ts.isIdentifier(expression) ? expression.text : undefined
}

function dedupeTargets(targets: readonly SemanticTarget[]): SemanticTarget[] {
  const merged = new Map<string, SemanticTarget>()
  for (const target of targets) merged.set(`${target.kind}:${target.id}`, target)
  return [...merged.values()]
}

function semanticTemplateInterpolationSourceRefs(
  candidate: SemanticDefinitionCandidate,
  checker: ts.TypeChecker,
): ProjectSourceRef[] {
  const system = propertyInitializer(candidate.object, 'system')
  if (!system) return []
  const template = unwrapExpression(system)
  if (!ts.isTemplateExpression(template)) return []
  const refs: ProjectSourceRef[] = []
  const seen = new Set<string>()
  for (const span of template.templateSpans) {
    const expression = unwrapExpression(span.expression)
    if (!isResolvableSourceExpression(expression)) continue
    const resolved = resolveSemanticExpression(expression, checker, expression.getText())
    if (!resolved || seen.has(resolved.symbol)) continue
    seen.add(resolved.symbol)
    refs.push(
      semanticSourceRef(
        {
          ...candidate,
          property: 'system',
          role: 'system',
          expression,
          metadata: { injected: true, fragment: isFragmentLike(resolved.expression) },
        },
        resolved,
      ),
    )
  }
  return refs
}

function semanticAgentToolMapSourceRefs(
  candidate: SemanticDefinitionCandidate,
  checker: ts.TypeChecker,
): ProjectSourceRef[] {
  if (candidate.kind !== 'agent') return []
  const tools = propertyInitializer(candidate.object, 'tools')
  if (!tools || !isResolvableSourceExpression(tools)) return []
  const resolvedTools = resolveSemanticExpression(tools, checker)
  const object = resolvedTools?.expression ? unwrapExpression(resolvedTools.expression) : undefined
  if (!object || !ts.isObjectLiteralExpression(object)) return []
  const refs: ProjectSourceRef[] = []
  const seen = new Set<string>()
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) {
      const expression = unwrapExpression(property.expression)
      if (!isResolvableSourceExpression(expression)) continue
      const resolved = resolveSemanticExpression(expression, checker)
      if (!resolved || seen.has(`spread:${resolved.symbol}`)) continue
      seen.add(`spread:${resolved.symbol}`)
      refs.push(
        semanticSourceRef(
          {
            ...candidate,
            property: 'tools',
            role: 'config',
            expression,
            metadata: { toolMapContributor: 'spread' },
          },
          resolved,
        ),
      )
      continue
    }
    const expression = toolMapPropertyExpression(property)
    if (!expression || !isResolvableSourceExpression(expression)) continue
    const resolved = resolveSemanticExpression(expression, checker)
    if (!resolved || seen.has(`property:${resolved.symbol}`)) continue
    seen.add(`property:${resolved.symbol}`)
    refs.push(
      semanticSourceRef(
        {
          ...candidate,
          property: 'tools',
          role: 'config',
          expression,
          metadata: { toolMapContributor: 'property' },
        },
        resolved,
      ),
    )
  }
  return refs
}

function semanticNestedSchemaSourceRefs(
  candidate: SemanticSchemaCandidate,
  rootResolved: SemanticResolvedSource,
  checker: ts.TypeChecker,
): ProjectSourceRef[] {
  if (!rootResolved.expression) return []
  const refs: ProjectSourceRef[] = []
  const seen = new Set<string>([rootResolved.symbol])
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && isReferenceIdentifier(node) && !isKnownLibraryIdentifier(node.text)) {
      const resolved = resolveSemanticExpression(node, checker)
      if (resolved?.expression && !seen.has(resolved.symbol) && schemaKind(resolved.expression)) {
        seen.add(resolved.symbol)
        refs.push(
          semanticSchemaSourceRef(
            candidate,
            resolved,
            Boolean(semanticExpressionToJsonSchema(resolved, checker)),
            { nested: true },
          ),
        )
        ts.forEachChild(resolved.expression, visit)
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(rootResolved.expression, visit)
  return refs
}

function resolveSemanticExpression(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  displaySymbol?: string,
): SemanticResolvedSource | undefined {
  const unwrapped = unwrapExpression(expression)
  if (ts.isIdentifier(unwrapped)) return resolveSemanticSymbol(unwrapped, checker, displaySymbol)
  if (ts.isPropertyAccessExpression(unwrapped)) return resolveSemanticSymbol(unwrapped.name, checker, displaySymbol ?? unwrapped.getText())
  return undefined
}

function resolveSemanticSymbol(
  node: ts.Node,
  checker: ts.TypeChecker,
  displaySymbol?: string,
): SemanticResolvedSource | undefined {
  const symbol = shorthandAssignmentValueSymbol(node, checker) ?? checker.getSymbolAtLocation(node)
  const resolvedSymbol = symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol
  const declaration = resolvedSymbol?.declarations?.find(isSourceRefDeclaration)
  if (!declaration) return undefined
  const expression = expressionFromDeclaration(declaration)
  return {
    symbol: displaySymbol ?? symbolNameForDeclaration(declaration) ?? resolvedSymbol?.getName() ?? node.getText(),
    sourceFile: declaration.getSourceFile(),
    declaration,
    expression,
    functionName: functionNameForDeclaration(declaration),
  }
}

function shorthandAssignmentValueSymbol(node: ts.Node, checker: ts.TypeChecker): ts.Symbol | undefined {
  if (!ts.isIdentifier(node) || !ts.isShorthandPropertyAssignment(node.parent)) return undefined
  return checker.getShorthandAssignmentValueSymbol(node.parent)
}

function semanticDefinitionPatchBase(candidate: SemanticDefinitionCandidate): ProjectDefinition {
  return {
    id: candidate.definitionId,
    kind: candidate.kind,
    name: candidate.name,
    fidelity: 'resolved',
    status: 'active',
  }
}

function semanticSchemaSourceRef(
  candidate: SemanticSchemaCandidate,
  resolved: SemanticResolvedSource,
  parsedSchema: boolean,
  metadata?: ProjectSourceRef['metadata'],
): ProjectSourceRef {
  return semanticSourceRef(
    {
      ...candidate,
      role: 'schema',
      metadata: {
        schemaKind: schemaKind(resolved.expression),
        parsedSchema,
        ...metadata,
      },
    },
    resolved,
  )
}

function semanticExpressionToJsonSchema(
  resolved: SemanticResolvedSource,
  checker: ts.TypeChecker,
): JsonSchema | undefined {
  if (!resolved.expression) return undefined
  return expressionToJsonSchema(resolved.expression, topLevelInitializers(resolved.sourceFile), {
    resolveIdentifier: (identifier) => {
      const nested = resolveSemanticExpression(identifier, checker)
      if (!nested?.expression || !schemaKind(nested.expression)) return undefined
      return {
        key: semanticResolvedKey(nested),
        expression: nested.expression,
        localInitializers: topLevelInitializers(nested.sourceFile),
      }
    },
  })
}

function semanticResolvedKey(resolved: SemanticResolvedSource): string {
  return `${resolved.sourceFile.fileName}:${resolved.declaration.pos}:${resolved.declaration.end}:${resolved.symbol}`
}

function semanticSourceRef(candidate: SemanticSourceRefCandidate, resolved: SemanticResolvedSource): ProjectSourceRef {
  const source = sourceForNode(resolved.sourceFile, resolved.declaration)
  return {
    id: `${candidate.definitionId}:source:${candidate.role}:${candidate.property}:${resolved.symbol}`,
    role: candidate.role,
    property: candidate.property,
    symbol: resolved.symbol,
    source: resolved.functionName ? { ...source, function: resolved.functionName } : source,
    snippet: sourceSnippetForNode(resolved.sourceFile, resolved.declaration),
    fidelity: 'resolved',
    ...(candidate.metadata ? { metadata: candidate.metadata } : {}),
  }
}

function semanticRoutingTargetSourceRef(
  definitionId: string,
  property: string,
  expression: ts.Expression,
  checker: ts.TypeChecker,
): ProjectSourceRef | undefined {
  return semanticResolvedSourceRef(definitionId, property, 'config', expression, checker, { routingTarget: true })
}

function semanticResolvedSourceRef(
  definitionId: string,
  property: string,
  role: ProjectSourceRefRole,
  expression: ts.Expression,
  checker: ts.TypeChecker,
  metadata?: ProjectSourceRef['metadata'],
): ProjectSourceRef | undefined {
  const unwrapped = unwrapExpression(expression)
  if (!isResolvableSourceExpression(unwrapped)) return undefined
  const resolved = resolveSemanticExpression(unwrapped, checker)
  if (!resolved) return undefined
  const source = sourceForNode(resolved.sourceFile, resolved.declaration)
  return {
    id: `${definitionId}:source:${role}:${property}:${resolved.symbol}`,
    role,
    property,
    symbol: resolved.symbol,
    source: resolved.functionName ? { ...source, function: resolved.functionName } : source,
    snippet: sourceSnippetForNode(resolved.sourceFile, resolved.declaration),
    fidelity: 'resolved',
    ...(metadata ? { metadata } : {}),
  }
}

function addSourceRef(
  sourceRefs: { definitionId: string; ref: ProjectSourceRef }[],
  seen: Set<string>,
  definitionId: string,
  ref: ProjectSourceRef,
): void {
  const key = `${definitionId}:${ref.id}`
  if (seen.has(key)) return
  seen.add(key)
  sourceRefs.push({ definitionId, ref })
}

function addRelation(relations: ProjectRelation[], seen: Set<string>, relation: ProjectRelation): void {
  if (seen.has(relation.id)) return
  seen.add(relation.id)
  relations.push(relation)
}

function mergeDefinitionPatch(patches: Map<string, ProjectDefinition>, patch: ProjectDefinition): void {
  const existing = patches.get(patch.id)
  patches.set(patch.id, {
    ...(existing ?? patch),
    ...patch,
    metadata: {
      ...(existing?.metadata ?? {}),
      ...(patch.metadata ?? {}),
    },
    sourceRefs: [...(existing?.sourceRefs ?? []), ...(patch.sourceRefs ?? [])],
  })
}

function propertyInitializer(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  const property = object.properties.find(
    (item): item is ts.PropertyAssignment | ts.ShorthandPropertyAssignment =>
      (ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)) && propertyName(item.name) === name,
  )
  if (!property) return undefined
  return ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer
}

function toolMapPropertyExpression(property: ts.ObjectLiteralElementLike): ts.Expression | undefined {
  if (ts.isShorthandPropertyAssignment(property)) return property.name
  if (ts.isPropertyAssignment(property)) return property.initializer
  return undefined
}

function callExpressionName(node: ts.CallExpression | ts.NewExpression): string | undefined {
  if (ts.isIdentifier(node.expression)) return node.expression.text
  if (ts.isPropertyAccessExpression(node.expression)) return node.expression.name.text
  return undefined
}

function variableNameForNode(node: ts.Node): string | undefined {
  const parent = node.parent
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text
  if (ts.isPropertyAssignment(parent)) return propertyName(parent.name)
  return undefined
}

function topLevelInitializers(sourceFile: ts.SourceFile): Map<string, ts.Expression> {
  const initializers = new Map<string, ts.Expression>()
  collectTopLevelInitializers(sourceFile, initializers)
  return initializers
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) {
    current = current.expression
  }
  return current
}

function isResolvableSourceExpression(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression)
  return ts.isIdentifier(unwrapped) || ts.isPropertyAccessExpression(unwrapped)
}

function isSourceRefDeclaration(node: ts.Declaration): boolean {
  return (
    ts.isVariableDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isPropertyAssignment(node) ||
    ts.isShorthandPropertyAssignment(node) ||
    ts.isMethodDeclaration(node)
  )
}

function expressionFromDeclaration(node: ts.Declaration): ts.Expression | undefined {
  if (ts.isVariableDeclaration(node)) return node.initializer
  if (ts.isPropertyAssignment(node)) return node.initializer
  if (ts.isShorthandPropertyAssignment(node)) return node.name
  return undefined
}

function symbolNameForDeclaration(node: ts.Declaration): string | undefined {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text
  if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node) || ts.isMethodDeclaration(node)) {
    return propertyName(node.name)
  }
  return undefined
}

function functionNameForDeclaration(node: ts.Declaration): string | undefined {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text
  if (ts.isMethodDeclaration(node)) return propertyName(node.name)
  if (ts.isVariableDeclaration(node) && node.initializer) {
    const initializer = unwrapExpression(node.initializer)
    if ((ts.isFunctionExpression(initializer) || ts.isArrowFunction(initializer)) && ts.isIdentifier(node.name)) {
      return node.name.text
    }
  }
  if (ts.isPropertyAssignment(node)) {
    const initializer = unwrapExpression(node.initializer)
    if (ts.isFunctionExpression(initializer) || ts.isArrowFunction(initializer)) return propertyName(node.name)
  }
  return undefined
}

function isKnownLibraryIdentifier(symbol: string): boolean {
  return symbol === 'z' || symbol === 'v'
}

function isReferenceIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false
  if (ts.isShorthandPropertyAssignment(parent) && parent.name === node) return false
  if (ts.isMethodDeclaration(parent) && parent.name === node) return false
  if (ts.isPropertyDeclaration(parent) && parent.name === node) return false
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false
  if (ts.isFunctionDeclaration(parent) && parent.name === node) return false
  if (ts.isParameter(parent) && parent.name === node) return false
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false
  return true
}

function isFragmentLike(expression: ts.Expression | undefined): boolean {
  if (!expression) return false
  const unwrapped = unwrapExpression(expression)
  return ts.isStringLiteralLike(unwrapped) || ts.isTemplateExpression(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)
}

function schemaKind(expression: ts.Expression | undefined): 'zod' | 'convex-validator' | 'json-schema' | undefined {
  if (!expression) return undefined
  if (containsReceiver(expression, 'z')) return 'zod'
  if (containsReceiver(expression, 'v')) return 'convex-validator'
  if (ts.isObjectLiteralExpression(expression)) return 'json-schema'
  return undefined
}

function containsReceiver(node: ts.Node, receiverName: string): boolean {
  let found = false
  const visit = (child: ts.Node): void => {
    if (found) return
    if (
      ts.isPropertyAccessExpression(child) &&
      ts.isIdentifier(child.expression) &&
      child.expression.text === receiverName
    ) {
      found = true
      return
    }
    ts.forEachChild(child, visit)
  }
  visit(node)
  return found
}
