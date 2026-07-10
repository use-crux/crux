import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import ts from 'typescript'
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest'
import type { SemanticDefinitionCandidate } from '../src/indexer/semantic/candidates'
import type { SemanticCompilerView } from '../src/indexer/semantic/compiler-view'
import { createTypeScriptSemanticCompilerView } from '../src/indexer/semantic/backends/typescript/compiler-view'
import type {
  SemanticSyntaxKind,
  SemanticSyntaxNode,
  SemanticSyntaxSourceFile,
  SemanticSyntaxView,
} from '../src/indexer/semantic/syntax-view'

const roots: string[] = []

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.tmp-semantic-view-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('semantic compiler view', () => {
  it('provides batched TypeScript symbol and type access behind a Crux-owned view', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    const file = join(root, 'src/view.ts')
    await writeFile(
      file,
      `
        export const model = { id: 'model' }
        export const agent = { model }
      `,
    )

    const program = ts.createProgram({
      rootNames: [file],
      options: { noEmit: true, skipLibCheck: true },
    })
    const sourceFile = program.getSourceFile(file)
    expect(sourceFile).toBeDefined()

    const identifiers = collectIdentifiers(sourceFile!)
    const [modelDeclaration, modelReference] = [
      identifiers.find((entry) => entry.node.text === 'model')?.node,
      identifiers.find(
        (entry) => entry.node.text === 'model' && entry.parent?.kind === ts.SyntaxKind.ShorthandPropertyAssignment,
      )?.node,
    ]
    expect(modelDeclaration).toBeDefined()
    expect(modelReference).toBeDefined()

    const view = createTypeScriptSemanticCompilerView({
      identity: { name: 'typescript', version: 'test' },
      program,
      checker: program.getTypeChecker(),
    })

    expect(view.sourceFiles([file]).map((fileNode) => fileNode.fileName)).toEqual([file])
    expect(view.sourceText(modelReference!)).toBe('model')
    expect(view.sourceFile(modelReference!).fileName).toBe(file)

    const [declaredSymbol, referencedSymbol] = view.symbolsAt([modelDeclaration!, modelReference!])
    expect(declaredSymbol?.name).toBe('model')
    expect(referencedSymbol?.name).toBe('model')

    const [referenceType] = view.typesAt([modelReference!])
    expect(referenceType ? view.typeStrings([referenceType])[0] : undefined).toContain('id')
  })

  it('exposes normalized TypeScript syntax accessors without leaking analyzer logic', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    const file = join(root, 'src/syntax.ts')
    await writeFile(
      file,
      `
        const search = tool({ name: 'search' })
        export const support = prompt({
          id: 'support',
          tools: [search],
        })
      `,
    )

    const program = ts.createProgram({
      rootNames: [file],
      options: { noEmit: true, skipLibCheck: true },
    })
    const sourceFile = program.getSourceFile(file)
    expect(sourceFile).toBeDefined()

    const view = createTypeScriptSemanticCompilerView({
      identity: { name: 'typescript', version: 'test' },
      program,
      checker: program.getTypeChecker(),
    })
    const syntax = view.syntax
    const promptCall = collectNodes(sourceFile!).find(
      (node): node is ts.CallExpression =>
        syntax.isKind(node, 'callExpression') && syntax.callExpressionName(node) === 'prompt',
    )
    expect(promptCall).toBeDefined()

    const [options] = syntax.callArguments(promptCall!)
    expect(syntax.kind(options)).toBe('objectLiteral')
    expect(syntax.isKind(options, 'objectLiteral')).toBe(true)

    const properties = syntax.objectProperties(options)
    expect(properties.map((property) => syntax.propertyName(property) && syntax.text(syntax.propertyName(property)!))).toEqual([
      'id',
      'tools',
    ])

    const idProperty = properties.find((property) => syntax.text(syntax.propertyName(property)!) === 'id')
    expect(idProperty).toBeDefined()
    const idInitializer = syntax.propertyInitializer(idProperty!)
    expect(idInitializer && syntax.stringLiteralText(idInitializer)).toBe('support')

    const toolsProperty = properties.find((property) => syntax.text(syntax.propertyName(property)!) === 'tools')
    expect(toolsProperty).toBeDefined()
    const toolsInitializer = syntax.propertyInitializer(toolsProperty!)
    expect(toolsInitializer && syntax.arrayElements(toolsInitializer).map((node) => syntax.identifierText(node))).toEqual([
      'search',
    ])
  })

  it('keeps syntax and candidate node families generic at compile time', () => {
    interface FakeNode<TKind extends SemanticSyntaxKind = SemanticSyntaxKind> extends SemanticSyntaxNode<TKind> {
      readonly backend: 'fake'
    }

    interface FakeSourceFile extends FakeNode, SemanticSyntaxSourceFile<FakeNode> {
      readonly fileName: '/virtual/fake.ts'
      readonly text: ''
    }

    const assertNarrowing = (fakeView: SemanticSyntaxView<FakeNode, FakeSourceFile>, fakeNode: FakeNode): void => {
      if (fakeView.isKind(fakeNode, 'identifier')) {
        expectTypeOf(fakeNode).toMatchTypeOf<SemanticSyntaxNode<'identifier'>>()
      }
    }

    expectTypeOf(assertNarrowing).toBeFunction()
    expectTypeOf<SemanticDefinitionCandidate<FakeNode>['object']>().toEqualTypeOf<FakeNode>()
    expectTypeOf<SemanticCompilerView<FakeNode, FakeSourceFile>['syntax']>().toEqualTypeOf<
      SemanticSyntaxView<FakeNode, FakeSourceFile>
    >()
  })
})

interface IdentifierEntry {
  readonly node: ts.Identifier
  readonly parent?: ts.Node
}

function collectIdentifiers(sourceFile: ts.SourceFile): IdentifierEntry[] {
  const identifiers: IdentifierEntry[] = []

  const visit = (node: ts.Node, parent?: ts.Node): void => {
    if (ts.isIdentifier(node)) identifiers.push({ node, parent })
    ts.forEachChild(node, (child) => visit(child, node))
  }

  visit(sourceFile)
  return identifiers
}

function collectNodes(sourceFile: ts.SourceFile): ts.Node[] {
  const nodes: ts.Node[] = []

  const visit = (node: ts.Node): void => {
    nodes.push(node)
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return nodes
}
