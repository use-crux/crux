import type { DenseEmbedding } from '../embedding'
import { observe } from '../observability'
import type { CruxPlugin } from '../plugin'
import { getRuntime } from '../runtime'
import type { CruxStore, JsonObject, ScoredEntry } from '../store/types'
import type {
  MiddlewareResult,
  PromptMiddlewareArgs,
  SemanticCacheMode,
  SemanticCachePromptOptions,
  SemanticCacheQueryContext,
} from '../types'

export interface SemanticCacheScopeContext {
  promptId: string | undefined
  input: Record<string, unknown>
  operation: 'generate' | 'stream'
  preparedArgs: Record<string, unknown>
}

export interface SemanticCacheLookupContext extends SemanticCacheScopeContext {
  mode: SemanticCacheMode
  toolsPresent: boolean
  threshold: number
  version: string
}

export interface SemanticCacheWriteContext extends SemanticCacheLookupContext {
  result: unknown
  finishReason?: string
  toolCallsPresent: boolean
  error?: unknown
}

export interface SemanticCacheConfig {
  store: CruxStore
  embedding: DenseEmbedding
  ttl: number
  threshold?: number
  namespace?: string
  scope: 'global' | ((ctx: SemanticCacheScopeContext) => string | Promise<string>)
  replay?: {
    chunkSize?: number
    delayMs?: number
  }
  shouldLookup?: (ctx: SemanticCacheLookupContext) => boolean | Promise<boolean>
  shouldCache?: (ctx: SemanticCacheWriteContext) => boolean | Promise<boolean>
}

interface NormalizedPromptHint {
  mode: SemanticCacheMode
  version: string
  ttl?: number
  threshold?: number
  query?: SemanticCachePromptOptions['query']
}

interface SemanticCacheEntry extends JsonObject {
  cruxType: 'semantic-cache-entry'
  namespace: string
  promptId?: string
  scopeHash: string
  version: string
  queryHash: string
  queryText: string
  embedding: number[]
  resultKind: 'text' | 'object'
  result: {
    text?: string
    object?: unknown
    finishReason?: string
    usage?: Record<string, unknown>
    meta?: Record<string, unknown>
  }
  createdAt: number
  updatedAt: number
  expiresAt: number
}

const DEFAULT_NAMESPACE = 'default'
const DEFAULT_VERSION = 'v1'
const DEFAULT_THRESHOLD = 0.95
const warnedPrompts = new Set<string>()

