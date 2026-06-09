import { relative } from 'node:path'
import ts from 'typescript'
import type {
  ProjectDefinition,
  ProjectDefinitionKind,
} from '@crux/core/project-index'
import { collectTopLevelInitializers } from '../../ast/initializers'
import { propertyName } from '../../ast/literals'
import { readSourceFile } from '../../ast/parse'
import { schemaProperty } from '../../ast/schemas'
import { sourceForNode, sourceSnippetForNode } from '../../ast/snippets'
import { safeId } from '../../definitions'
import { extractedFactsFromStaticExtractionResult, type IndexerExtensionRuntime } from '../../extensions'
import type { ExtractedFacts } from '../../extensions'
import { staticFoundDefinitionFromExtractedFacts } from '../../extensions/static-normalizer'
import type { ImportBinding } from '../../ast/imports'
import type { StaticFoundDefinition } from '../../types'
import { staticDefinition } from '../definition-builder'

/**
 * TypeScript syntax frontend used by the static extraction engine.
 *
 * The engine owns file IO, cache identity, and public lifecycle. This strategy owns the syntax-level
 * decisions that still require TypeScript nodes: which expressions are eligible for extractor
 * dispatch, how authored tree paths are projected, and how exported declarations are recognized.
 * Callers outside the extraction engine should depend on `createStaticExtraction(...)`, not this AST
 * adapter.
 */
export interface StaticFactParser {
  /**
   * Callable names worth visiting during standalone call-site discovery.
   *
   * This set is a prefilter, not an authorization boundary. The extension runtime still performs the
   * final pattern match, including import-source checks, before any extractor receives a context.
   */
  readonly staticCallNames?: ReadonlySet<string>
  /**
   * Attempts extraction from a variable initializer such as `export const x = prompt(...)`.
   *
   * The parser passes the authored export name separately from the AST node so extractors can produce
   * stable fallback ids even when the initializer is an object literal, constructor call, or imported
   * factory call.
   */
  staticFactsFromInitializer: (
    root: string,
    file: string,
    sourceFile: ts.SourceFile,
    variableName: string,
    initializer: ts.Expression,
    localInitializers: Map<string, ts.Expression>,
    importBindings?: Map<string, ImportBinding>,
  ) => ExtractedFacts | undefined
  /**
   * Attempts extraction from a standalone call expression discovered outside an exported declaration.
   *
   * This path is used for runtime-style authoring where a Crux primitive may be created and passed
   * immediately. Implementations must keep ids deterministic because there is no exported binding to
   * serve as the canonical name.
   */
  staticFactsFromCall: (
    root: string,
    file: string,
    sourceFile: ts.SourceFile,
    callName: string,
    call: ts.CallExpression,
    localInitializers: Map<string, ts.Expression>,
    importBindings?: Map<string, ImportBinding>,
  ) => ExtractedFacts | undefined
  /**
   * Projects `createPrompts`/`createContexts` tree paths onto definitions that are already visible.
   *
   * Tree projection runs after source-local extraction so path metadata attaches to the canonical
   * definition when the same prompt/context was exported earlier in the file.
   */
  staticTreePathDefinitions: (
    root: string,
    file: string,
    sourceFile: ts.SourceFile,
    localInitializers: Map<string, ts.Expression>,
    found: StaticFoundDefinition[],
    importBindings: Map<string, ImportBinding>,
  ) => Promise<ProjectDefinition[]>
  /**
   * Returns the simple expression name used by parser prefilters.
   *
   * Complex expressions intentionally return `undefined`; extractors should only receive calls whose
   * author-facing API name can be identified deterministically.
   */
  expressionName: (expression: ts.Expression) => string | undefined
  /**
   * Detects exported declarations for this syntax frontend.
   *
   * Keeping this behind the strategy lets future syntax frontends define their own export rules
   * without changing the source-local extraction pass.
   */
  hasExportModifier: (node: ts.Node) => boolean
}

/**
 * Creates the TypeScript parser strategy bound to one extension runtime instance.
 *
 * The returned strategy is stateless apart from the immutable runtime manifest. It can be reused
 * across files in the same extraction engine, while per-run source memoization stays in `ParseMemo`.
 */
