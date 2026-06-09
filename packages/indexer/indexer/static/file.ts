import ts from 'typescript'
import type { ProjectDefinition } from '@crux/core/project-index'
import { collectTopLevelInitializers, scopedInitializersForNode } from '../ast/initializers'
import { collectImportBindings } from '../ast/imports'
import { readSourceFile } from '../ast/parse'
import type { ExtractedFacts } from '../extensions'
import { staticFoundDefinitionsFromExtractedFacts } from '../extensions/static-normalizer'
import type {
  ImportBinding,
  StaticFactParseResult,
  StaticFoundDefinition,
  StaticParseResult,
} from '../types'
import type { StaticFactParser } from './parser'
import { staticParseResultFromFacts } from './read-model'
import { staticRuntimePrepareFacts } from './runtime-prepare'
import type { ParseMemo } from './extraction/source-io'

export { staticParseResultFromFacts, withResolvedInjectionReadModel } from './read-model'

/** Reads one TypeScript source file and returns source-local compiler facts plus declared dependencies. */
export async function parseStaticFacts(
  root: string,
  file: string,
  parser: StaticFactParser,
  parseMemo?: ParseMemo,
): Promise<StaticFactParseResult> {
  const sourceFile = parseMemo ? await parseMemo.readSourceFile(file) : await readSourceFile(file)
  const localInitializers = new Map<string, ts.Expression>()
  const importBindings = collectImportBindings(sourceFile, root, file)

  collectTopLevelInitializers(sourceFile, localInitializers)

  const exported = exportedStaticFacts(root, file, sourceFile, localInitializers, importBindings, parser)
  const callSites = callSiteStaticFacts(
    root,
    file,
    sourceFile,
    localInitializers,
    importBindings,
    exported.foundForPathProjection,
    parser,
  )
  const facts = [...exported.facts, ...callSites.facts, ...staticRuntimePrepareFacts(sourceFile)]
  const foundForPathProjection = [...exported.foundForPathProjection, ...callSites.foundForPathProjection]
  const pathDefinitions = await parser.staticTreePathDefinitions(
    root,
    file,
    sourceFile,
    localInitializers,
    foundForPathProjection,
    importBindings,
  )
  const importedDefinitions = await importedDefinitionsForFactRelations(root, importBindings, parser, parseMemo)
  const diagnostics = facts.flatMap((fact) => fact.diagnostics ?? [])
  const dependencies = [
    ...new Set([
      ...[...importBindings.values()].map((binding) => binding.file),
      ...facts.flatMap((fact) =>
        (fact.dependencies ?? [])
          .filter((dependency) => dependency.kind === 'source-file')
          .map((dependency) => dependency.file),
      ),
    ]),
  ].sort()

  return { facts, pathDefinitions, importedDefinitions, diagnostics, dependencies }
}

