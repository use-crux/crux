import ts from 'typescript'
import type {
  InjectionToolFacts,
  InjectionUseFacts,
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
  semanticObjectExpression,
  semanticRelation,
  semanticResolvedKey,
  semanticResolvedSourceRef,
  semanticRoutingTargetSourceRef,
  semanticSchemaSourceRef,
  semanticStringLiteralProperty,
  semanticTargetForExpression,
  semanticToolMapTargets,
  toExpression,
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
    case 'prompt':
    case 'context':
    case 'injectable':
      return semanticInjectionDefinitionEnrichments(candidate, checker)
    default:
      return []
  }
}

function semanticInjectionDefinitionEnrichments(
  candidate: SemanticDefinitionCandidate,
  checker: ts.TypeChecker,
): SemanticDefinitionEnrichment[] {
  const useEntries = semanticInjectionUseEntryFacts(candidate, checker)
  const tools = semanticInjectionToolFacts(candidate, checker)
  if (useEntries.length === 0 && !tools) return []
  return [
    {
      definition: {
        ...semanticDefinitionPatchBase(candidate),
        metadata: {
          facts: {
            kind: candidate.kind,
            ...(useEntries.length > 0 ? { useEntries } : {}),
            ...(tools ? { tools } : {}),
          },
        },
      },
    },
  ]
}

/**
 * Adds resolved `useEntries` for import-safe arrays and spread entries that the
 * static pass can only describe as an unresolved array variable.
 */
function semanticInjectionUseEntryFacts(
  candidate: SemanticDefinitionCandidate,
  checker: ts.TypeChecker,
): InjectionUseFacts[] {
  const use = propertyInitializer(candidate.object, 'use')
  return use ? semanticInjectionUseEntries(toExpression(use), candidate.kind, checker) : []
}

function semanticInjectionToolFacts(
  candidate: SemanticDefinitionCandidate,
  checker: ts.TypeChecker,
): InjectionToolFacts | undefined {
  const expressions: ts.Expression[] = []
  const tools = propertyInitializer(candidate.object, 'tools')
  if (tools) expressions.push(toExpression(tools))
  if (candidate.kind === 'injectable') {
    const returned = semanticInjectableReturnObject(candidate, checker)
    const returnedTools = returned ? propertyInitializer(returned, 'tools') : undefined
    if (returnedTools) expressions.push(toExpression(returnedTools))
  }
  return mergeSemanticToolFacts(expressions.map((expression) => semanticToolFactsFromExpression(expression, checker)))
}

function semanticInjectionUseEntries(
  expression: ts.Expression,
  ownerKind: SemanticDefinitionCandidate['kind'],
  checker: ts.TypeChecker,
): InjectionUseFacts[] {
  const unwrapped = unwrapExpression(expression)
  if (ts.isArrayLiteralExpression(unwrapped)) {
    return unwrapped.elements.flatMap((element) => {
      if (ts.isSpreadElement(element)) {
        return semanticInjectionUseEntriesFromExpression(element.expression, ownerKind, checker, {
          conditionality: 'unknown',
          via: 'spread',
        })
      }
      return semanticInjectionUseEntriesFromExpression(element, ownerKind, checker, {
        conditionality: 'always',
        via: 'direct',
      })
    })
  }
  return semanticInjectionUseEntriesFromExpression(unwrapped, ownerKind, checker, {
    conditionality: 'always',
    via: 'array-ref',
  })
}

type SemanticInjectionUseContext = Required<Pick<InjectionUseFacts, 'conditionality' | 'via'>> &
  Pick<InjectionUseFacts, 'branch'>

