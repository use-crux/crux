import { describe, expect, it } from 'vitest'
import { semanticDefinitionCandidates } from '../src/indexer/semantic/discovery'
import type {
  SemanticSyntaxKind,
  SemanticSyntaxNode,
  SemanticSyntaxSourceFile,
  SemanticSyntaxView,
} from '../src/indexer/semantic/syntax-view'

type FakeSyntaxKind = SemanticSyntaxKind | 'fake'

interface FakeNode extends SemanticSyntaxNode {
  readonly kind: FakeSyntaxKind
  readonly text?: string
  readonly children?: readonly FakeNode[]
  readonly arguments?: readonly FakeNode[]
  readonly properties?: readonly FakeNode[]
  readonly name?: FakeNode
  readonly initializer?: FakeNode
  readonly parent?: FakeNode
  readonly sourceFile?: FakeSourceFile
}

interface FakeSourceFile extends FakeNode, SemanticSyntaxSourceFile<FakeNode> {
  readonly kind: 'sourceFile'
  readonly fileName: '/virtual/semantic.ts'
  readonly text: string
}

describe('semantic analyzer syntax contract', () => {
  it('discovers authored definitions through a backend-neutral syntax view', () => {
    const sourceFile = fakeSourceFile()
    const idName = node({ kind: 'identifier', text: 'id', parent: sourceFile })
    const idValue = node({ kind: 'stringLiteral', text: 'support', parent: sourceFile })
    const idProperty = node({
      kind: 'propertyAssignment',
      name: idName,
      initializer: idValue,
      parent: sourceFile,
    })
    const object = node({ kind: 'objectLiteral', properties: [idProperty], parent: sourceFile })
    const call = node({ kind: 'callExpression', text: 'prompt', arguments: [object], parent: sourceFile })
    link(sourceFile, { children: [call] })

    const candidates = semanticDefinitionCandidates(sourceFile, fakeSyntaxView)

    expect(candidates).toEqual([
      expect.objectContaining({
        definitionId: 'prompt:support',
        kind: 'prompt',
        name: 'support',
        object,
        call,
      }),
    ])
  })

  it('discovers retrieval beta definitions through semantic candidates', () => {
    const sourceFile = fakeSourceFile()
    const knowledgeBaseObject = objectWithStringId(sourceFile, 'docs')
    const recipeObject = objectWithStringId(sourceFile, 'docs-answer')
    const retrieverObject = objectWithStringId(sourceFile, 'docs-retriever')
    const knowledgeBaseCall = node({
      kind: 'callExpression',
      text: 'knowledgeBase',
      arguments: [knowledgeBaseObject],
      parent: sourceFile,
    })
    const recipeCall = node({
      kind: 'callExpression',
      text: 'retrievalRecipe',
      arguments: [recipeObject],
      parent: sourceFile,
    })
    const retrieverCall = node({
      kind: 'callExpression',
      text: 'retriever',
      arguments: [retrieverObject],
      parent: sourceFile,
    })
    link(sourceFile, { children: [knowledgeBaseCall, recipeCall, retrieverCall] })

    const candidates = semanticDefinitionCandidates(sourceFile, fakeSyntaxView)

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ definitionId: 'rag.knowledgeBase:docs', kind: 'rag.knowledgeBase' }),
        expect.objectContaining({ definitionId: 'rag.recipe:docs-answer', kind: 'rag.recipe' }),
        expect.objectContaining({ definitionId: 'rag.retriever:docs-retriever', kind: 'rag.retriever' }),
      ]),
    )
  })
})