/** Extracts exported top-level definitions before call-site discovery so path projection has stable anchors. */
function exportedStaticFacts(
  root: string,
  file: string,
  sourceFile: ts.SourceFile,
  localInitializers: Map<string, ts.Expression>,
  importBindings: Map<string, ImportBinding>,
  parser: StaticFactParser,
): { facts: NonNullable<StaticFactParseResult['facts']>; foundForPathProjection: StaticFoundDefinition[] } {
  const facts: NonNullable<StaticFactParseResult['facts']> = []
  const foundForPathProjection: StaticFoundDefinition[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isVariableStatement(node) && parser.hasExportModifier(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
        const extracted = parser.staticFactsFromInitializer(
          root,
          file,
          sourceFile,
          declaration.name.text,
          declaration.initializer,
          localInitializers,
          importBindings,
        )
        if (!extracted) continue
        facts.push(extracted)
        const found = staticFoundDefinitionsFromExtractedFacts([extracted])[0]
        if (found) foundForPathProjection.push(found)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return { facts, foundForPathProjection }
}

/** Runs fact extraction and projects the result into the static index shape consumed by indexers. */
export async function parseStaticDefinitionsFromFacts(
  root: string,
  file: string,
  parser: StaticFactParser,
  parseMemo?: ParseMemo,
): Promise<StaticParseResult> {
  return staticParseResultFromFacts(await parseStaticFacts(root, file, parser, parseMemo))
}

/**
 * Reads imported declarations needed for same-pass relation resolution.
 *
 * This is an explicit IO boundary: imported files are parsed on demand, while
 * the returned map is fresh and local to the current source-file parse.
 */
async function importedDefinitionsForFactRelations(
  root: string,
  importBindings: Map<string, ImportBinding>,
  parser: StaticFactParser,
  parseMemo?: ParseMemo,
): Promise<Map<string, ProjectDefinition>> {
  const definitions = new Map<string, ProjectDefinition>()
  const parsedFiles = new Map<
    string,
    {
      sourceFile: ts.SourceFile
      localInitializers: Map<string, ts.Expression>
      importBindings: Map<string, ImportBinding>
    }
  >()

  for (const [localName, binding] of importBindings) {
    if (binding.importedName === 'default') continue
    let parsed = parsedFiles.get(binding.file)
    if (!parsed) {
      try {
        const sourceFile = parseMemo ? await parseMemo.readSourceFile(binding.file) : await readSourceFile(binding.file)
        const localInitializers = new Map<string, ts.Expression>()
        collectTopLevelInitializers(sourceFile, localInitializers)
        parsed = {
          sourceFile,
          localInitializers,
          importBindings: collectImportBindings(sourceFile, root, binding.file),
        }
        parsedFiles.set(binding.file, parsed)
      } catch {
        continue
      }
    }
    const initializer = parsed.localInitializers.get(binding.importedName)
    if (!initializer) continue
    const extracted = parser.staticFactsFromInitializer(
      root,
      binding.file,
      parsed.sourceFile,
      binding.importedName,
      initializer,
      parsed.localInitializers,
      parsed.importBindings,
    )
    const found = extracted ? staticFoundDefinitionsFromExtractedFacts([extracted])[0] : undefined
    if (found) definitions.set(localName, found.definition)
  }

  return definitions
}

/** Extracts local call-site definitions while keeping duplicate suppression local to this projection pass. */
function callSiteStaticFacts(
  root: string,
  file: string,
  sourceFile: ts.SourceFile,
  localInitializers: Map<string, ts.Expression>,
  importBindings: Map<string, ImportBinding>,
  exportedFoundForPathProjection: readonly StaticFoundDefinition[],
  parser: StaticFactParser,
): { facts: NonNullable<StaticFactParseResult['facts']>; foundForPathProjection: StaticFoundDefinition[] } {
  const facts: NonNullable<StaticFactParseResult['facts']> = []
  const foundForPathProjection: StaticFoundDefinition[] = []
  const seen = new Set(exportedFoundForPathProjection.map((item) => item.definition.id))

  const addFacts = (extracted: StaticFactParseResult['facts'][number] | undefined): void => {
    if (!extracted) return
    const found = staticFoundDefinitionsFromExtractedFacts([extracted])[0]
    if (!found || seen.has(found.definition.id)) return
    seen.add(found.definition.id)
    facts.push(extracted)
    foundForPathProjection.push(found)
  }

  const visit = (node: ts.Node): void => {
    if (ts.isVariableStatement(node) && !parser.hasExportModifier(node)) {
      const scopedInitializers = scopedInitializersForNode(node, localInitializers)
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
        addFacts(
          parser.staticFactsFromInitializer(
            root,
            file,
            sourceFile,
            declaration.name.text,
            declaration.initializer,
            scopedInitializers,
            importBindings,
          ),
        )
      }
    }
    if (ts.isCallExpression(node)) {
      const callName = parser.expressionName(node.expression)
      if (callName && parserCallNames(parser).has(callName)) {
        const scopedInitializers = scopedInitializersForNode(node, localInitializers)
        addFacts(parser.staticFactsFromCall(root, file, sourceFile, callName, node, scopedInitializers, importBindings))
      }
    }
    if (ts.isNewExpression(node) && parser.expressionName(node.expression) === 'Agent') {
      const scopedInitializers = scopedInitializersForNode(node, localInitializers)
      const sourceLine = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1
      addFacts(
        parser.staticFactsFromInitializer(
          root,
          file,
          sourceFile,
          `agent-${sourceLine}`,
          node,
          scopedInitializers,
          importBindings,
        ),
      )
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return { facts, foundForPathProjection }
}

/**
 * Returns parser-supported call names, defaulting to an empty immutable set when
 * the parser does not expose static dispatch names.
 */
function parserCallNames(parser: StaticFactParser): ReadonlySet<string> {
  return parser.staticCallNames ?? new Set()
}
