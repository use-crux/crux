import type { CatalogExtractor, ExtractContext, ExtractedFacts, SourceIndexerExtension } from './types'
import { createDefinitionBuilder, createReferenceBuilder } from './builders'
import { createStaticArgumentReader, createStaticObjectReader } from './object-reader'
import { createExtensionRegistry, extractorsForCall, type ExtensionRegistry } from './registry'
import {
  callbackSourceRefForProperty,
  helperSourceRefsForNode,
  resolvedSourceNodeForProperty,
  schemaPropertyWithSourceRef,
  sourceRefForProperty,
  sourceRefsForTemplateInterpolations,
} from '../ast/source-refs'
import type { StaticCallContext } from '../extractors/types'

/**
 * Runs registered static extractors for one parser-owned call context and returns the first fact result.
 *
 * The adapter is intentionally one-way: it translates compiler-owned TypeScript/source data into the
 * stable `ExtractContext`, invokes extractors as pure value producers, and hands immutable facts back
 * to the parser. Extractors do not receive graph builders, cache handles, or mutable diagnostic sinks.
 */
export function extractFactsWithExtensionRegistry(
  registry: ExtensionRegistry,
  staticCtx: StaticCallContext,
): ExtractedFacts | undefined {
  for (const { extension, extractor } of extractorsForCall(
    registry,
    staticCtx.callName,
    staticCtx.importSource,
    staticCtx.importName,
  )) {
    const result = extractor.extract(createExtractContext(extension, extractor, staticCtx))
    if (result.kind === 'facts') {
      return result.facts
    }
  }
  return undefined
}

/**
 * Builds the normalized registry used by static parser execution.
 *
 * This wrapper exists so static parsing can depend on a compiler-specific registry constructor while
 * the generic registry module remains free of TypeScript parser concerns.
 */
export function createStaticExtensionRegistry(extensions: readonly SourceIndexerExtension[]): ExtensionRegistry {
  return createExtensionRegistry(extensions)
}

/**
 * Builds a production-shaped extractor context for tests.
 *
 * Boundary tests use this helper to exercise extractor APIs without running a full filesystem parse.
 * That keeps tests focused on the extension contract while still using the same builders/readers that
 * production parser execution provides.
 */
export function createStaticExtractContextForTesting(
  extension: SourceIndexerExtension,
  extractor: CatalogExtractor,
  staticCtx: StaticCallContext,
): ExtractContext {
  return createExtractContext(extension, extractor, staticCtx)
}

/**
 * Adapts parser-owned static call data into the stable extractor context.
 *
 * This is the main boundary between TypeScript-specific parsing and extension authoring. The returned
 * context exposes value-producing readers and builders, while TypeScript nodes remain behind
 * `unstableNative` for first-party helpers that still need compiler-owned traversal.
 */
function createExtractContext(
  extension: SourceIndexerExtension,
  extractor: CatalogExtractor,
  staticCtx: StaticCallContext,
): ExtractContext {
  return {
    extension: { name: extension.name, version: extension.version },
    extractor: extractor.name,
    match: { kind: 'call', name: staticCtx.importName ?? staticCtx.callName },
    source: {
      root: staticCtx.root,
      file: staticCtx.file,
      variableName: staticCtx.variableName,
      localName: staticCtx.localName,
      safeId: staticCtx.safeId,
    },
    args: createStaticArgumentReader([...staticCtx.call.arguments], staticCtx.localInitializers),
    config: createStaticObjectReader(staticCtx.objectArg, staticCtx.localInitializers),
    define: createDefinitionBuilder(({ id, kind, name, metadata }) =>
      staticCtx.define(id, kind, name, staticCtx.objectArg, metadata),
    ),
    ref: createReferenceBuilder(),
    sourceRef: {
      property: ({ property, role, definitionId, metadata }) => {
        if (!staticCtx.objectArg) return undefined
        const ref = sourceRefForProperty({
          ...staticCtx,
          object: staticCtx.objectArg,
          property,
          role,
          definitionId,
          ...(metadata ? { metadata } : {}),
        })
        return ref ? { definitionId, ref } : undefined
      },
      callbackProperty: ({ property, role, definitionId, metadata }) => {
        if (!staticCtx.objectArg) return undefined
        const ref = callbackSourceRefForProperty({
          ...staticCtx,
          object: staticCtx.objectArg,
          property,
          role,
          definitionId,
          ...(metadata ? { metadata } : {}),
        })
        return ref ? { definitionId, ref } : undefined
      },
      templateInterpolations: ({ property, role, definitionId }) => {
        if (!staticCtx.objectArg) return []
        return sourceRefsForTemplateInterpolations({
          ...staticCtx,
          object: staticCtx.objectArg,
          property,
          role,
          definitionId,
        }).map((ref) => ({ definitionId, ref }))
      },
      schemaProperty: ({ property, definitionId }) => {
        if (!staticCtx.objectArg) return { sourceRefs: [] }
        const result = schemaPropertyWithSourceRef({
          ...staticCtx,
          object: staticCtx.objectArg,
          property,
          definitionId,
        })
        return {
          ...(result.schema ? { schema: result.schema } : {}),
          sourceRefs: result.sourceRefs.map((ref) => ({ definitionId, ref })),
        }
      },
      helperRefsForProperty: ({ property, definitionId, maxDepth }) => {
        if (!staticCtx.objectArg) return []
        const resolved = resolvedSourceNodeForProperty({
          ...staticCtx,
          object: staticCtx.objectArg,
          property,
        })
        if (!resolved) return []
        return helperSourceRefsForNode({
          definitionId,
          root: staticCtx.root,
          file: resolved.sourceFile.fileName,
          sourceFile: resolved.sourceFile,
          node: resolved.node,
          localInitializers: resolved.localInitializers,
          ...(maxDepth !== undefined ? { maxDepth } : {}),
        }).map((ref) => ({ definitionId, ref }))
      },
    },
    unstableNative: {
      staticContext: staticCtx,
      typescript: {
        sourceFile: staticCtx.sourceFile,
        call: staticCtx.call,
        objectArg: staticCtx.objectArg,
      },
    },
  }
}