export function createSemanticCache(config: SemanticCacheConfig): CruxPlugin {
  validateConfig(config)

  const namespace = config.namespace ?? DEFAULT_NAMESPACE
  const threshold = config.threshold ?? DEFAULT_THRESHOLD

  return {
    name: 'semantic-cache',
    install() {
      validateStore(config.store)

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

          if ((mode === 'readonly' || mode === 'readwrite') && (await shouldLookup(config, lookupCtx))) {
            const lookupStarted = Date.now()
            const lookupSpan = observe.openSpan({
              name: 'semantic-cache.lookup',
              family: 'cache',
              primitive: 'cache.lookup',
              attributes: {
                cacheKind: 'semantic',
                cacheOperation: 'lookup',
                cacheId,
                namespace,
                promptId,
                operation,
                scopeHash,
                version,
                threshold: effectiveThreshold,
                mode,
                toolsPresent,
                resultKind: args.outputMode ?? resultKindFromArgs(args),
              },
            })

            const cached = await lookupSpan.withContext(async () => {
              let queryHash: string | undefined

              try {
                const queryText = await resolveQueryText(promptHint, args)
                const dense = await config.embedding.embed(queryText)
                queryHash = hashStable(queryText)

                getRuntime().instrumentationHooks?.onSemanticCacheLookupStart?.({
                  cacheId,
                  promptId,
                  operation,
                  scopeHash,
                  version,
                  threshold: effectiveThreshold,
                })

                const hit = await lookupEntry(config.store, {
                  namespace,
                  promptId,
                  scopeHash,
                  version,
                  resultKind: args.outputMode ?? resultKindFromArgs(args),
                  dense,
                  threshold: effectiveThreshold,
                })

                getRuntime().instrumentationHooks?.onSemanticCacheLookupEnd?.({
                  cacheId,
                  promptId,
                  operation,
                  scopeHash,
                  version,
                  durationMs: Date.now() - lookupStarted,
                  hit: Boolean(hit),
                  score: hit?.score,
                })

                if (hit) {
                  const entry = hit.value as SemanticCacheEntry
                  const ageMs = Date.now() - entry.createdAt
                  getRuntime().instrumentationHooks?.onSemanticCacheHit?.({
                    cacheId,
                    promptId,
                    operation,
                    scopeHash,
                    version,
                    score: hit.score,
                    ageMs,
                  })
                  observe.event({
                    name: 'semantic-cache.hit',
                    attributes: {
                      cacheKind: 'semantic',
                      cacheOperation: 'lookup',
                      cacheId,
                      promptId,
                      operation,
                      scopeHash,
                      version,
                      queryHash,
                      score: hit.score,
                      ageMs,
                      resultKind: entry.resultKind,
                    },
                  })
                  emitSemanticCacheArtifact(lookupSpan.spanId, 'lookup-hit', {
                    cacheId,
                    promptId,
                    operation,
                    scopeHash,
                    version,
                    queryHash,
                    score: hit.score,
                    ageMs,
                    resultKind: entry.resultKind,
                    hit: true,
                  })
                  lookupSpan.end({
                    cacheKind: 'semantic',
                    cacheOperation: 'lookup',
                    cacheId,
                    promptId,
                    operation,
                    scopeHash,
                    version,
                    queryHash,
                    hit: true,
                    score: hit.score,
                    ageMs,
                    durationMs: Date.now() - lookupStarted,
                  })
                  if (operation === 'stream') {
                    getRuntime().instrumentationHooks?.onSemanticCacheReplayStart?.({
                      cacheId,
                      promptId,
                      scopeHash,
                      version,
                    })
                    const replayStarted = Date.now()
                    const replay = args.createCachedStreamResult?.({
                      text: entry.result.text,
                      object: entry.result.object,
                      meta: buildHitMeta(entry, hit.score),
                    })
                    getRuntime().instrumentationHooks?.onSemanticCacheReplayEnd?.({
                      cacheId,
                      promptId,
                      scopeHash,
                      version,
                      durationMs: Date.now() - replayStarted,
                    })
                    if (replay !== undefined) return replay
                  }
                  return hydrateResult(entry, hit.score)
                }

                observe.event({
                  name: 'semantic-cache.miss',
                  attributes: {
                    cacheKind: 'semantic',
                    cacheOperation: 'lookup',
                    cacheId,
                    promptId,
                    operation,
                    scopeHash,
                    version,
                    queryHash,
                  },
                })
                getRuntime().instrumentationHooks?.onSemanticCacheMiss?.({
                  cacheId,
                  promptId,
                  operation,
                  scopeHash,
                  version,
                })
                lookupSpan.end({
                  cacheKind: 'semantic',
                  cacheOperation: 'lookup',
                  cacheId,
                  promptId,
                  operation,
                  scopeHash,
                  version,
                  queryHash,
                  hit: false,
                  durationMs: Date.now() - lookupStarted,
                })
                return undefined
              } catch (error) {
                getRuntime().instrumentationHooks?.onSemanticCacheLookupEnd?.({
                  cacheId,
                  promptId,
                  operation,
                  scopeHash,
                  version,
                  durationMs: Date.now() - lookupStarted,
                  hit: false,
                  error: error instanceof Error ? error.message : String(error),
                })
                lookupSpan.error(error, {
                  cacheKind: 'semantic',
                  cacheOperation: 'lookup',
                  cacheId,
                  promptId,
                  operation,
                  scopeHash,
                  version,
                  queryHash,
                  hit: false,
                  durationMs: Date.now() - lookupStarted,
                })
                throw error
              }
            })
            if (cached !== undefined) return cached
          }

          const result = await next(args)
          const cacheableResult = result as unknown as CacheableResult

          if (mode !== 'writeonly' && mode !== 'readwrite') {
            return result
          }

          const writeCtx: SemanticCacheWriteContext = {
            ...lookupCtx,
            result,
            finishReason: extractFinishReason(cacheableResult),
            toolCallsPresent: extractToolCalls(cacheableResult).length > 0,
          }

          if (!(await shouldCache(config, writeCtx))) {
            getRuntime().instrumentationHooks?.onSemanticCacheSkip?.({
              cacheId,
              promptId,
              operation,
              reason: 'shouldCache returned false',
            })
            emitSemanticCacheSkipSpan({
              cacheId,
              namespace,
              promptId,
              operation,
              scopeHash,
              version,
              mode,
              reason: 'shouldCache returned false',
            })
            return result
          }

          const writeStarted = Date.now()
          const writeSpan = observe.openSpan({
            name: 'semantic-cache.write',
            family: 'cache',
            primitive: 'cache.lookup',
            attributes: {
              cacheKind: 'semantic',
              cacheOperation: 'write',
              cacheId,
              namespace,
              promptId,
              operation,
              scopeHash,
              version,
              mode,
              ttl,
            },
          })

          try {
            await writeSpan.withContext(async () => {
              const queryText = await resolveQueryText(promptHint, args)
              const dense = await config.embedding.embed(queryText)
              const now = Date.now()
              const resultKind = args.outputMode ?? resultKindFromResult(cacheableResult)
              const entry: SemanticCacheEntry = {
                cruxType: 'semantic-cache-entry',
                namespace,
                ...(promptId ? { promptId } : {}),
                scopeHash,
                version,
                queryHash: hashStable(queryText),
                queryText,
                embedding: dense,
                resultKind,
                result: serializeResult(cacheableResult, resultKind),
                createdAt: now,
                updatedAt: now,
                expiresAt: now + ttl,
              }

              await config.store.set(cacheKey(namespace, promptId, scopeHash, version, entry.queryHash), entry, { ttl })
              observe.event({
                name: 'semantic-cache.write',
                attributes: {
                  cacheKind: 'semantic',
                  cacheOperation: 'write',
                  cacheId,
                  promptId,
                  operation,
                  scopeHash,
                  version,
                  queryHash: entry.queryHash,
                  ttl,
                  resultKind,
                },
              })
              emitSemanticCacheArtifact(writeSpan.spanId, 'write', {
                cacheId,
                promptId,
                operation,
                scopeHash,
                version,
                queryHash: entry.queryHash,
                ttl,
                resultKind,
                written: true,
              })
              getRuntime().instrumentationHooks?.onSemanticCacheWrite?.({
                cacheId,
                promptId,
                operation,
                scopeHash,
                version,
                ttl,
                resultKind,
              })

              writeSpan.end({
                cacheKind: 'semantic',
                cacheOperation: 'write',
                cacheId,
                promptId,
                operation,
                scopeHash,
                version,
                queryHash: entry.queryHash,
                ttl,
                resultKind,
                written: true,
                durationMs: Date.now() - writeStarted,
              })
            })
          } catch (error) {
            writeSpan.error(error, {
              cacheKind: 'semantic',
              cacheOperation: 'write',
              cacheId,
              promptId,
              operation,
              scopeHash,
              version,
              ttl,
              durationMs: Date.now() - writeStarted,
            })
            throw error
          }

          attachMissMeta(result)
          return result
        },
      }
    },
  }
}

