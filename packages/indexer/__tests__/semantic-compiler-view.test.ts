import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import { createTypeScriptSemanticCompilerView } from '../indexer/semantic/typescript/compiler-view'

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
