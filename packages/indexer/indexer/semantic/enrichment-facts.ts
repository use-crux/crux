import ts from 'typescript'
import type {
  JsonSchema,
  ProjectDefinition,
  ProjectDefinitionKind,
  ProjectRelation,
  ProjectSourceRef,
} from '@crux/core/project-index'
import { stringProperty } from '../ast/literals'
import { foldedIndexChild } from '../index-presentation'
import { safeId } from '../definitions'
import type {
  SemanticDefinitionCandidate,
  SemanticDefinitionEnrichment,
  SemanticMemoryBlock,
  SemanticTarget,
} from './candidates'
import {
  callExpressionName,
  isResolvableSourceExpression,
  objectMemberExpression,
  propertyInitializer,
  resolveSemanticExpression,
  semanticArrayExpression,
  semanticArrayProperty,
  semanticDefinitionPatchBase,
  semanticExpressionToJsonSchema,
  semanticFallbackOptions,
  semanticObjectProperty,
  semanticObjectPropertyName,
  semanticRelation,
  semanticResolvedKey,
  semanticResolvedSourceRef,
  semanticRoutingTargetSourceRef,
  semanticSchemaSourceRef,
  semanticStringLiteralProperty,
  semanticTargetForExpression,
  unwrapExpression,
} from './model'

/**
 * Produces semantic definition enrichments that cannot be represented by the
 * first static definition pass.
 *
 * Enrichments are pure patch facts: callers receive new definition/source-ref
 * values for routing children, memory blocks, and workspace resources while the
 * original candidate and AST remain unchanged.
 */
export function semanticDefinitionEnrichments(
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

/**
 * Builds folded route definitions and target source refs from router routes.
 */
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
      ? [
          {
            definition: semanticRoutingChildPatch(
              `${candidate.definitionId}:route:${safeId(routeKey)}`,
              'routing.router.route',
              routeKey,
              target,
              index,
            ),
            sourceRefs: [ref],
          },
        ]
      : target
        ? [
            {
              definition: semanticRoutingChildPatch(
                `${candidate.definitionId}:route:${safeId(routeKey)}`,
                'routing.router.route',
                routeKey,
                target,
                index,
              ),
            },
          ]
        : []
  })
}

/**
 * Builds folded tier definitions plus model/evaluate source refs from cascade
 * tiers.
 */
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
    const evaluateRef = evaluate
      ? semanticResolvedSourceRef(definitionId, 'evaluate', 'callback', evaluate, checker)
      : undefined
    if (evaluateRef) sourceRefs.push(evaluateRef)
    return sourceRefs.length > 0
      ? [
          {
            definition: semanticRoutingChildPatch(
              definitionId,
              'routing.cascade.tier',
              `tier ${index + 1}`,
              target,
              index,
            ),
            sourceRefs,
          },
        ]
      : target
        ? [
            {
              definition: semanticRoutingChildPatch(
                definitionId,
                'routing.cascade.tier',
                `tier ${index + 1}`,
                target,
                index,
              ),
            },
          ]
        : []
  })
}

/**
 * Builds folded option definitions and target source refs from fallback
 * alternatives.
 */
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
      ? [
          {
            definition: semanticRoutingChildPatch(
              definitionId,
              'routing.fallback.option',
              `option ${index + 1}`,
              target,
              index,
            ),
            sourceRefs: [ref],
          },
        ]
      : target
        ? [
            {
              definition: semanticRoutingChildPatch(
                definitionId,
                'routing.fallback.option',
                `option ${index + 1}`,
                target,
                index,
              ),
            },
          ]
        : []
  })
}

/**
 * Creates the shared Project Index patch for folded routing child definitions.
 */
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
      indexPresentation: presentation,
      ...(target ? { targetKind: target.kind, targetDefinitionId: target.id } : {}),
    },
  }
}

/**
 * Computes folded-child presentation metadata for a routing child id/kind pair.
 */
function semanticRoutingChildPresentation(
  id: string,
  kind: Extract<ProjectDefinitionKind, 'routing.router.route' | 'routing.cascade.tier' | 'routing.fallback.option'>,
  order?: number,
) {
  if (kind === 'routing.router.route') {
    return foldedIndexChild({
      parentDefinitionId: id.split(':route:')[0],
      parentRelationType: 'router.includes_route',
      role: 'route',
      order,
    })
  }
  if (kind === 'routing.cascade.tier') {
    return foldedIndexChild({
      parentDefinitionId: id.split(':tier:')[0],
      parentRelationType: 'cascade.includes_tier',
      role: 'tier',
      order,
    })
  }
  return foldedIndexChild({
    parentDefinitionId: id.split(':option:')[0],
    parentRelationType: 'fallback.includes_option',
    role: 'option',
    order,
  })
}

/**
 * Builds memory block child definitions, schema refs, and memory-block
 * membership relations.
 */
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
    const sourceRefs =
      block.schemaResolved && block.schemaExpression
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
      indexPresentation: foldedIndexChild({
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
  const schemas = blockMetadata.map((block) => block.schema).filter((schema): schema is JsonSchema => Boolean(schema))
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

/**
 * Resolves a memory block expression, following identifiers to reusable block
 * declarations with cycle protection.
 */
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

/**
 * Extracts memory block metadata from a known block factory call.
 */
function semanticMemoryBlockForCall(call: ts.CallExpression, checker: ts.TypeChecker): SemanticMemoryBlock | undefined {
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

/**
 * Maps a block factory call name to the normalized memory block kind.
 */
function semanticMemoryBlockKindForCall(
  callName: string | undefined,
  object: ts.ObjectLiteralExpression,
): string | undefined {
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

/**
 * Projects workspace mount metadata and mount-path relations from authored
 * workspace config.
 */
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
          ? [
              semanticRelation(
                candidate,
                'workspace.mounts_path',
                candidate.definitionId,
                `workspace.path:${safeId(candidate.name)}:${safeId(mount.path)}`,
              ),
            ]
          : [],
      ),
    },
  ]
}