function emitSemanticCacheArtifact(
  spanId: ReturnType<typeof observe.openSpan>['spanId'],
  event: 'lookup-hit' | 'write',
  preview: JsonObject,
): void {
  const artifactId = observe.artifact({
    kind: 'cache.report',
    contentType: 'application/json',
    encoding: 'json',
    preview: {
      kind: 'cache.report',
      cacheKind: 'semantic',
      status: event === 'lookup-hit' ? 'hit' : 'write',
      event,
      ...preview,
    },
    attributes: {
      primitive: 'cache.lookup',
      cacheKind: 'semantic',
      event,
      cacheId: preview.cacheId,
      promptId: preview.promptId,
      operation: preview.operation,
      scopeHash: preview.scopeHash,
      version: preview.version,
      queryHash: preview.queryHash,
    },
  })
  if (!artifactId) return
  observe.edge({
    edgeType: 'produced',
    from: { kind: 'span', id: spanId },
    to: { kind: 'artifact', id: artifactId },
    attributes: { primitive: 'cache.lookup', cacheKind: 'semantic', event },
  })
}

function emitSemanticCacheSkipSpan(args: {
  cacheId: string
  namespace: string
  promptId: string | undefined
  operation: 'generate' | 'stream'
  scopeHash: string
  version: string
  mode: SemanticCacheMode
  reason: string
}): void {
  const span = observe.openSpan({
    name: 'semantic-cache.skip',
    family: 'cache',
    primitive: 'cache.lookup',
    attributes: {
      cacheKind: 'semantic',
      cacheOperation: 'skip',
      cacheId: args.cacheId,
      namespace: args.namespace,
      promptId: args.promptId,
      operation: args.operation,
      scopeHash: args.scopeHash,
      version: args.version,
      mode: args.mode,
      reason: args.reason,
    },
  })
  span.withContext(() => {
    observe.event({
      name: 'semantic-cache.skip',
      attributes: {
        cacheKind: 'semantic',
        cacheOperation: 'skip',
        cacheId: args.cacheId,
        promptId: args.promptId,
        operation: args.operation,
        reason: args.reason,
      },
    })
  })
  span.end({
    cacheKind: 'semantic',
    cacheOperation: 'skip',
    cacheId: args.cacheId,
    promptId: args.promptId,
    operation: args.operation,
    scopeHash: args.scopeHash,
    version: args.version,
    skipped: true,
    reason: args.reason,
  })
}