function semanticInjectionUseEntriesFromExpression(
  expression: ts.Expression,
  ownerKind: SemanticDefinitionCandidate['kind'],
  checker: ts.TypeChecker,
  context: SemanticInjectionUseContext,
  seen = new Set<string>(),
): InjectionUseFacts[] {
  const unwrapped = unwrapExpression(expression)
  const key = `${unwrapped.getSourceFile().fileName}:${unwrapped.pos}:${unwrapped.end}`
  if (seen.has(key)) return []
  const nextSeen = new Set(seen)
  nextSeen.add(key)
  if (ts.isCallExpression(unwrapped)) {
    const helperEntries = semanticConditionalHelperUseEntries(unwrapped, ownerKind, checker, context, nextSeen)
    if (helperEntries) return helperEntries
  }
  if (ts.isBinaryExpression(unwrapped) && unwrapped.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return semanticInjectionUseEntriesFromExpression(
      unwrapped.right,
      ownerKind,
      checker,
      { conditionality: 'binary-guard', via: 'binary', branch: context.branch },
      nextSeen,
    )
  }
  const array = semanticArrayExpression(unwrapped, checker, nextSeen)
  if (array) {
    return array.elements.flatMap((element) => {
      if (ts.isSpreadElement(element)) {
        return semanticInjectionUseEntriesFromExpression(
          element.expression,
          ownerKind,
          checker,
          {
            conditionality: context.conditionality === 'always' ? 'unknown' : context.conditionality,
            via: 'spread',
            branch: context.branch,
          },
          nextSeen,
        )
      }
      return ts.isExpression(element)
        ? semanticInjectionUseEntriesFromExpression(element, ownerKind, checker, context, nextSeen)
        : []
    })
  }
  return semanticInjectionUseEntryForTarget(unwrapped, ownerKind, checker, context)
}

function semanticConditionalHelperUseEntries(
  call: ts.CallExpression,
  ownerKind: SemanticDefinitionCandidate['kind'],
  checker: ts.TypeChecker,
  context: SemanticInjectionUseContext,
  seen: Set<string>,
): InjectionUseFacts[] | undefined {
  const callName = callExpressionName(call)
  if (callName === 'when' && call.arguments[1]) {
    return semanticInjectionUseEntriesFromExpression(
      call.arguments[1],
      ownerKind,
      checker,
      { conditionality: 'when', via: 'when', branch: context.branch },
      seen,
    )
  }
  if (callName === 'match' && call.arguments[0]) {
    const object = semanticObjectExpression(call.arguments[0], checker, seen)
    return object ? semanticMatchUseEntries(object, ownerKind, checker, seen) : []
  }
  return undefined
}

function semanticMatchUseEntries(
  object: ts.ObjectLiteralExpression,
  ownerKind: SemanticDefinitionCandidate['kind'],
  checker: ts.TypeChecker,
  seen: Set<string>,
): InjectionUseFacts[] {
  const cases = semanticObjectProperty(object, 'cases', checker)
  const defaults = propertyInitializer(object, 'default')
  const caseEntries =
    cases?.properties.flatMap((property): InjectionUseFacts[] => {
      if (!ts.isPropertyAssignment(property)) return []
      const branch = semanticObjectPropertyName(property)
      return semanticInjectionUseEntriesFromExpression(
        property.initializer,
        ownerKind,
        checker,
        { conditionality: 'match-case', via: 'match', branch },
        seen,
      )
    }) ?? []
  const defaultEntries = defaults
    ? semanticInjectionUseEntriesFromExpression(
        toExpression(defaults),
        ownerKind,
        checker,
        { conditionality: 'match-default', via: 'match', branch: 'default' },
        seen,
      )
    : []
  return [...caseEntries, ...defaultEntries]
}

function semanticInjectionUseEntryForTarget(
  expression: ts.Expression,
  ownerKind: SemanticDefinitionCandidate['kind'],
  checker: ts.TypeChecker,
  context: SemanticInjectionUseContext,
): InjectionUseFacts[] {
  const target = semanticTargetForExpression(expression, checker)
  const relationType = target ? semanticInjectionUseEntryRelationType(ownerKind, target.kind) : undefined
  if (!target || !relationType) return [semanticUnresolvedUseEntry(expression, context, checker)]
  return [
    {
      variable: semanticUseEntryVariable(expression, target),
      relationHint: semanticRelationHintForTarget(target.kind),
      targetDefinitionId: target.id,
      targetKind: target.kind,
      targetName: target.id.split(':').at(-1) ?? target.id,
      relationType,
      relationFidelity: 'resolved',
      conditionality: context.conditionality,
      via: context.via,
      ...(context.branch ? { branch: context.branch } : {}),
    },
  ]
}

