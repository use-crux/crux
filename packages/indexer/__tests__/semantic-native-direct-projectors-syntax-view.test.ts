import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { API, type Project } from '@typescript/native-preview/unstable/sync'
import type { Node, SourceFile } from '@typescript/native-preview/unstable/ast'
import { formatSyntaxKind } from '@typescript/native-preview/unstable/ast/utils'
import { afterEach, describe, expect, it } from 'vitest'
import { createTsgoNativeSourceLookup } from '../indexer/semantic/backends/tsgo/source-lookup'
import { createTsgoSemanticSyntaxView } from '../indexer/semantic/backends/tsgo/syntax-view'

const roots: string[] = []

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.tmp-semantic-native-syntax-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('native semantic direct Crux projectors syntax view', () => {
  it('exposes native source files and analyzer syntax accessors', async () => {
    const root = await fixtureRoot()
    await writeTsconfig(root)
    const file = join(root, 'src/syntax.ts')
    await writeFile(
      file,
      `
        import { prompt as definePrompt } from '@crux/core'
        import * as catalog from './catalog'

        export const supportPrompt = definePrompt({
          id: 'support',
          retries: 2,
          tools: [catalog.searchTool],
        })
      `,
    )

    await withNativeProject(root, file, (project, sourceFile) => {
      const syntax = createTsgoSemanticSyntaxView({
        sourceFiles: (files) => files.flatMap((candidate) => project.program.getSourceFile(candidate) ?? []),
      })

      expect(syntax.sourceFiles([file])).toEqual([sourceFile])
      expect(syntax.kind(sourceFile)).toBe('sourceFile')

      const nodes = collectNodes(sourceFile)
      const promptCall = nodes.find(
        (node) => syntax.isKind(node, 'callExpression') && syntax.callExpressionName(node) === 'definePrompt',
      )
      expect(promptCall).toBeDefined()

      const [options] = syntax.callArguments(promptCall!)
      expect(options && syntax.kind(options)).toBe('objectLiteral')

      const properties = syntax.objectProperties(options!)
      expect(properties.map((property) => syntax.propertyName(property) && syntax.text(syntax.propertyName(property)!))).toEqual([
        'id',
        'retries',
        'tools',
      ])

      const idInitializer = initializerForProperty(properties, 'id', syntax)
      const retriesInitializer = initializerForProperty(properties, 'retries', syntax)
      const toolsInitializer = initializerForProperty(properties, 'tools', syntax)
      expect(idInitializer && syntax.stringLiteralText(idInitializer)).toBe('support')
      expect(retriesInitializer && syntax.numericLiteralText(retriesInitializer)).toBe('2')
      expect(retriesInitializer && syntax.literalValue(retriesInitializer)).toBe(2)

      const [toolReference] = syntax.arrayElements(toolsInitializer!)
      expect(toolReference && syntax.propertyAccessName(toolReference)).toBe('searchTool')
      const toolNamespace = toolReference && syntax.propertyAccessExpression(toolReference)
      expect(toolNamespace && syntax.identifierText(toolNamespace)).toBe('catalog')

      const imports = nodes.filter((node) => syntax.isKind(node, 'importDeclaration'))
      expect(imports.map((node) => syntax.importModuleSpecifier(node))).toEqual(['@crux/core', './catalog'])
      expect(syntax.namedImportSpecifiers(imports[0]!).map((node) => syntax.text(node))).toEqual([
        'prompt as definePrompt',
      ])
      expect(syntax.namespaceImportName(imports[1]!)).toBe('catalog')
    })
  }, 20_000)

  it('resolves native symbol handles and imported declarations without a TypeScript AST cache', async () => {
    const root = await fixtureRoot()
    await writeTsconfig(root)
    const catalogFile = join(root, 'src/catalog.ts')
    const file = join(root, 'src/syntax.ts')
    await writeFile(
      catalogFile,
      `
        export const searchTool = tool({ name: 'search' })
      `,
    )
    await writeFile(
      file,
      `
        import { searchTool as importedSearchTool } from './catalog'

        export const supportPrompt = prompt({
          id: 'support',
          tools: [importedSearchTool],
        })
      `,
    )

    await withNativeProject(root, file, (project, sourceFile) => {
      const lookup = createTsgoNativeSourceLookup(project)
      const syntax = createTsgoSemanticSyntaxView({
        sourceFiles: lookup.sourceFiles,
      })
      const nodes = collectNodes(sourceFile)
      const [importDeclaration] = nodes.filter((node) => syntax.isKind(node, 'importDeclaration'))
      const [importSpecifier] = syntax.namedImportSpecifiers(importDeclaration!)
      expect(importSpecifier).toBeDefined()

      const importedDeclarations = lookup.importedDeclarations(
        sourceFile.fileName,
        importSpecifier!.pos,
        importSpecifier!.end,
        formatSyntaxKind(importSpecifier!.kind),
      )
      expect(importedDeclarations.map((node) => syntax.kind(node))).toEqual(['variableDeclaration'])
      expect(syntax.declarationName(importedDeclarations[0]!)?.getSourceFile().fileName).toBe(catalogFile)
      expect(syntax.declarationName(importedDeclarations[0]!) && syntax.text(syntax.declarationName(importedDeclarations[0]!)!)).toBe(
        'searchTool',
      )

      const supportDeclaration = topLevelVariable(sourceFile, 'supportPrompt', syntax)
      expect(supportDeclaration).toBeDefined()
      const supportName = syntax.variableDeclarationName(supportDeclaration!)
      expect(supportName).toBeDefined()
      const supportSymbol = project.checker.getSymbolAtLocation(supportName!)
      expect(supportSymbol).toBeDefined()
      expect(lookup.declarationsForSymbol(supportSymbol!)).toEqual([supportDeclaration])
    })
  }, 20_000)
})

