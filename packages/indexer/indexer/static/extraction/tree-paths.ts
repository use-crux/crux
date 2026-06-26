import ts from 'typescript'
import type {
  ProjectDefinition,
  ProjectDefinitionKind,
} from '@use-crux/core/project-index'
import { collectTopLevelInitializers } from '../../ast/initializers'
import { propertyName } from '../../ast/literals'
import { collectImportBindings, type ImportBinding } from '../../ast/imports'
import { readSourceFile } from '../../ast/parse'
import type { IndexerExtensionRuntime } from '../../extensions'
import { staticFoundDefinitionFromExtractedFacts } from '../../static-index/compatibility/syntax-record-bridge/normalizer'
import type { StaticFoundDefinition } from '../../types'
import type { ParseMemo } from './source-io'
import { expressionName, hasExportModifier, staticFactsFromInitializer } from './match'

/**
 * Builds path-backed prompt/context definitions from `createPrompts` and `createContexts` trees.
 *
 * Tree paths are parser-owned projections that annotate existing definitions with authored path
 * information. They stay outside extractor authoring so extensions do not need to understand index
 * path backfill mechanics or recursively parse object-literal namespace trees.
 */
export async function staticTreePathDefinitions(
  extensionRuntime: IndexerExtensionRuntime,
  root: string,
  file: string,
  sourceFile: ts.SourceFile,
  localInitializers: Map<string, ts.Expression>,
  found: StaticFoundDefinition[],
  importBindings: Map<string, ImportBinding>,
  parseMemo?: ParseMemo,
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
            parseMemo,
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
  parseMemo: ParseMemo | undefined,
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
          parseMemo,
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
      parseMemo,
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
  parseMemo: ParseMemo | undefined,
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
  const exports = await staticExportDefinitions(extensionRuntime, root, binding.file, parseMemo)
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
  parseMemo: ParseMemo | undefined,
): Promise<Map<string, ProjectDefinition>> {
  const sourceFile = parseMemo ? await parseMemo.readSourceFile(file) : await readSourceFile(file)
  const localInitializers = new Map<string, ts.Expression>()
  const importBindings = collectImportBindings(sourceFile, root, file)
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
        importBindings,
      )
      const parsed = extracted ? staticFoundDefinitionFromExtractedFacts(extracted) : undefined
      if (parsed) definitions.set(declaration.name.text, parsed.definition)
    }
  }
  return definitions
}
