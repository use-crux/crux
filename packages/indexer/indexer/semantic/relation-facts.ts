import ts from 'typescript'
import type { ProjectRelation } from '@crux/core/project-index'
import { stringProperty } from '../ast/literals'
import { safeId } from '../definitions'
import { semanticCallbackAccessRelations, semanticFlowAccessRelations } from './access-relations'
import type { SemanticDefinitionCandidate } from './candidates'
import {
  arrayProperty,
  arrayPropertyExpressions,
  branchRelationType,
  compositionRelationType,
  flowStepRelationType,
  isRoutingTargetKind,
  objectMemberExpression,
  objectProperty,
  propertyExpressions,
  propertyInitializer,
  resolveSemanticExpression,
  routingTargetRelationType,
  semanticArrayExpression,
  semanticArrayProperty,
  semanticFallbackOptions,
  semanticObjectProperty,
  semanticObjectPropertyName,
  semanticRelation,
  semanticTargetForExpression,
  semanticToolMapTargets,
  toExpression,
  unwrapExpression,
} from './model'

/**
 * Computes resolved semantic relations for one discovered definition.
 *
 * The function is a pure dispatcher over candidate kind: it reads compiler
 * symbols through the provided type checker and returns fresh relation values,
 * leaving AST nodes and candidate objects untouched.
 */
