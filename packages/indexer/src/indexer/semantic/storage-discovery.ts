import { safeId } from '../definitions'
import type { SemanticDefinitionCandidate } from './candidates'
import { semanticNodeName, semanticPropertyName } from './syntax-readers'
import {
  hasSemanticStorageBundleFields,
  semanticStorageFactoryDescriptor,
  type SemanticStorageDefinitionKind,
} from './storage-model'
import type { SemanticSyntaxNode, SemanticSyntaxSourceFile, SemanticSyntaxView } from './syntax-view'

export interface SemanticDiscoveryContext<TNode extends SemanticSyntaxNode> {
  readonly initializers: ReadonlyMap<string, TNode>
}

/** Builds the lightweight syntax context used during semantic discovery. */
export function semanticDiscoveryContext<
  TNode extends SemanticSyntaxNode,
  TSourceFile extends TNode & SemanticSyntaxSourceFile<TNode>,
>(
  sourceFile: TSourceFile,
  syntax: SemanticSyntaxView<TNode, TSourceFile>,
): SemanticDiscoveryContext<TNode> {
  return { initializers: semanticTopLevelInitializers(sourceFile, syntax) }
}

/** Resolves a same-file identifier to an object literal initializer. */
export function semanticLocalObject<
  TNode extends SemanticSyntaxNode,
  TSourceFile extends TNode & SemanticSyntaxSourceFile<TNode>,
>(
  expression: TNode | undefined,
  syntax: SemanticSyntaxView<TNode, TSourceFile>,
  context: SemanticDiscoveryContext<TNode>,
): TNode | undefined {
  const name = expression ? syntax.identifierText(syntax.unwrapExpression(expression)) : undefined
  const initializer = name ? context.initializers.get(name) : undefined
  return initializer && syntax.isKind(initializer, 'objectLiteral') ? initializer : undefined
}

/** Creates a storage candidate for a known Storage Beta factory call. */
export function semanticStorageCandidateForCall<
  TNode extends SemanticSyntaxNode,
  TSourceFile extends TNode & SemanticSyntaxSourceFile<TNode>,
>(
  callName: string | undefined,
  object: TNode,
  variableName: string | undefined,
  syntax: SemanticSyntaxView<TNode, TSourceFile>,
): SemanticDefinitionCandidate<TNode, TNode> | undefined {
  const descriptor = semanticStorageFactoryDescriptor(callName)
  if (!descriptor || !variableName) return undefined
  if (callName === 'storage' && !hasSemanticStorageObject(object, syntax)) return undefined
  return semanticStorageCandidate(descriptor.kind, variableName, object)
}

/** Creates a storage-bundle candidate for authored object-literal bundles. */
export function semanticAuthoredStorageBundleCandidate<
  TNode extends SemanticSyntaxNode,
  TSourceFile extends TNode & SemanticSyntaxSourceFile<TNode>,
>(
  object: TNode,
  variableName: string | undefined,
  syntax: SemanticSyntaxView<TNode, TSourceFile>,
): SemanticDefinitionCandidate<TNode, TNode> | undefined {
  return variableName?.toLowerCase().includes('storage') && hasSemanticStorageObject(object, syntax)
    ? semanticStorageCandidate('storage.bundle', variableName, object)
    : undefined
}

function semanticStorageCandidate<TNode extends SemanticSyntaxNode>(
  kind: SemanticStorageDefinitionKind,
  variableName: string,
  object: TNode,
): SemanticDefinitionCandidate<TNode, TNode> {
  return {
    definitionId: `${kind}:${safeId(variableName)}`,
    kind,
    name: variableName,
    object,
  }
}

function semanticTopLevelInitializers<
  TNode extends SemanticSyntaxNode,
  TSourceFile extends TNode & SemanticSyntaxSourceFile<TNode>,
>(
  sourceFile: TSourceFile,
  syntax: SemanticSyntaxView<TNode, TSourceFile>,
): ReadonlyMap<string, TNode> {
  const initializers = new Map<string, TNode>()
  for (const child of syntax.children(sourceFile)) {
    if (!syntax.isKind(child, 'variableStatement')) continue
    for (const declaration of syntax.variableStatementDeclarations(child)) {
      const name = syntax.variableDeclarationName(declaration)
      const initializer = syntax.variableDeclarationInitializer(declaration)
      const identifier = name ? semanticNodeName(name, syntax) : undefined
      if (identifier && initializer) initializers.set(identifier, initializer)
    }
  }
  return initializers
}

function hasSemanticStorageObject<
  TNode extends SemanticSyntaxNode,
  TSourceFile extends TNode & SemanticSyntaxSourceFile<TNode>,
>(object: TNode, syntax: SemanticSyntaxView<TNode, TSourceFile>): boolean {
  const fields = new Set(
    syntax.objectProperties(object).flatMap((property) => {
      const name = semanticPropertyName(property, syntax)
      return name ? [name] : []
    }),
  )
  return hasSemanticStorageBundleFields(fields)
}
