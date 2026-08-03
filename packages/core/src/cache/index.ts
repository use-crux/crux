/**
 * Semantic response cache — `@use-crux/core/cache`.
 *
 * {@link createSemanticCache} installs a prompt-level semantic cache plugin
 * backed by beta record/search stores and a dense embedding.
 * {@link semanticCachePolicies} provides composable lookup/cache gates, and
 * {@link warnMissingSemanticCachePlugin} warns when caching is requested but no
 * plugin is installed.
 *
 * @module
 */

export type {
  SemanticCacheScopeContext,
  SemanticCacheLookupContext,
  SemanticCacheWriteContext,
  SemanticCacheConfig,
} from './types'

export { createSemanticCache } from './semantic-cache'
export { semanticCachePolicies, warnMissingSemanticCachePlugin } from './policies'
