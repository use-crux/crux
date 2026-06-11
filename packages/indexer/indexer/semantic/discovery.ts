import ts from 'typescript'
import type { SemanticDefinitionCandidate } from './candidates'

export interface SemanticDefinitionDiscoveryDeps {
  readonly callExpressionName: (node: ts.CallExpression | ts.NewExpression) => string | undefined
  readonly fallbackOptions: (call: ts.CallExpression) => ts.ObjectLiteralExpression | undefined
  readonly propertyInitializer: (object: ts.ObjectLiteralExpression, name: string) => ts.Expression | undefined
  readonly safeId: (value: string) => string
  readonly stringProperty: (object: ts.ObjectLiteralExpression, name: string) => string | undefined
  readonly unwrapExpression: (expression: ts.Expression) => ts.Expression
  readonly variableNameForNode: (node: ts.Node) => string | undefined
}

/**
 * Finds authored Crux definitions in a source file without resolving imports.
 *
 * Discovery is deliberately syntax-only: it identifies calls/new expressions
 * that can become semantic candidates, then leaves schema/source/ref/relation
 * enrichment to focused analyzers.
 */
export function semanticDefinitionCandidates(
  sourceFile: ts.SourceFile,
  deps: SemanticDefinitionDiscoveryDeps,
): SemanticDefinitionCandidate[] {
  return semanticDefinitionCandidatesForNode(sourceFile, sourceFile, deps)
}

/**
 * Recursively collects candidates from a node and its children.
 */
function semanticDefinitionCandidatesForNode(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  deps: SemanticDefinitionDiscoveryDeps,
): SemanticDefinitionCandidate[] {
  return [
    ...semanticDefinitionCandidatesForCurrentNode(node, deps),
    ...node.getChildren(sourceFile).flatMap((child) => semanticDefinitionCandidatesForNode(child, sourceFile, deps)),
  ]
}

/**
 * Converts a single AST node into zero or more semantic candidates.
 */
function semanticDefinitionCandidatesForCurrentNode(
  node: ts.Node,
  deps: SemanticDefinitionDiscoveryDeps,
): SemanticDefinitionCandidate[] {
  if (ts.isCallExpression(node)) {
    return semanticCallExpressionCandidate(node, deps).map((candidate) => ({ ...candidate, call: node }))
  }
  if (ts.isNewExpression(node) && deps.callExpressionName(node) === 'Agent') {
    const object = node.arguments?.find((argument): argument is ts.ObjectLiteralExpression =>
      ts.isObjectLiteralExpression(argument),
    )
    return object ? [semanticAgentCandidate(object, deps.variableNameForNode(node), deps)] : []
  }
  return []
}

/**
 * Converts a call expression into a candidate when it is a known Crux authoring helper.
 */
function semanticCallExpressionCandidate(
  call: ts.CallExpression,
  deps: SemanticDefinitionDiscoveryDeps,
): SemanticDefinitionCandidate[] {
  const firstArg = call.arguments[0]
  const object = firstArg && ts.isObjectLiteralExpression(firstArg) ? firstArg : undefined
  const callName = deps.callExpressionName(call)
  const variableName = deps.variableNameForNode(call)
  const fallbackCandidate = callName === 'fallback' ? semanticFallbackCandidate(call, variableName, deps) : undefined
  const candidate =
    fallbackCandidate ?? (object ? semanticDefinitionCandidateForCall(callName, object, variableName, deps) : undefined)
  return candidate ? [candidate] : []
}

/**
 * Maps a known helper call to the index definition it authors.
 */