async function writeTsconfig(root: string): Promise<void> {
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'ESNext',
        moduleResolution: 'Bundler',
        target: 'ES2022',
        noEmit: true,
        skipLibCheck: true,
      },
      include: ['src/**/*.ts'],
    }),
  )
}

async function withNativeProject(
  root: string,
  file: string,
  run: (project: Project, sourceFile: SourceFile) => void,
): Promise<void> {
  const api = new API({ cwd: root })
  const snapshot = api.updateSnapshot({ openProject: join(root, 'tsconfig.json') })
  try {
    const project =
      snapshot.getProjects().find((candidate) => candidate.rootFiles.includes(file)) ?? snapshot.getProjects()[0]
    expect(project).toBeDefined()
    const sourceFile = project!.program.getSourceFile(file)
    expect(sourceFile).toBeDefined()
    run(project!, sourceFile!)
  } finally {
    snapshot.dispose()
    api.close()
  }
}

function collectNodes(sourceFile: SourceFile): readonly Node[] {
  const nodes: Node[] = []
  const visit = (node: Node): void => {
    nodes.push(node)
    node.forEachChild(visit)
  }
  visit(sourceFile)
  return nodes
}

function initializerForProperty(
  properties: readonly Node[],
  name: string,
  syntax: ReturnType<typeof createTsgoSemanticSyntaxView>,
): Node | undefined {
  return properties
    .filter((property) => syntax.propertyName(property) && syntax.text(syntax.propertyName(property)!) === name)
    .map((property) => syntax.propertyInitializer(property))
    .find((initializer): initializer is Node => Boolean(initializer))
}

function topLevelVariable(
  sourceFile: SourceFile,
  name: string,
  syntax: ReturnType<typeof createTsgoSemanticSyntaxView>,
): Node | undefined {
  return syntax
    .children(sourceFile)
    .filter((statement) => syntax.isKind(statement, 'variableStatement'))
    .flatMap((statement) => syntax.variableStatementDeclarations(statement))
    .find((declaration) => {
      const declarationName = syntax.variableDeclarationName(declaration)
      return declarationName ? syntax.text(declarationName) === name : false
    })
}
