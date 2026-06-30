import { safeId } from '../definitions'
import type { SemanticDefinitionCandidate } from './candidates'
import {
  semanticNodeName,
  semanticPropertyInitializer,
  semanticStringLiteralProperty,
  semanticVariableNameForNode,
} from './syntax-readers'
import {
  semanticAuthoredStorageBundleCandidate,
  semanticDiscoveryContext,
  semanticLocalObject,
  semanticStorageCandidateForCall,
  type SemanticDiscoveryContext,
} from './storage-discovery'
import type { SemanticSyntaxNode, SemanticSyntaxSourceFile, SemanticSyntaxView } from './syntax-view'
/**
 * Finds authored Crux definitions in a source file without resolving imports.
 *
 * Discovery is syntax-only: it identifies calls and `new Agent(...)`
 * expressions that can become semantic candidates, then leaves schema,
 * source-ref, and relation enrichment to focused analyzers.
 */
export function semanticDefinitionCandidates<
  TNode extends SemanticSyntaxNode,
  TSourceFile extends TNode & SemanticSyntaxSourceFile<TNode>,
>(
  sourceFile: TSourceFile,
  syntax: SemanticSyntaxView<TNode, TSourceFile>,
): SemanticDefinitionCandidate<TNode, TNode>[] {
  return semanticDefinitionCandidatesForNode(sourceFile, syntax, semanticDiscoveryContext(sourceFile, syntax))
}
/**
 * Recursively collects candidates from a node and its semantic children.
 */
function semanticDefinitionCandidatesForNode<
  TNode extends SemanticSyntaxNode,
  TSourceFile extends TNode & SemanticSyntaxSourceFile<TNode>,
>(
  node: TNode,
  syntax: SemanticSyntaxView<TNode, TSourceFile>,
  context: SemanticDiscoveryContext<TNode>,
): SemanticDefinitionCandidate<TNode, TNode>[] {
  return [
    ...semanticDefinitionCandidatesForCurrentNode(node, syntax, context),
    ...syntax.children(node).flatMap((child) => semanticDefinitionCandidatesForNode(child, syntax, context)),
  ]
}
/**
 * Converts a single syntax node into zero or more semantic candidates.
 */
function semanticDefinitionCandidatesForCurrentNode<
  TNode extends SemanticSyntaxNode,
  TSourceFile extends TNode & SemanticSyntaxSourceFile<TNode>,
>(
  node: TNode,
  syntax: SemanticSyntaxView<TNode, TSourceFile>,
  context: SemanticDiscoveryContext<TNode>,
): SemanticDefinitionCandidate<TNode, TNode>[] {
  if (syntax.isKind(node, 'callExpression')) {
    return semanticCallExpressionCandidate(node, syntax, context).map((candidate) => ({ ...candidate, call: node }))
  }
  if (syntax.isKind(node, 'newExpression') && syntax.callExpressionName(node) === 'Agent') {
    const object = syntax.newArguments(node).find((argument) => syntax.isKind(argument, 'objectLiteral'))
    return object ? [semanticAgentCandidate(object, semanticVariableNameForNode(node, syntax), syntax)] : []
  }
  if (syntax.isKind(node, 'objectLiteral')) {
    const candidate = semanticAuthoredStorageBundleCandidate(node, semanticVariableNameForNode(node, syntax), syntax)
    return candidate ? [candidate] : []
  }
  return []
}
/**
 * Converts a call expression into a candidate when it is a known Crux helper.
 */
function semanticCallExpressionCandidate<
  TNode extends SemanticSyntaxNode,
  TSourceFile extends TNode & SemanticSyntaxSourceFile<TNode>,
>(
  call: TNode,
  syntax: SemanticSyntaxView<TNode, TSourceFile>,
  context: SemanticDiscoveryContext<TNode>,
): SemanticDefinitionCandidate<TNode, TNode>[] {
  const [firstArg] = syntax.callArguments(call)
  const object =
    firstArg && syntax.isKind(firstArg, 'objectLiteral') ? firstArg : semanticLocalObject(firstArg, syntax, context)
  const callName = syntax.callExpressionName(call)
  const variableName = semanticVariableNameForNode(call, syntax)
  const fallbackCandidate = callName === 'fallback' ? semanticFallbackCandidate(call, variableName, syntax) : undefined
  const candidate = fallbackCandidate ?? semanticDefinitionCandidateForCall(callName, object ?? call, variableName, syntax)
  return candidate ? [candidate] : []
}
/**
 * Maps a known helper call to the index definition it authors.
 */