export function semanticRelationsForCandidate(
  candidate: SemanticDefinitionCandidate,
  checker: ts.TypeChecker,
): ProjectRelation[] {
  const accessRelations = semanticCallbackAccessRelations(candidate, checker)
  switch (candidate.kind) {
    case 'prompt':
    case 'context':
    case 'injectable':
      return [
        ...semanticInjectionUseRelations(candidate, checker),
        ...semanticInjectionToolRelations(candidate, checker),
        ...accessRelations,
      ]
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

/**
 * Resolves static and import-safe `use` arrays into injection relations.
 */
function semanticInjectionUseRelations(
  candidate: SemanticDefinitionCandidate,
  checker: ts.TypeChecker,
): ProjectRelation[] {
  const use = propertyInitializer(candidate.object, 'use')
  if (!use) return []
  const expressions = semanticUseExpressions(toExpression(use), checker)
  const relations: ProjectRelation[] = []
  expressions.forEach((expression, index) => {
    const target = semanticTargetForExpression(expression, checker)
    const type = target ? semanticInjectionUseRelationType(candidate.kind, target.kind) : undefined
    if (!target || !type) return
    relations.push(semanticRelation(candidate, type, `${candidate.definitionId}:use:${index + 1}`, target.id))
  })
  return relations
}

/**
 * Reads elements from a use expression, following import-safe array constants
 * and spread entries without executing code.
 */
function semanticUseExpressions(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  seen = new Set<string>(),
): ts.Expression[] {
  const key = `${expression.getSourceFile().fileName}:${expression.pos}:${expression.end}`
  if (seen.has(key)) return []
  const nextSeen = new Set(seen)
  nextSeen.add(key)
  const array = semanticArrayExpression(expression, checker, nextSeen)
  if (!array) return [expression]
  const expressions: ts.Expression[] = []
  for (const element of array.elements) {
    if (ts.isSpreadElement(element)) {
      expressions.push(...semanticUseExpressions(element.expression, checker, nextSeen))
      continue
    }
    if (ts.isExpression(element)) expressions.push(element)
  }
  return expressions
}

/**
 * Maps prompt/context/injectable use targets to Project Index relation names.
 */
function semanticInjectionUseRelationType(
  ownerKind: SemanticDefinitionCandidate['kind'],
  targetKind: string,
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

/**
 * Resolves import-safe tool maps on prompt/context configs and simple injectable
 * return objects into tool relations.
 */
function semanticInjectionToolRelations(
  candidate: SemanticDefinitionCandidate,
  checker: ts.TypeChecker,
): ProjectRelation[] {
  const expressions: ts.Expression[] = []
  const tools = propertyInitializer(candidate.object, 'tools')
  if (tools) expressions.push(toExpression(tools))
  if (candidate.kind === 'injectable') {
    const returned = semanticInjectableReturnObject(candidate, checker)
    const returnedTools = returned ? propertyInitializer(returned, 'tools') : undefined
    if (returnedTools) expressions.push(toExpression(returnedTools))
  }
  const type = `${candidate.kind}.uses_tool`
  const relations: ProjectRelation[] = []
  const seenTargets = new Set<string>()
  for (const expression of expressions) {
    for (const target of semanticToolMapTargets(expression, checker)) {
      const key = `${type}:${target.id}`
      if (seenTargets.has(key)) continue
      seenTargets.add(key)
      relations.push(semanticRelation(candidate, type, candidate.definitionId, target.id))
    }
  }
  return relations
}

/**
 * Reads a simple object returned by an injectable `inject` callback without
 * executing the callback.
 */
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
  const key = `${resolved.sourceFile.fileName}:${resolved.declaration.pos}:${resolved.declaration.end}:${resolved.symbol}`
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
 * Resolves router route entries into route-child target relations.
 */
function semanticRouterRelations(candidate: SemanticDefinitionCandidate, checker: ts.TypeChecker): ProjectRelation[] {
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

/**
 * Resolves cascade tier models into tier-child target relations.
 */
function semanticCascadeRelations(candidate: SemanticDefinitionCandidate, checker: ts.TypeChecker): ProjectRelation[] {
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

/**
 * Resolves fallback positional model arguments into option-child target relations.
 */
function semanticFallbackRelations(candidate: SemanticDefinitionCandidate, checker: ts.TypeChecker): ProjectRelation[] {
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

/**
 * Resolves agent dependencies declared through prompt, model/languageModel, and
 * tools config properties.
 */
function semanticAgentRelations(candidate: SemanticDefinitionCandidate, checker: ts.TypeChecker): ProjectRelation[] {
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

/**
 * Resolves `flow.step(label, target)` calls inside a flow handler.
 */
function semanticFlowRelations(candidate: SemanticDefinitionCandidate, checker: ts.TypeChecker): ProjectRelation[] {
  const handler = propertyInitializer(candidate.object, 'handler')
  if (!handler) return []
  const relations: ProjectRelation[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'step'
    ) {
      const [stepArg, targetArg] = node.arguments
      if (stepArg && ts.isStringLiteralLike(stepArg) && targetArg) {
        const target = semanticTargetForExpression(targetArg, checker)
        const type = target ? flowStepRelationType(target.kind) : undefined
        if (target && type) {
          relations.push(
            semanticRelation(candidate, type, `flow.step:${safeId(candidate.name)}:${safeId(stepArg.text)}`, target.id),
          )
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(handler)
  return relations
}

/**
 * Dispatches relation extraction for the supported composition families.
 */
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

/**
 * Resolves parallel composition branches and their aggregate target relations.
 */
function semanticParallelRelations(candidate: SemanticDefinitionCandidate, checker: ts.TypeChecker): ProjectRelation[] {
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
        semanticRelation(candidate, branchType, `${candidate.definitionId}:branch:${safeId(branchId)}`, target.id),
      )
    }
  }
  return relations
}

/**
 * Resolves pipeline stages and their aggregate target relations.
 */
function semanticPipelineRelations(candidate: SemanticDefinitionCandidate, checker: ts.TypeChecker): ProjectRelation[] {
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
      if (compositionType)
        relations.push(semanticRelation(candidate, compositionType, candidate.definitionId, target.id))
      if (stageType) {
        relations.push(
          semanticRelation(candidate, stageType, `${candidate.definitionId}:stage:${safeId(stageName)}`, target.id),
        )
      }
    }
  })
  return relations
}

/**
 * Resolves consensus participants plus judge and scorer dependencies.
 */
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

/**
 * Resolves swarm participants plus coordinator state-resource dependencies.
 */
function semanticSwarmRelations(candidate: SemanticDefinitionCandidate, checker: ts.TypeChecker): ProjectRelation[] {
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
  for (const expression of propertyInitializer(candidate.object, 'memory')
    ? propertyExpressions(candidate.object, 'memory')
    : []) {
    const target = semanticTargetForExpression(expression, checker)
    if (target?.kind === 'memory')
      relations.push(semanticRelation(candidate, 'swarm.uses_memory', candidate.definitionId, target.id))
  }
  return relations
}

/**
 * Resolves constraint/guardrail target declarations into safety relations.
 */
function semanticSafetyRelations(candidate: SemanticDefinitionCandidate, checker: ts.TypeChecker): ProjectRelation[] {
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
