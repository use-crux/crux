/**
 * Type contracts for the semantic response cache.
 *
 * Public surface: the scope/lookup/write context shapes passed to user policy
 * callbacks and {@link SemanticCacheConfig}. The remaining types (normalized
 * prompt hints, the stored cache entry, the cacheable result shape, and the
 * per-call context threaded through the lookup/write phases) are internal to
 * the domain.
 *
 * @module
 */

import type { DenseEmbedding, EmbeddingModality } from "../embedding";
import type { JsonObject, RecordStore, SearchStore, Storage } from "../storage";
import type { PromptMiddleware, PromptMiddlewareArgs } from "../runtime/types";
import type {
  SemanticCacheMode,
  SemanticCachePromptOptions,
} from "../prompt/prompt-types";
import type { TokenUsage } from "../generation/types";
import type { SerializedStructuredCandidateV1 } from "../runtime/internal/cached-structured-candidate";

/** Context for resolving a cache scope key for a single call. */
export interface SemanticCacheScopeContext {
  promptId: string | undefined;
  input: Record<string, unknown>;
  operation: "generate" | "stream";
  preparedArgs: Record<string, unknown>;
}

/** Context passed to `shouldLookup`, extending scope with resolved cache params. */
export interface SemanticCacheLookupContext extends SemanticCacheScopeContext {
  mode: SemanticCacheMode;
  toolsPresent: boolean;
  threshold: number;
  version: string;
}

/** Context passed to `shouldCache`, extending lookup with the produced result. */
export interface SemanticCacheWriteContext extends SemanticCacheLookupContext {
  result: unknown;
  finishReason?: string;
  toolCallsPresent: boolean;
  error?: unknown;
}

/** Configuration for {@link createSemanticCache}. */
export interface SemanticCacheConfig<
  TModality extends EmbeddingModality = "text",
> {
  storage?: Storage;
  records?: RecordStore;
  search?: SearchStore;
  embedding: DenseEmbedding<TModality>;
  ttl: number;
  threshold?: number;
  namespace?: string;
  scope:
    | "global"
    | ((ctx: SemanticCacheScopeContext) => string | Promise<string>);
  replay?: {
    chunkSize?: number;
    delayMs?: number;
  };
  shouldLookup?: (
    ctx: SemanticCacheLookupContext,
  ) => boolean | Promise<boolean>;
  shouldCache?: (ctx: SemanticCacheWriteContext) => boolean | Promise<boolean>;
}

/** Normalized form of the per-prompt `cache.semantic` hint. Internal. */
export interface NormalizedPromptHint {
  mode: SemanticCacheMode;
  version: string;
  ttl?: number;
  threshold?: number;
  query?: SemanticCachePromptOptions["query"];
}

/** The cache entry persisted to the semantic-cache record store. Internal. */
export interface SemanticCacheEntry {
  cruxType: "semantic-cache-entry";
  namespace: string;
  promptId?: string;
  scopeHash: string;
  version: string;
  queryHash: string;
  queryText: string;
  embedding: number[];
  resultKind: "text" | "object";
  result: {
    text?: string;
    object?: unknown;
    finishReason?: string;
    usage?: TokenUsage | Record<string, unknown>;
    meta?: Record<string, unknown>;
    /** Private accepted canonical `z.input` for structured hit re-evaluation. */
    structuredCandidate?: SerializedStructuredCandidateV1;
  };
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

/** Structural shape of result `_meta` fields read by the semantic cache. Internal. */
export interface CacheableResultMeta {
  finishReason?: string;
  usage?: TokenUsage | Record<string, unknown>;
  toolCalls?: unknown[];
  [key: string]: unknown;
}

/** Structural shape of generate-result values cached/replayed by the semantic cache. Internal. */
export interface CacheableResult {
  text?: string;
  object?: unknown;
  finishReason?: string;
  usage?: TokenUsage | Record<string, unknown>;
  toolCalls?: unknown[];
  _meta?: CacheableResultMeta;
}

/**
 * Per-call context threaded through the lookup and write phases. Internal.
 *
 * Carries the immutable config/namespace plus the values derived once per call
 * (ids, scope hash, ttl, and the {@link SemanticCacheLookupContext}) so the
 * phase functions stay parameterized rather than closing over the middleware.
 */
export interface SemanticCacheCall {
  config: SemanticCacheConfig;
  namespace: string;
  args: PromptMiddlewareArgs;
  promptHint: NormalizedPromptHint;
  cacheId: string;
  scopeHash: string;
  ttl: number;
  lookupCtx: SemanticCacheLookupContext;
  /** Root-aware middleware continuation carrying private adapter capabilities. */
  middlewareNext: Parameters<PromptMiddleware>[1];
}