const fakeSyntaxView: SemanticSyntaxView<FakeNode, FakeSourceFile> = {
  sourceFiles() {
    return []
  },
  sourceFile(node) {
    return isFakeSourceFile(node) ? node : node.sourceFile ?? fakeSourceFile()
  },
  parent(node) {
    return node.parent
  },
  children(node) {
    return node.children ?? []
  },
  text(node) {
    return node.text ?? ''
  },
  kind(node) {
    return isSemanticKind(node.kind) ? node.kind : 'unknown'
  },
  isKind<TKind extends SemanticSyntaxKind>(node: FakeNode, kind: TKind): node is FakeNode & SemanticSyntaxNode<TKind> {
    return fakeSyntaxView.kind(node) === kind
  },
  callArguments(node) {
    return fakeSyntaxView.kind(node) === 'callExpression' ? (node.arguments ?? []) : []
  },
  callExpressionTarget() {
    return undefined
  },
  newArguments(node) {
    return fakeSyntaxView.kind(node) === 'newExpression' ? (node.arguments ?? []) : []
  },
  callExpressionName(node) {
    return fakeSyntaxView.kind(node) === 'callExpression' || fakeSyntaxView.kind(node) === 'newExpression'
      ? node.text
      : undefined
  },
  propertyAccessName() {
    return undefined
  },
  propertyAccessNameNode() {
    return undefined
  },
  propertyAccessExpression() {
    return undefined
  },
  objectProperties(node) {
    return fakeSyntaxView.kind(node) === 'objectLiteral' ? (node.properties ?? []) : []
  },
  propertyName(node) {
    return node.name
  },
  propertyInitializer(node) {
    return node.initializer
  },
  arrayElements() {
    return []
  },
  spreadExpression() {
    return undefined
  },
  logicalAndOperands() {
    return undefined
  },
  templateExpressions() {
    return []
  },
  functionReturnExpressions() {
    return []
  },
  literalValue(node) {
    return node.text
  },
  identifierText(node) {
    return fakeSyntaxView.kind(node) === 'identifier' ? node.text : undefined
  },
  stringLiteralText(node) {
    return fakeSyntaxView.kind(node) === 'stringLiteral' ? node.text : undefined
  },
  numericLiteralText() {
    return undefined
  },
  unwrapExpression(node) {
    return node
  },
  variableDeclarationName() {
    return undefined
  },
  variableDeclarationInitializer() {
    return undefined
  },
  variableStatementDeclarations() {
    return []
  },
  importModuleSpecifier() {
    return undefined
  },
  namedImportSpecifiers() {
    return []
  },
  namespaceImportName() {
    return undefined
  },
  exportSpecifiers() {
    return []
  },
  declarationName() {
    return undefined
  },
  hasExportModifier() {
    return false
  },
  isFunctionLike() {
    return false
  },
}

function fakeSourceFile(): FakeSourceFile {
  return {
    kind: 'sourceFile',
    fileName: '/virtual/semantic.ts',
    text: '',
    pos: 0,
    end: 0,
  }
}

function node(input: Omit<FakeNode, 'pos' | 'end'> & Partial<Pick<FakeNode, 'pos' | 'end'>>): FakeNode {
  return {
    pos: 0,
    end: 0,
    sourceFile: input.parent && isFakeSourceFile(input.parent) ? input.parent : input.parent?.sourceFile,
    ...input,
  }
}

function objectWithStringId(parent: FakeNode, id: string): FakeNode {
  const idName = node({ kind: 'identifier', text: 'id', parent })
  const idValue = node({ kind: 'stringLiteral', text: id, parent })
  const idProperty = node({
    kind: 'propertyAssignment',
    name: idName,
    initializer: idValue,
    parent,
  })
  return node({ kind: 'objectLiteral', properties: [idProperty], parent })
}

function link(target: FakeSourceFile, updates: Partial<FakeSourceFile>): void {
  Object.assign(target, updates)
  for (const child of target.children ?? []) assignSourceFile(child, target)
}

function assignSourceFile(target: FakeNode, sourceFile: FakeSourceFile): void {
  Object.assign(target, { sourceFile })
  for (const child of [...(target.children ?? []), ...(target.arguments ?? []), ...(target.properties ?? [])]) {
    assignSourceFile(child, sourceFile)
  }
  if (target.name) assignSourceFile(target.name, sourceFile)
  if (target.initializer) assignSourceFile(target.initializer, sourceFile)
}

function isSemanticKind(kind: FakeSyntaxKind): kind is SemanticSyntaxKind {
  return kind !== 'fake'
}

function isFakeSourceFile(node: FakeNode): node is FakeSourceFile {
  return node.kind === 'sourceFile'
}