function semanticUnresolvedUseEntry(
  expression: ts.Expression,
  context: SemanticInjectionUseContext,
  checker: ts.TypeChecker,
): InjectionUseFacts {
  const variable = semanticExpressionVariable(expression)
  return {
    ...(variable ? { variable } : {}),
    relationHint: 'unknown',
    conditionality: isDynamicSemanticUseExpression(expression, checker)
      ? 'dynamic'
      : context.conditionality === 'always'
        ? 'unknown'
        : context.conditionality,
    via: context.via,
    ...(context.branch ? { branch: context.branch } : {}),
  }
}

function isDynamicSemanticUseExpression(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  seen = new Set<string>(),
): boolean {
  const unwrapped = unwrapExpression(expression)
  const key = `${unwrapped.getSourceFile().fileName}:${unwrapped.pos}:${unwrapped.end}`
  if (seen.has(key)) return false
  const nextSeen = new Set(seen)
  nextSeen.add(key)
  if (
    ts.isCallExpression(unwrapped) ||
    ts.isConditionalExpression(unwrapped) ||
    ts.isElementAccessExpression(unwrapped) ||
    ts.isAwaitExpression(unwrapped)
  ) {
    return true
  }
  if (!isResolvableSourceExpression(unwrapped)) return false
  const resolved = resolveSemanticExpression(unwrapped, checker)
  return resolved?.expression ? isDynamicSemanticUseExpression(resolved.expression, checker, nextSeen) : false
}

function semanticExpressionVariable(expression: ts.Expression): string | undefined {
  const unwrapped = unwrapExpression(expression)
  if (ts.isIdentifier(unwrapped)) return unwrapped.text
  if (ts.isCallExpression(unwrapped)) return callExpressionName(unwrapped) ?? unwrapped.expression.getText()
  if (ts.isPropertyAccessExpression(unwrapped)) return unwrapped.name.text
  return undefined
}

function semanticUseEntryVariable(expression: ts.Expression, target: SemanticTarget): string {
  const unwrapped = unwrapExpression(expression)
  if (ts.isIdentifier(unwrapped)) return unwrapped.text
  return target.id.split(':').at(-1) ?? target.id
}

function semanticInjectionUseEntryRelationType(
  ownerKind: SemanticDefinitionCandidate['kind'],
  targetKind: ProjectDefinitionKind,
): string | undefined {
  if (ownerKind !== 'prompt' && ownerKind !== 'context' && ownerKind !== 'injectable') return undefined
  switch (targetKind) {
    case 'context':
      return `${ownerKind}.uses_context`
    case 'injectable':
      if (ownerKind === 'injectable') return undefined
      return `${ownerKind}.uses_injectable`
    case 'memory':
      return `${ownerKind}.uses_memory`
    case 'blackboard':
      return `${ownerKind}.uses_blackboard`
    default:
      return undefined
  }
}

function semanticRelationHintForTarget(kind: ProjectDefinitionKind): InjectionUseFacts['relationHint'] {
  switch (kind) {
    case 'context':
    case 'injectable':
    case 'memory':
    case 'blackboard':
      return kind
    default:
      return 'unknown'
  }
}