export const semanticCachePolicies = {
  finishReason:
    (...allowed: string[]) =>
    (ctx: SemanticCacheWriteContext) =>
      ctx.finishReason === undefined || allowed.includes(ctx.finishReason),
  noErrors: () => (ctx: SemanticCacheWriteContext) => ctx.error === undefined,
  promptIds:
    (ids: readonly string[]) =>
    (ctx: SemanticCacheLookupContext | SemanticCacheWriteContext) =>
      ctx.promptId !== undefined && ids.includes(ctx.promptId),
  skipWhenToolsPresent: () => (ctx: SemanticCacheLookupContext) => !ctx.toolsPresent,
  skipWhenToolCallsPresent: () => (ctx: SemanticCacheWriteContext) => !ctx.toolCallsPresent,
  all:
    <T>(policies: Array<(ctx: T) => boolean | Promise<boolean>>) =>
    async (ctx: T) => {
      for (const policy of policies) {
        if (!(await policy(ctx))) return false
      }
      return true
    },
  any:
    <T>(policies: Array<(ctx: T) => boolean | Promise<boolean>>) =>
    async (ctx: T) => {
      for (const policy of policies) {
        if (await policy(ctx)) return true
      }
      return false
    },
  not:
    <T>(policy: (ctx: T) => boolean | Promise<boolean>) =>
    async (ctx: T) =>
      !(await policy(ctx)),
  defaultShouldLookup: () => () => true,
  defaultShouldCache: () => semanticCachePolicies.finishReason('stop'),
}

export function warnMissingSemanticCachePlugin(promptId: string | undefined): void {
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') return
  const key = promptId ?? '<anonymous>'
  if (warnedPrompts.has(key)) return
  warnedPrompts.add(key)
  console.warn(
    `Crux semantic cache is configured on prompt "${key}" but no createSemanticCache() plugin is installed.`,
  )
}