export function createStaticExtractionParser(
  extensionRuntime: IndexerExtensionRuntime,
  input: {
    readonly intrinsicCallNames?: readonly string[]
  } = {},
): StaticFactParser {
  return {
    staticCallNames: new Set([...extensionRuntime.manifest.callNames, ...(input.intrinsicCallNames ?? [])]),
    staticFactsFromInitializer: (
      root,
      file,
      sourceFile,
      variableName,
      initializer,
      localInitializers,
      importBindings,
    ) =>
      staticFactsFromInitializer(
        extensionRuntime,
        root,
        file,
        sourceFile,
        variableName,
        initializer,
        localInitializers,
        importBindings,
      ),
    staticFactsFromCall: (root, file, sourceFile, callName, call, localInitializers, importBindings) =>
      staticFactsFromCall(extensionRuntime, root, file, sourceFile, callName, call, localInitializers, importBindings),
    staticTreePathDefinitions: (root, file, sourceFile, localInitializers, found, importBindings) =>
      staticTreePathDefinitions(extensionRuntime, root, file, sourceFile, localInitializers, found, importBindings),
    expressionName,
    hasExportModifier,
  }
}

/**
 * Extracts fact contributions from one variable initializer.
 *
 * This is the parser's main syntax-to-runtime adapter. It normalizes object literals, constructor
 * calls, and call expressions into the same `StaticCallContext` shape, preserving import metadata
 * when available so extension patterns can distinguish imported APIs from local functions.
 */
function staticFactsFromInitializer(
  extensionRuntime: IndexerExtensionRuntime,
  root: string,
  file: string,
  sourceFile: ts.SourceFile,
  variableName: string,
  initializer: ts.Expression,
  localInitializers: Map<string, ts.Expression>,
  importBindings = new Map<string, ImportBinding>(),
): ExtractedFacts | undefined {
  if (ts.isObjectLiteralExpression(initializer)) {
    const source = sourceForNode(sourceFile, initializer)
    const snippet = sourceSnippetForNode(sourceFile, initializer)
    const localName = fallbackStaticName(root, file, variableName)
    return extractedFactsFromStaticExtractionResult(
      extensionRuntime.extractStatic({
        root,
        file,
        sourceFile,
        variableName,
        call: initializer,
        callName: 'object',
        objectArg: initializer,
        source,
        snippet,
        localName,
        localInitializers,
        helpers: {
          safeId,
          schemaProperty,
          define: (id, kind, name, objectArgValue, metadata) =>
            staticDefinition(file, id, kind, name, objectArgValue, source, snippet, metadata),
          relationRef: (type, target) => ({ type, ...target }),
        },
        safeId,
        define: (id, kind, name, objectArgValue, metadata) =>
          staticDefinition(file, id, kind, name, objectArgValue, source, snippet, metadata),
      }),
    )
  }

  if (ts.isNewExpression(initializer)) {
    const callName = expressionName(initializer.expression)
    if (!callName) return undefined
    const firstArg = initializer.arguments?.[0]
    const objectArg = initializer.arguments?.find((arg): arg is ts.ObjectLiteralExpression =>
      ts.isObjectLiteralExpression(arg),
    )
    const source = sourceForNode(sourceFile, initializer)
    const snippet = sourceSnippetForNode(sourceFile, initializer)
    const localName = fallbackStaticName(root, file, variableName)
    return extractedFactsFromStaticExtractionResult(
      extensionRuntime.extractStatic({
        root,
        file,
        sourceFile,
        variableName,
        call: initializer,
        callName,
        firstArg,
        objectArg,
        source,
        snippet,
        localName,
        localInitializers,
        helpers: {
          safeId,
          schemaProperty,
          define: (id, kind, name, objectArgValue, metadata) =>
            staticDefinition(file, id, kind, name, objectArgValue, source, snippet, metadata),
          relationRef: (type, target) => ({ type, ...target }),
        },
        safeId,
        define: (id, kind, name, objectArgValue, metadata) =>
          staticDefinition(file, id, kind, name, objectArgValue, source, snippet, metadata),
      }),
    )
  }

  if (!ts.isCallExpression(initializer)) return undefined
  const callName = expressionName(initializer.expression)
  if (!callName) return undefined

  const firstArg = initializer.arguments[0]
  const objectArg = firstArg && ts.isObjectLiteralExpression(firstArg) ? firstArg : undefined
  const source = sourceForNode(sourceFile, initializer)
  const snippet = sourceSnippetForNode(sourceFile, initializer)
  const localName = fallbackStaticName(root, file, variableName)
  const importBinding = importBindings.get(callName)
  return extractedFactsFromStaticExtractionResult(
    extensionRuntime.extractStatic({
      root,
      file,
      sourceFile,
      variableName,
      call: initializer,
      callName,
      firstArg,
      objectArg,
      source,
      snippet,
      localName,
      localInitializers,
      ...(importBinding ? { importName: importBinding.importedName, importSource: importBinding.moduleSpecifier } : {}),
      helpers: {
        safeId,
        schemaProperty,
        define: (id, kind, name, objectArgValue, metadata) =>
          staticDefinition(file, id, kind, name, objectArgValue, source, snippet, metadata),
        relationRef: (type, target) => ({ type, ...target }),
      },
      safeId,
      define: (id, kind, name, objectArgValue, metadata) =>
        staticDefinition(file, id, kind, name, objectArgValue, source, snippet, metadata),
    }),
  )
}