function semanticDefinitionCandidateForCall<
  TNode extends SemanticSyntaxNode,
  TSourceFile extends TNode & SemanticSyntaxSourceFile<TNode>,
>(
  callName: string | undefined,
  object: TNode,
  variableName: string | undefined,
  syntax: SemanticSyntaxView<TNode, TSourceFile>,
): SemanticDefinitionCandidate<TNode, TNode> | undefined {
  switch (callName) {
    case 'prompt': {
      const name = semanticStringLiteralProperty(object, 'id', syntax) ?? variableName ?? 'anonymous'
      return { definitionId: `prompt:${safeId(name)}`, kind: 'prompt', name, object }
    }
    case 'context': {
      const name = semanticStringLiteralProperty(object, 'id', syntax) ?? variableName ?? 'anonymous'
      return { definitionId: `context:${safeId(name)}`, kind: 'context', name, object }
    }
    case 'injectable': {
      const name = semanticStringLiteralProperty(object, 'id', syntax) ?? variableName ?? 'anonymous'
      return { definitionId: `injectable:${safeId(name)}`, kind: 'injectable', name, object }
    }
    case 'tool':
    case 'createTool': {
      const name =
        semanticStringLiteralProperty(object, 'name', syntax) ??
        semanticStringLiteralProperty(object, 'title', syntax) ??
        variableName ??
        'anonymous'
      return { definitionId: `tool:${safeId(name)}`, kind: 'tool', name, object }
    }
    case 'agent':
    case 'convexAgent':
      return semanticAgentCandidate(object, variableName, syntax)
    case 'flow':
    case 'cruxFlow': {
      const name = semanticStringLiteralProperty(object, 'name', syntax) ?? variableName ?? 'anonymous'
      return { definitionId: `flow:${safeId(name)}`, kind: 'flow', name, object }
    }
    case 'parallel':
      return compositionCandidate('composition.parallel', object, variableName)
    case 'pipeline':
      return compositionCandidate('composition.pipeline', object, variableName)
    case 'swarm':
      return compositionCandidate('composition.swarm', object, variableName)
    case 'consensus':
      return compositionCandidate('composition.consensus', object, variableName)
    case 'router': {
      const name = semanticStringLiteralProperty(object, 'id', syntax) ?? variableName ?? 'anonymous'
      return { definitionId: `routing.router:${safeId(name)}`, kind: 'routing.router', name, object }
    }
    case 'cascade': {
      const name = semanticStringLiteralProperty(object, 'id', syntax) ?? variableName ?? 'anonymous'
      return { definitionId: `routing.cascade:${safeId(name)}`, kind: 'routing.cascade', name, object }
    }
    case 'constraint': {
      const name = semanticStringLiteralProperty(object, 'name', syntax) ?? variableName ?? 'anonymous'
      return { definitionId: `constraint:${safeId(name)}`, kind: 'constraint', name, object }
    }
    case 'guardrail': {
      const name = semanticStringLiteralProperty(object, 'name', syntax) ?? variableName ?? 'anonymous'
      return { definitionId: `guardrail:${safeId(name)}`, kind: 'guardrail', name, object }
    }
    case 'memory': {
      const name = semanticAuthoredResourceName(object, variableName, syntax)
      return { definitionId: `memory:${safeId(name)}`, kind: 'memory', name, object }
    }
    case 'blackboard': {
      const name = semanticAuthoredResourceName(object, variableName, syntax)
      return { definitionId: `blackboard:${safeId(name)}`, kind: 'blackboard', name, object }
    }
    case 'workspace': {
      const name = semanticStringLiteralProperty(object, 'id', syntax) ?? variableName ?? 'anonymous'
      return { definitionId: `workspace:${safeId(name)}`, kind: 'workspace', name, object }
    }
    case 'retriever': {
      const name = semanticStringLiteralProperty(object, 'id', syntax) ?? variableName ?? 'anonymous'
      return { definitionId: `rag.retriever:${safeId(name)}`, kind: 'rag.retriever', name, object }
    }
    default:
      return semanticStorageCandidateForCall(callName, object, variableName, syntax)
  }
}
function compositionCandidate<TNode extends SemanticSyntaxNode>(
  kind:
    | 'composition.parallel'
    | 'composition.pipeline'
    | 'composition.swarm'
    | 'composition.consensus',
  object: TNode,
  variableName: string | undefined,
): SemanticDefinitionCandidate<TNode, TNode> {
  const name = variableName ?? 'anonymous'
  return { definitionId: `${kind}:${safeId(name)}`, kind, name, object }
}
/**
 * Builds the authored definition candidate for `fallback(...)`.
 */