function validateConfig(config: SemanticCacheConfig): void {
  if (config.embedding.kind !== 'dense') {
    throw new Error('createSemanticCache() requires a dense embedding. Sparse and hybrid cache lookup are out of scope.')
  }
  if (!Number.isFinite(config.ttl) || config.ttl <= 0) {
    throw new Error('createSemanticCache() requires ttl to be greater than 0.')
  }
}

function validateStore(store: CruxStore): void {
  const capabilities = store.capabilities?.()
  if (!capabilities?.semanticCache?.isolatedVectorNamespace) {
    throw new Error(
      'createSemanticCache() requires a CruxStore with isolated semantic-cache vector namespace support.',
    )
  }
  if (!store.searchVectors && !store.vectorSearch) {
    throw new Error('createSemanticCache() requires a store with dense vector search support.')
  }
}

function normalizePromptHint(value: unknown): NormalizedPromptHint | null {
  if (value === undefined || value === false) return null
  if (value === true) return { mode: 'readwrite', version: DEFAULT_VERSION }
  const options = value as SemanticCachePromptOptions
  return {
    mode: options.mode ?? 'readwrite',
    version: options.version ?? DEFAULT_VERSION,
    ttl: options.ttl,
    threshold: options.threshold,
    query: options.query,
  }
}

async function resolveScope(
  scope: SemanticCacheConfig['scope'],
  ctx: SemanticCacheScopeContext,
): Promise<string> {
  if (scope === 'global') return 'global'
  const value = await scope(ctx)
  if (!value) throw new Error('createSemanticCache() scope resolved to an empty value.')
  return value
}

async function resolveQueryText(hint: NormalizedPromptHint, args: PromptMiddlewareArgs): Promise<string> {
  const resolved = args.resolved
  if (hint.query && resolved) {
    const preparedInput: Record<string, unknown> = isRecord(args.preparedArgs?.input) ? args.preparedArgs.input : {}
    const ctx: SemanticCacheQueryContext = {
      promptId: args.promptId,
      input: args.input ?? preparedInput,
      resolved,
      preparedArgs: args.preparedArgs ?? {},
      operation: args.operation ?? 'generate',
    }
    return hint.query(ctx)
  }
  if (resolved?.messages) {
    return resolved.messages.map((message) => `${message.role}: ${String(message.content)}`).join('\n')
  }
  return [resolved?.system, resolved?.prompt, fallbackPreparedText(args)].filter(Boolean).join('\n\n')
}

function fallbackPreparedText(args: PromptMiddlewareArgs): string {
  const prepared: Record<string, unknown> = args.preparedArgs ?? {}
  if (Array.isArray(prepared.messages)) {
    return prepared.messages
      .map((message) => {
        const m = message as { role?: unknown; content?: unknown }
        return `${String(m.role ?? '')}: ${String(m.content ?? '')}`
      })
      .join('\n')
  }
  if (typeof prepared.prompt === 'string') return prepared.prompt
  return JSON.stringify(args.input ?? prepared.input ?? {})
}

async function lookupEntry(
  store: CruxStore,
  query: {
    namespace: string
    promptId?: string
    scopeHash: string
    version: string
    resultKind: 'text' | 'object'
    dense: number[]
    threshold: number
  },
): Promise<ScoredEntry | null> {
  const filter = {
    cruxType: 'semantic-cache-entry',
    namespace: query.namespace,
    ...(query.promptId ? { promptId: query.promptId } : {}),
    scopeHash: query.scopeHash,
    version: query.version,
    resultKind: query.resultKind,
  }
  const results = store.searchVectors
    ? await store.searchVectors({ dense: query.dense, threshold: query.threshold, limit: 1, filter })
    : await store.vectorSearch!(query.dense, { threshold: query.threshold, limit: 1, filter })
  return results[0] ?? null
}

