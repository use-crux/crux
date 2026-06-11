import type { IndexExtractor, ExtractContext, ExtractedFacts, IndexerExtension } from './types'
import type { StaticCallContext } from '../extractors/types'
import { createExtensionRegistry, type ExtensionRegistry } from './registry'
import {
  createExtractContext,
  createIndexerExtensionRuntime,
  extractedFactsFromStaticExtractionResult,
} from './runtime'

/**
 * Runs registered static extractors for one parser-owned call context and returns the first fact result.
 *
 * This is a compatibility helper for existing parser callers. New runtime-aware callers should use
 * `createIndexerExtensionRuntime(...).extractStatic(...)` so they can observe no-match, none,
 * degraded diagnostics, and dependency declarations.
 */
export function extractFactsWithExtensionRegistry(
  registry: ExtensionRegistry,
  staticCtx: StaticCallContext,
): ExtractedFacts | undefined {
  return extractedFactsFromStaticExtractionResult(
    createIndexerExtensionRuntime({ extensions: registry.extensions }).extractStatic(staticCtx),
  )
}

/**
 * Builds the normalized registry used by static parser execution.
 *
 * This wrapper remains for compatibility while parser callers migrate to the extension runtime.
 */
export function createStaticExtensionRegistry(extensions: readonly IndexerExtension[]): ExtensionRegistry {
  return createExtensionRegistry(extensions)
}

/**
 * Builds a production-shaped extractor context for tests.
 *
 * Boundary tests use this helper to exercise extractor APIs without running a full filesystem parse.
 */
export function createStaticExtractContextForTesting(
  extension: IndexerExtension,
  extractor: IndexExtractor,
  staticCtx: StaticCallContext,
): ExtractContext {
  return createExtractContext(extension, extractor, staticCtx)
}
