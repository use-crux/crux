import ts from 'typescript'
import type { ProjectDefinition } from '@use-crux/core/project-index'
import type { ImportBinding } from '../../ast/imports'
import type { ExtractedFacts, IndexerExtensionRuntime } from '../../extensions'
import type { StaticFoundDefinition } from '../../types'
import { expressionName, hasExportModifier, staticFactsFromCall, staticFactsFromInitializer } from './match'
import type { ParseMemo } from './source-io'
import { staticTreePathDefinitions } from './tree-paths'

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
    parseMemo?: ParseMemo,
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
    staticTreePathDefinitions: (root, file, sourceFile, localInitializers, found, importBindings, parseMemo) =>
      staticTreePathDefinitions(
        extensionRuntime,
        root,
        file,
        sourceFile,
        localInitializers,
        found,
        importBindings,
        parseMemo,
      ),
    expressionName,
    hasExportModifier,
  }
}
