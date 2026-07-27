/**
 * `createSemanticCache()` — the semantic response cache plugin.
 *
 * Returns a {@link CruxPlugin} whose middleware derives a per-call cache context
 * and delegates to the lookup and write phases. Read modes return a cached
 * result on a hit; write modes persist the produced result. Behavior is driven
 * by the per-prompt `cache.semantic` hint and the config's scope/threshold/ttl.
 *
 * @module
 */

import type { CruxPlugin } from '../runtime/plugin'
import type { EmbeddingModality } from '../embedding'
import type { SemanticCacheCall, SemanticCacheConfig, SemanticCacheLookupContext } from './types'
import {
  DEFAULT_NAMESPACE,
  DEFAULT_THRESHOLD,
  hasTools,
  hashStable,
  isRecord,
  normalizePromptHint,
  resolveScope,
  validateConfig,
  resolveSemanticCacheStores,
} from './query'
import { shouldLookup } from './policies'
import { performLookup } from './lookup'
import { performWrite } from './write'

/**
 * Create the semantic response cache plugin.
 *
 * @param config - Storage, dense embedding, ttl, scope, threshold, and gates.
 * @returns A {@link CruxPlugin} installing the semantic-cache middleware.
 *
 * @example
 * ```ts
 * config({ plugins: [createSemanticCache({ records, vectors, embedding, ttl: 86_400_000, scope: 'global' })] })
 * ```
 */
export function createSemanticCache<TModality extends EmbeddingModality>(
  authoredConfig: SemanticCacheConfig<TModality>,
): CruxPlugin {
  // Capture the caller's supported modalities at the public boundary, then
  // erase the existential parameter for text-only cache internals.
  const config = authoredConfig as unknown as SemanticCacheConfig
  validateConfig(config)

  const namespace = config.namespace ?? DEFAULT_NAMESPACE
  const threshold = config.threshold ?? DEFAULT_THRESHOLD

  return {
    name: 'semantic-cache',
    install() {
      resolveSemanticCacheStores(config)

      return {
        semanticCacheInstalled: true,
        middleware: async (args, next) => {
          const operation = args.operation ?? 'generate'
          const promptHint = normalizePromptHint(args.promptConfig?.cache?.semantic)

          if (!promptHint || promptHint.mode === 'off') {
            return next(args)
          }

          const cacheId = `sc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
          const promptId = args.promptId
          const argInput: Record<string, unknown> = isRecord(args.preparedArgs?.input) ? args.preparedArgs.input : {}
          const input: Record<string, unknown> = args.input ?? argInput
          const preparedArgs: Record<string, unknown> = args.preparedArgs ?? {}
          const scope = await resolveScope(config.scope, { promptId, input, operation, preparedArgs })
          const scopeHash = hashStable(scope)
          const version = promptHint.version
          const effectiveThreshold = Math.max(threshold, promptHint.threshold ?? threshold)
          const ttl = promptHint.ttl === undefined ? config.ttl : Math.min(config.ttl, promptHint.ttl)
          const mode = promptHint.mode
          const toolsPresent = hasTools(args)

          const lookupCtx: SemanticCacheLookupContext = {
            promptId,
            input,
            operation,
            preparedArgs,
            mode,
            toolsPresent,
            threshold: effectiveThreshold,
            version,
          }
          const call: SemanticCacheCall = {
            config,
            namespace,
            args,
            promptHint,
            cacheId,
            scopeHash,
            ttl,
            lookupCtx,
            middlewareNext: next,
          }

          if ((mode === 'readonly' || mode === 'readwrite') && (await shouldLookup(config, lookupCtx))) {
            const cached = await performLookup(call)
            if (cached !== undefined) return cached
          }

          const result = await next(args)

          if (mode !== 'writeonly' && mode !== 'readwrite') {
            return result
          }

          return performWrite(call, result)
        },
      }
    },
  }
}