/**
 * Extracts facts from a standalone call expression discovered outside an exported declaration.
 *
 * The generated fallback name gives local call-site definitions deterministic ids while preserving
 * the same extension dispatch path used for exported initializers. Callers should still prefer an
 * exported declaration when both representations exist.
 */
function staticFactsFromCall(
  extensionRuntime: IndexerExtensionRuntime,
  root: string,
  file: string,
  sourceFile: ts.SourceFile,
  callName: string,
  call: ts.CallExpression,
  localInitializers: Map<string, ts.Expression>,
  importBindings = new Map<string, ImportBinding>(),
): ExtractedFacts | undefined {
  const source = sourceForNode(sourceFile, call)
  const fallbackName = fallbackStaticName(root, file, `${callName}-${source.line}`)
  return staticFactsFromInitializer(
    extensionRuntime,
    root,
    file,
    sourceFile,
    fallbackName,
    call,
    localInitializers,
    importBindings,
  )
}

/**
 * Builds path-backed prompt/context definitions from `createPrompts` and `createContexts` trees.
 *
 * Tree paths are parser-owned projections that annotate existing definitions with authored path
 * information. They stay outside extractor authoring so extensions do not need to understand index
 * path backfill mechanics or recursively parse object-literal namespace trees.
 */
async function staticTreePathDefinitions(
  extensionRuntime: IndexerExtensionRuntime,
  root: string,
  file: string,
  sourceFile: ts.SourceFile,
  localInitializers: Map<string, ts.Expression>,
  found: StaticFoundDefinition[],
  importBindings: Map<string, ImportBinding>,
): Promise<ProjectDefinition[]> {
  const localByExport = new Map(found.map((item) => [item.variableName, item.definition]))
  const definitions: ProjectDefinition[] = []

  const visit = async (node: ts.Node): Promise<void> => {
    if (ts.isCallExpression(node)) {
      const callName = expressionName(node.expression)
      if (
        (callName === 'createPrompts' || callName === 'createContexts') &&
        node.arguments[0] &&
        ts.isObjectLiteralExpression(node.arguments[0])
      ) {
        const kind: ProjectDefinitionKind = callName === 'createPrompts' ? 'prompt' : 'context'
        definitions.push(
          ...(await treePathDefinitionsForObject(
            root,
            file,
            sourceFile,
            node.arguments[0],
            [],
            kind,
            localInitializers,
            localByExport,
            importBindings,
            extensionRuntime,
          )),
        )
      }
    }
    const tasks: Promise<void>[] = []
    ts.forEachChild(node, (child) => {
      tasks.push(visit(child))
    })
    await Promise.all(tasks)
  }

  await visit(sourceFile)
  return definitions
}

/**
 * Recursively walks an authored prompt/context tree and projects identifier leaves into path definitions.
 *
 * Only identifier leaves are considered resolvable targets. Spreads and computed or dynamic leaves are
 * skipped because they cannot produce a stable authored path without executing user code.
 */
async function treePathDefinitionsForObject(
  root: string,
  file: string,
  sourceFile: ts.SourceFile,
  object: ts.ObjectLiteralExpression,
  path: string[],
  kind: ProjectDefinitionKind,
  localInitializers: Map<string, ts.Expression>,
  localByExport: Map<string, ProjectDefinition>,
  importBindings: Map<string, ImportBinding>,
  extensionRuntime: IndexerExtensionRuntime,
): Promise<ProjectDefinition[]> {
  const definitions: ProjectDefinition[] = []
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) continue
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue
    const key = propertyName(property.name)
    if (!key) continue
    const nextPath = [...path, key]
    const initializer = ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer

    if (ts.isObjectLiteralExpression(initializer)) {
      definitions.push(
        ...(await treePathDefinitionsForObject(
          root,
          file,
          sourceFile,
          initializer,
          nextPath,
          kind,
          localInitializers,
          localByExport,
          importBindings,
          extensionRuntime,
        )),
      )
      continue
    }
    if (!ts.isIdentifier(initializer)) continue

    const resolved = await resolveDefinitionForTreeLeaf(
      root,
      file,
      sourceFile,
      initializer.text,
      kind,
      localInitializers,
      localByExport,
      importBindings,
      extensionRuntime,
    )
    if (!resolved) continue
    definitions.push({
      id: resolved.id,
      kind: resolved.kind,
      name: resolved.name,
      path: nextPath,
      fidelity: resolved.fidelity,
      status: resolved.status,
    })
  }
  return definitions
}