async function shouldLookup(config: SemanticCacheConfig, ctx: SemanticCacheLookupContext): Promise<boolean> {
  return config.shouldLookup ? config.shouldLookup(ctx) : true
}

async function shouldCache(config: SemanticCacheConfig, ctx: SemanticCacheWriteContext): Promise<boolean> {
  return config.shouldCache ? config.shouldCache(ctx) : semanticCachePolicies.defaultShouldCache()(ctx)
}

/** Structural shape of result `_meta` fields read by the semantic cache. */
interface CacheableResultMeta {
  finishReason?: string
  usage?: Record<string, unknown> | { inputTokens?: number; outputTokens?: number; totalTokens?: number; [key: string]: unknown }
  toolCalls?: unknown[]
  [key: string]: unknown
}

/** Structural shape of generate-result values cached/replayed by the semantic cache. */
interface CacheableResult {
  text?: string
  object?: unknown
  finishReason?: string
  usage?: Record<string, unknown> | { inputTokens?: number; outputTokens?: number; totalTokens?: number; [key: string]: unknown }
  toolCalls?: unknown[]
  _meta?: CacheableResultMeta
}

function serializeResult(result: CacheableResult | undefined, resultKind: 'text' | 'object'): SemanticCacheEntry['result'] {
  const meta = result?._meta ?? {}
  return {
    ...(typeof result?.text === 'string' ? { text: result.text } : {}),
    ...(resultKind === 'object' && result?.object !== undefined ? { object: result.object } : {}),
    finishReason: meta.finishReason ?? result?.finishReason,
    usage: meta.usage ?? result?.usage,
    meta,
  }
}

function hydrateResult(entry: SemanticCacheEntry, score: number): MiddlewareResult {
  return {
    ...(entry.result.text !== undefined ? { text: entry.result.text } : {}),
    ...(entry.result.object !== undefined ? { object: entry.result.object } : {}),
    _meta: buildHitMeta(entry, score) as MiddlewareResult['_meta'],
  }
}

function buildHitMeta(entry: SemanticCacheEntry, score: number): Record<string, unknown> {
  return {
    ...(entry.result.meta ?? {}),
    usage: entry.result.usage,
    finishReason: entry.result.finishReason,
    semanticCache: {
      hit: true,
      score,
      ageMs: Date.now() - entry.createdAt,
      scopeHash: entry.scopeHash,
      version: entry.version,
    },
  }
}

function attachMissMeta(result: unknown): void {
  if (!result || typeof result !== 'object') return
  const ref = result as CacheableResult
  ref._meta = {
    ...(ref._meta ?? {}),
    semanticCache: { hit: false, written: true },
  }
}

function hasTools(args: PromptMiddlewareArgs): boolean {
  const tools = args.preparedArgs?.tools
  if (Array.isArray(tools)) return tools.length > 0
  if (tools && typeof tools === 'object') return Object.keys(tools).length > 0
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function extractToolCalls(result: CacheableResult | undefined): unknown[] {
  return result?._meta?.toolCalls ?? result?.toolCalls ?? []
}

function extractFinishReason(result: CacheableResult | undefined): string | undefined {
  return result?._meta?.finishReason ?? result?.finishReason
}

function resultKindFromArgs(args: PromptMiddlewareArgs): 'text' | 'object' {
  return args.outputMode ?? (args.resolved?.schema ? 'object' : 'text')
}

function resultKindFromResult(result: CacheableResult | undefined): 'text' | 'object' {
  return result?.object !== undefined ? 'object' : 'text'
}

function cacheKey(namespace: string, promptId: string | undefined, scopeHash: string, version: string, queryHash: string): string {
  return `crux:semantic-cache:${namespace}:${promptId ?? 'anonymous'}:${scopeHash}:${version}:${queryHash}`
}

function hashStable(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  let hash = 5381
  for (let index = 0; index < text.length; index++) {
    hash = (hash * 33) ^ text.charCodeAt(index)
  }
  return (hash >>> 0).toString(36)
}