function semanticToolFactsFromExpression(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  seen = new Set<string>(),
): InjectionToolFacts {
  const object = semanticObjectExpression(expression, checker, seen)
  if (!object) {
    const targets = semanticToolMapTargets(expression, checker, seen)
    if (targets.length > 0) {
      const names = targets.map((target) => target.id.split(':').at(-1) ?? target.id)
      return { hasTools: true, names, variables: names }
    }
    return { hasTools: true, dynamic: true }
  }
  const names: string[] = []
  const variables: string[] = []
  let dynamic = false
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) {
      const spreadFacts = semanticToolFactsFromExpression(property.expression, checker, seen)
      dynamic = dynamic || Boolean(spreadFacts.dynamic)
      names.push(...(spreadFacts.names ?? []))
      variables.push(...(spreadFacts.variables ?? []))
      continue
    }
    if (
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
      ts.isComputedPropertyName(property.name)
    ) {
      dynamic = true
    }
    const name = semanticObjectPropertyName(property)
    const member = objectMemberExpression(property)
    if (name) names.push(name)
    if (!member) continue
    const target = semanticTargetForExpression(member, checker)
    if (target?.kind === 'tool') {
      variables.push(target.id.split(':').at(-1) ?? target.id)
      continue
    }
    const variable = semanticExpressionVariable(member)
    if (variable) variables.push(variable)
    if (!variable && !target) dynamic = true
  }
  return {
    hasTools: true,
    ...(dynamic ? { dynamic } : {}),
    ...(names.length > 0 ? { names: [...new Set(names)] } : {}),
    ...(variables.length > 0 ? { variables: [...new Set(variables)] } : {}),
  }
}

function mergeSemanticToolFacts(facts: readonly InjectionToolFacts[]): InjectionToolFacts | undefined {
  if (facts.length === 0) return undefined
  const names = [...new Set(facts.flatMap((fact) => fact.names ?? []))]
  const variables = [...new Set(facts.flatMap((fact) => fact.variables ?? []))]
  return {
    hasTools: true,
    ...(facts.some((fact) => fact.dynamic) ? { dynamic: true } : {}),
    ...(names.length > 0 ? { names } : {}),
    ...(variables.length > 0 ? { variables } : {}),
  }
}

function semanticInjectableReturnObject(
  candidate: SemanticDefinitionCandidate,
  checker: ts.TypeChecker,
): ts.ObjectLiteralExpression | undefined {
  const inject = propertyInitializer(candidate.object, 'inject')
  return inject ? semanticReturnedObjectExpression(toExpression(inject), checker) : undefined
}

function semanticReturnedObjectExpression(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  seen = new Set<string>(),
): ts.ObjectLiteralExpression | undefined {
  const unwrapped = unwrapExpression(expression)
  if (ts.isObjectLiteralExpression(unwrapped)) return unwrapped
  if (ts.isArrowFunction(unwrapped)) return semanticReturnedObjectFromBody(unwrapped.body)
  if (ts.isFunctionExpression(unwrapped)) return semanticReturnedObjectFromBlock(unwrapped.body)
  const resolved = resolveSemanticExpression(unwrapped, checker)
  if (!resolved) return undefined
  const key = semanticResolvedKey(resolved)
  if (seen.has(key)) return undefined
  const nextSeen = new Set(seen)
  nextSeen.add(key)
  if (resolved.expression) return semanticReturnedObjectExpression(resolved.expression, checker, nextSeen)
  if (ts.isFunctionDeclaration(resolved.declaration) && resolved.declaration.body) {
    return semanticReturnedObjectFromBlock(resolved.declaration.body)
  }
  return undefined
}

function semanticReturnedObjectFromBody(body: ts.ConciseBody): ts.ObjectLiteralExpression | undefined {
  return ts.isBlock(body) ? semanticReturnedObjectFromBlock(body) : semanticReturnedObjectFromExpression(body)
}

function semanticReturnedObjectFromBlock(block: ts.Block): ts.ObjectLiteralExpression | undefined {
  for (const statement of block.statements) {
    if (!ts.isReturnStatement(statement) || !statement.expression) continue
    const returned = semanticReturnedObjectFromExpression(statement.expression)
    if (returned) return returned
  }
  return undefined
}

function semanticReturnedObjectFromExpression(expression: ts.Expression): ts.ObjectLiteralExpression | undefined {
  const unwrapped = unwrapExpression(expression)
  return ts.isObjectLiteralExpression(unwrapped) ? unwrapped : undefined
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