function semanticDefinitionCandidateForCall(
  callName: string | undefined,
  object: ts.ObjectLiteralExpression,
  variableName: string | undefined,
  deps: SemanticDefinitionDiscoveryDeps,
): SemanticDefinitionCandidate | undefined {
  switch (callName) {
    case 'prompt': {
      const name = deps.stringProperty(object, 'id') ?? variableName ?? 'anonymous'
      return { definitionId: `prompt:${deps.safeId(name)}`, kind: 'prompt', name, object }
    }
    case 'context': {
      const name = deps.stringProperty(object, 'id') ?? variableName ?? 'anonymous'
      return { definitionId: `context:${deps.safeId(name)}`, kind: 'context', name, object }
    }
    case 'injectable': {
      const name = deps.stringProperty(object, 'id') ?? variableName ?? 'anonymous'
      return { definitionId: `injectable:${deps.safeId(name)}`, kind: 'injectable', name, object }
    }
    case 'tool':
    case 'createTool': {
      const name =
        deps.stringProperty(object, 'name') ?? deps.stringProperty(object, 'title') ?? variableName ?? 'anonymous'
      return { definitionId: `tool:${deps.safeId(name)}`, kind: 'tool', name, object }
    }
    case 'agent':
    case 'convexAgent':
      return semanticAgentCandidate(object, variableName, deps)
    case 'flow':
    case 'cruxFlow': {
      const name = deps.stringProperty(object, 'name') ?? variableName ?? 'anonymous'
      return { definitionId: `flow:${deps.safeId(name)}`, kind: 'flow', name, object }
    }
    case 'parallel':
      return {
        definitionId: `composition.parallel:${deps.safeId(variableName ?? 'anonymous')}`,
        kind: 'composition.parallel',
        name: variableName ?? 'anonymous',
        object,
      }
    case 'pipeline':
      return {
        definitionId: `composition.pipeline:${deps.safeId(variableName ?? 'anonymous')}`,
        kind: 'composition.pipeline',
        name: variableName ?? 'anonymous',
        object,
      }
    case 'swarm':
      return {
        definitionId: `composition.swarm:${deps.safeId(variableName ?? 'anonymous')}`,
        kind: 'composition.swarm',
        name: variableName ?? 'anonymous',
        object,
      }
    case 'consensus':
      return {
        definitionId: `composition.consensus:${deps.safeId(variableName ?? 'anonymous')}`,
        kind: 'composition.consensus',
        name: variableName ?? 'anonymous',
        object,
      }
    case 'router': {
      const name = deps.stringProperty(object, 'id') ?? variableName ?? 'anonymous'
      return { definitionId: `routing.router:${deps.safeId(name)}`, kind: 'routing.router', name, object }
    }
    case 'cascade': {
      const name = deps.stringProperty(object, 'id') ?? variableName ?? 'anonymous'
      return { definitionId: `routing.cascade:${deps.safeId(name)}`, kind: 'routing.cascade', name, object }
    }
    case 'constraint': {
      const name = deps.stringProperty(object, 'name') ?? variableName ?? 'anonymous'
      return { definitionId: `constraint:${deps.safeId(name)}`, kind: 'constraint', name, object }
    }
    case 'guardrail': {
      const name = deps.stringProperty(object, 'name') ?? variableName ?? 'anonymous'
      return { definitionId: `guardrail:${deps.safeId(name)}`, kind: 'guardrail', name, object }
    }
    case 'memory': {
      const name = semanticAuthoredResourceName(object, variableName, deps)
      return { definitionId: `memory:${deps.safeId(name)}`, kind: 'memory', name, object }
    }
    case 'blackboard': {
      const name = semanticAuthoredResourceName(object, variableName, deps)
      return { definitionId: `blackboard:${deps.safeId(name)}`, kind: 'blackboard', name, object }
    }
    case 'workspace': {
      const name = deps.stringProperty(object, 'id') ?? variableName ?? 'anonymous'
      return { definitionId: `workspace:${deps.safeId(name)}`, kind: 'workspace', name, object }
    }
    default:
      return undefined
  }
}

/**
 * Builds the authored definition candidate for `fallback(...)`, whose options
 * object is not necessarily the first positional argument.
 */
function semanticFallbackCandidate(
  call: ts.CallExpression,
  variableName: string | undefined,
  deps: SemanticDefinitionDiscoveryDeps,
): SemanticDefinitionCandidate | undefined {
  const options = deps.fallbackOptions(call)
  if (!options) return undefined
  const name = deps.stringProperty(options, 'id') ?? variableName ?? 'anonymous'
  return {
    definitionId: `routing.fallback:${deps.safeId(name)}`,
    kind: 'routing.fallback',
    name,
    object: options,
    call,
  }
}

/**
 * Resolves the stable index name for memory-like authored resources.
 */
function semanticAuthoredResourceName(
  object: ts.ObjectLiteralExpression,
  variableName: string | undefined,
  deps: SemanticDefinitionDiscoveryDeps,
): string {
  const id = deps.propertyInitializer(object, 'id')
  if (!id) return variableName ?? 'anonymous'
  const expression = deps.unwrapExpression(id)
  if (ts.isStringLiteralLike(expression)) return expression.text
  const prefix = semanticCreateMemoryIdPrefix(expression, deps)
  if (prefix) return prefix.endsWith(':') ? prefix.slice(0, -1) : prefix
  if (ts.isIdentifier(expression)) return expression.text
  return variableName ?? 'anonymous'
}

/**
 * Extracts the index-id prefix encoded by `createMemoryId(...)` calls.
 */
function semanticCreateMemoryIdPrefix(
  expression: ts.Expression,
  deps: SemanticDefinitionDiscoveryDeps,
): string | undefined {
  if (!ts.isCallExpression(expression) || deps.callExpressionName(expression) !== 'createMemoryId') return undefined
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

/**
 * Builds the authored definition candidate for Agent object instantiation.
 */
function semanticAgentCandidate(
  object: ts.ObjectLiteralExpression,
  variableName: string | undefined,
  deps: SemanticDefinitionDiscoveryDeps,
): SemanticDefinitionCandidate {
  const name = deps.stringProperty(object, 'id') ?? deps.stringProperty(object, 'name') ?? variableName ?? 'anonymous'
  return { definitionId: `agent:${deps.safeId(name)}`, kind: 'agent', name, object }
}