/**
 * Resolves a prompt/context tree leaf against local exports, local initializers, or imported exports.
 *
 * The function is conservative: it only returns a definition when the target kind matches the tree
 * kind, preventing path metadata from being attached to unrelated index definitions. Imported files
 * are parsed through the same runtime-bound parser strategy so extension behavior remains identical
 * across local and cross-file targets.
 */
async function resolveDefinitionForTreeLeaf(
  root: string,
  file: string,
  sourceFile: ts.SourceFile,
  identifier: string,
  kind: ProjectDefinitionKind,
  localInitializers: Map<string, ts.Expression>,
  localByExport: Map<string, ProjectDefinition>,
  importBindings: Map<string, ImportBinding>,
  extensionRuntime: IndexerExtensionRuntime,
): Promise<ProjectDefinition | undefined> {
  const local = localByExport.get(identifier)
  if (local?.kind === kind) return local

  const initializer = localInitializers.get(identifier)
  if (initializer) {
    const extracted = staticFactsFromInitializer(
      extensionRuntime,
      root,
      file,
      sourceFile,
      identifier,
      initializer,
      localInitializers,
    )
    const parsed = extracted ? staticFoundDefinitionFromExtractedFacts(extracted) : undefined
    if (parsed?.definition.kind === kind) return parsed.definition
  }

  const binding = importBindings.get(identifier)
  if (!binding) return undefined
  const exports = await staticExportDefinitions(extensionRuntime, root, binding.file)
  const imported = exports.get(binding.importedName)
  return imported?.kind === kind ? imported : undefined
}

/**
 * Reads exported static definitions from another file for tree-path binding.
 *
 * This is intentionally a narrow helper for imported tree leaves. General file extraction should use
 * `parseStaticFacts` or the static extraction engine so diagnostics, dependencies, and cache identity
 * are preserved.
 */
async function staticExportDefinitions(
  extensionRuntime: IndexerExtensionRuntime,
  root: string,
  file: string,
): Promise<Map<string, ProjectDefinition>> {
  return readStaticExportDefinitions(extensionRuntime, root, file)
}

/**
 * Parses one imported file and returns definitions keyed by exported variable name.
 *
 * Only exported variable initializers are considered. The helper does not walk arbitrary call sites in
 * the imported file because tree-path binding needs named exports, not a second full file snapshot.
 */
async function readStaticExportDefinitions(
  extensionRuntime: IndexerExtensionRuntime,
  root: string,
  file: string,
): Promise<Map<string, ProjectDefinition>> {
  const sourceFile = await readSourceFile(file)
  const localInitializers = new Map<string, ts.Expression>()
  const definitions = new Map<string, ProjectDefinition>()

  collectTopLevelInitializers(sourceFile, localInitializers)

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || !hasExportModifier(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
      const extracted = staticFactsFromInitializer(
        extensionRuntime,
        root,
        file,
        sourceFile,
        declaration.name.text,
        declaration.initializer,
        localInitializers,
      )
      const parsed = extracted ? staticFoundDefinitionFromExtractedFacts(extracted) : undefined
      if (parsed) definitions.set(declaration.name.text, parsed.definition)
    }
  }
  return definitions
}

/**
 * Checks whether a declaration participates in source-local exported-definition extraction.
 *
 * The parser only recognizes explicit `export` modifiers here. Re-export syntax is handled through
 * import/dependency analysis rather than pretending the current file authored a definition.
 */
function hasExportModifier(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  )
}

/**
 * Reads the user-facing callable name represented by a TypeScript expression.
 *
 * Property access keeps the terminal name (`crux.prompt` becomes `prompt`) because extension matching
 * is based on the callable API surface, with import-source filtering handled separately.
 */
function expressionName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return undefined
}

/**
 * Builds a deterministic local fallback name from file path and variable/call-site name.
 *
 * Fallback names are intentionally rooted in the project-relative path so anonymous call-site
 * discoveries remain stable across machines while still changing when the authored location changes.
 */
function fallbackStaticName(root: string, file: string, variableName: string): string {
  return `${relative(root, file).replace(/\\/g, '/')}:${variableName}`
}
