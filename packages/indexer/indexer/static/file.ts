import ts from 'typescript'
import type { ProjectDefinition } from '@crux/core/project-index'
import { collectTopLevelInitializers, scopedInitializersForNode } from '../ast/initializers'
import { collectImportBindings, type ImportBinding } from '../ast/imports'
import { readSourceFile } from '../ast/parse'
import type { ExtractedFacts } from '../extensions'
import { staticFoundDefinitionsFromExtractedFacts } from '../static-index/compatibility/syntax-record-bridge/normalizer'
import type { StaticFoundDefinition } from '../types'
import type { StaticFactParser } from './extraction/parser'
import { staticParseResultFromFacts } from './read-model'
import { staticRuntimePrepareFacts } from './runtime-prepare'
import type { ParseMemo } from './extraction/source-io'
import type { StaticFactParseResult, StaticParseResult } from './types'

export { staticParseResultFromFacts } from './read-model'

/**
 * Runs the source-local static extraction pass for one TypeScript file.
 *
 * The pass keeps raw extractor facts separate from the final index projection so relation resolution,
 * prompt/context tree paths, and runtime-prepare hints can be composed deterministically. `parseMemo`
 * is the only cache this layer accepts; callers that need persistent caching should use the static
 * extraction engine rather than hiding IO behind parser globals.
 */
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
    parseMemo,
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

/**
 * Extracts exported top-level declarations before ambient call-site discovery.
 *
 * Exported bindings are the canonical anchors for authored definitions. Capturing them first lets
 * later projections, such as `createPrompts({ ... })` path metadata, attach to the same definition id
 * instead of creating a duplicate from a matching call expression.
 */
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

/**
 * Parses a file and returns the fully projected static index view.
 *
 * This helper is intentionally thin: extraction happens in `parseStaticFacts`, then read-model
 * enrichment happens in `staticParseResultFromFacts`. Keeping the boundary visible makes tests and
 * cache keys target the same deterministic compiler phases used in production.
 */
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
 * The static resolver can bind `uses` references across local imports without indexing the whole
 * project first. Missing or unsupported imported files are treated as absent rather than fatal, so a
 * single unresolved dependency cannot prevent the source file from contributing its own definitions.
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

/**
 * Extracts definitions from non-exported declarations and standalone call expressions.
 *
 * This is a discovery aid for runtime-style authored code where a prompt, agent, or route may be
 * passed around without being exported. Duplicate suppression is scoped to this file parse so the
 * exported declaration remains the preferred representation when both paths see the same definition.
 */
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
 * Returns parser-supported call names for source-local call-site prefiltering.
 *
 * The parser may omit the set when it only supports exported initializer extraction. In that case the
 * traversal still processes declarations, but standalone calls are skipped without consulting the
 * extension runtime for every call expression in the file.
 */
function parserCallNames(parser: StaticFactParser): ReadonlySet<string> {
  return parser.staticCallNames ?? new Set()
}
