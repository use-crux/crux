import { relative } from 'node:path'
import ts from 'typescript'
import type { ProjectDefinitionKind, SourceLocation, SourceSnippet } from '@use-crux/core/project-index'
import { schemaProperty } from '../../ast/schemas'
import { sourceForNode, sourceSnippetForNode } from '../../ast/snippets'
import type { ImportBinding } from '../../ast/imports'
import { safeId } from '../../definitions'
import { extractedFactsFromStaticExtractionResult, type IndexerExtensionRuntime } from '../../extensions'
import type { ExtractedFacts } from '../../extensions'
import { staticDefinition } from '../definition-builder'

/**
 * Extracts fact contributions from one variable initializer.
 *
 * This is the parser's main syntax-to-runtime adapter. It normalizes object literals, constructor
 * calls, and call expressions into the same runtime input shape, preserving import metadata when
 * available so extension patterns can distinguish imported APIs from local functions.
 */
export function staticFactsFromInitializer(
  extensionRuntime: IndexerExtensionRuntime,
  root: string,
  file: string,
  sourceFile: ts.SourceFile,
  variableName: string,
  initializer: ts.Expression,
  localInitializers: Map<string, ts.Expression>,
  importBindings = new Map<string, ImportBinding>(),
  exported = false,
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
        exported,
        call: initializer,
        callName: 'object',
        objectArg: initializer,
        source,
        snippet,
        localName,
        localInitializers,
        helpers: staticContextHelpers(file, source, snippet),
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
        exported,
        call: initializer,
        callName,
        firstArg,
        objectArg,
        source,
        snippet,
        localName,
        localInitializers,
        helpers: staticContextHelpers(file, source, snippet),
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
    exported,
    call: initializer,
      callName,
      firstArg,
      objectArg,
      source,
      snippet,
      localName,
      localInitializers,
      ...(importBinding ? { importName: importBinding.importedName, importSource: importBinding.moduleSpecifier } : {}),
      helpers: staticContextHelpers(file, source, snippet),
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
export function staticFactsFromCall(
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
    false,
  )
}

/**
 * Checks whether a declaration participates in source-local exported-definition extraction.
 *
 * The parser only recognizes explicit `export` modifiers here. Re-export syntax is handled through
 * import/dependency analysis rather than pretending the current file authored a definition.
 */
export function hasExportModifier(node: ts.Node): boolean {
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
export function expressionName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return undefined
}

/**
 * Creates the parser-era helper bag that first-party extractors still receive through Static Index
 * contexts.
 *
 * New extension code should prefer the stable `ExtractContext` builders. This helper is kept local to
 * the TypeScript frontend so the duplicated closure wiring does not leak back into parser callers.
 */
function staticContextHelpers(
  file: string,
  source: SourceLocation,
  snippet: SourceSnippet | undefined,
) {
  return {
    safeId,
    schemaProperty,
    define: (
      id: string,
      kind: ProjectDefinitionKind,
      name: string,
      objectArgValue: ts.ObjectLiteralExpression | undefined,
      metadata: Record<string, unknown>,
    ) => staticDefinition(file, id, kind, name, objectArgValue, source, snippet, metadata),
    relationRef: (type: string, target: { toVariable?: string; toId?: string }) => ({ type, ...target }),
  }
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