function semanticFallbackCandidate<
  TNode extends SemanticSyntaxNode,
  TSourceFile extends TNode & SemanticSyntaxSourceFile<TNode>,
>(
  call: TNode,
  variableName: string | undefined,
  syntax: SemanticSyntaxView<TNode, TSourceFile>,
): SemanticDefinitionCandidate<TNode, TNode> | undefined {
  const options = semanticFallbackOptions(call, syntax)
  if (!options) return undefined
  const name = semanticStringLiteralProperty(options, 'id', syntax) ?? variableName ?? 'anonymous'
  return {
    definitionId: `routing.fallback:${safeId(name)}`,
    kind: 'routing.fallback',
    name,
    object: options,
    call,
  }
}

/**
 * Resolves the stable index name for memory-like authored resources.
 */
function semanticAuthoredResourceName<
  TNode extends SemanticSyntaxNode,
  TSourceFile extends TNode & SemanticSyntaxSourceFile<TNode>,
>(
  object: TNode,
  variableName: string | undefined,
  syntax: SemanticSyntaxView<TNode, TSourceFile>,
): string {
  const id = semanticPropertyInitializer(object, 'id', syntax)
  if (!id) return variableName ?? 'anonymous'
  const expression = syntax.unwrapExpression(id)
  const literal = syntax.stringLiteralText(expression)
  if (literal !== undefined) return literal
  const prefix = semanticCreateMemoryIdPrefix(expression, syntax)
  if (prefix) return prefix.endsWith(':') ? prefix.slice(0, -1) : prefix
  return semanticNodeName(expression, syntax) ?? variableName ?? 'anonymous'
}

/**
 * Extracts the index-id prefix encoded by `createMemoryId(...)` calls.
 */
function semanticCreateMemoryIdPrefix<
  TNode extends SemanticSyntaxNode,
  TSourceFile extends TNode & SemanticSyntaxSourceFile<TNode>,
>(
  expression: TNode,
  syntax: SemanticSyntaxView<TNode, TSourceFile>,
): string | undefined {
  if (!syntax.isKind(expression, 'callExpression') || syntax.callExpressionName(expression) !== 'createMemoryId') {
    return undefined
  }
  const [typeArg] = syntax.callArguments(expression)
  const type = typeArg ? syntax.stringLiteralText(typeArg) : undefined
  switch (type) {
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
function semanticAgentCandidate<
  TNode extends SemanticSyntaxNode,
  TSourceFile extends TNode & SemanticSyntaxSourceFile<TNode>,
>(
  object: TNode,
  variableName: string | undefined,
  syntax: SemanticSyntaxView<TNode, TSourceFile>,
): SemanticDefinitionCandidate<TNode, TNode> {
  const name =
    semanticStringLiteralProperty(object, 'id', syntax) ??
    semanticStringLiteralProperty(object, 'name', syntax) ??
    variableName ??
    'anonymous'
  return { definitionId: `agent:${safeId(name)}`, kind: 'agent', name, object }
}

function semanticFallbackOptions<
  TNode extends SemanticSyntaxNode,
  TSourceFile extends TNode & SemanticSyntaxSourceFile<TNode>,
>(call: TNode, syntax: SemanticSyntaxView<TNode, TSourceFile>): TNode | undefined {
  const last = syntax.callArguments(call).at(-1)
  if (!last || !syntax.isKind(last, 'objectLiteral')) return undefined
  const hasOptionsShape = Boolean(
    semanticStringLiteralProperty(last, 'id', syntax) ||
      semanticStringLiteralProperty(last, 'description', syntax) ||
      semanticPropertyInitializer(last, 'timeout', syntax) ||
      semanticPropertyInitializer(last, 'timeoutMs', syntax) ||
      semanticPropertyInitializer(last, 'on', syntax) ||
      semanticPropertyInitializer(last, 'shouldFallback', syntax) ||
      semanticPropertyInitializer(last, 'onAttemptError', syntax),
  )
  return hasOptionsShape ? last : undefined
}
