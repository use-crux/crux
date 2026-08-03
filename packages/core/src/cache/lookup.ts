/**
 * The semantic cache lookup phase.
 *
 * {@link performLookup} embeds the query text, searches the store for a hit
 * above threshold, and on a hit emits hit telemetry + artifact and returns the
 * hydrated (or, for streams, replayed) result. On a miss it emits miss
 * telemetry and returns `undefined`. Wrapped in a `semantic-cache.lookup` span.
 *
 * @module
 */

import { observe } from "../observability";
import type { MiddlewareResult } from "../runtime/types";
import { finalizeCachedCandidate } from "../runtime/internal/cached-candidate-finalizer";
import { attachCachedReleaseSeal } from "../runtime/internal/cached-release-seal";
import { hydrateResult, lookupEntry, resultKindFromArgs } from "./entry";
import {
  emitSemanticCacheArtifact,
  emitSemanticCacheRejection,
} from "./observability";
import {
  hashStable,
  resolveQueryText,
  resolveSemanticCacheStores,
} from "./query";
import type { SemanticCacheCall } from "./types";

/**
 * Run the cache lookup phase for a call.
 *
 * @param call - The per-call cache context.
 * @returns The cached result on a hit, or `undefined` on a miss.
 */
export async function performLookup(
  call: SemanticCacheCall,
): Promise<MiddlewareResult | undefined> {
  const { config, namespace, args, promptHint, cacheId, scopeHash } = call;
  const stores = resolveSemanticCacheStores(config);
  const {
    promptId,
    operation,
    version,
    mode,
    toolsPresent,
    threshold: effectiveThreshold,
  } = call.lookupCtx;

  const lookupStarted = Date.now();
  const lookupSpan = observe.openSpan({
    name: "semantic-cache.lookup",
    primitive: "cache.lookup",
    attributes: {
      cacheKind: "semantic",
      cacheOperation: "lookup",
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
  });

  return lookupSpan.withContext(async () => {
    let queryHash: string | undefined;

    try {
      if (operation === "stream" && !args.createCachedStreamResult) {
        lookupSpan.end({
          attributes: {
            cacheKind: "semantic",
            cacheOperation: "lookup",
            cacheId,
            promptId,
            operation,
            scopeHash,
            version,
            hit: false,
            durationMs: Date.now() - lookupStarted,
          },
        });
        return undefined;
      }
      const queryText = await resolveQueryText(promptHint, args);
      const dense = await config.embedding.embed(queryText);
      queryHash = hashStable(queryText);

      const hit = await lookupEntry(stores.records, stores.search, {
        namespace,
        promptId,
        scopeHash,
        version,
        resultKind: args.outputMode ?? resultKindFromArgs(args),
        dense,
        threshold: effectiveThreshold,
      });

      if (hit) {
        const entry = hit.value;
        const ageMs = Date.now() - entry.createdAt;
        const decision = await finalizeCachedCandidate(
          call.middlewareNext,
          hydrateResult(entry, hit.score),
        );
        if (decision.kind === "reject") {
          emitSemanticCacheRejection({
            spanId: lookupSpan.spanId,
            cacheId,
            promptId,
            operation,
            scopeHash,
            version,
            queryHash,
            category: decision.category,
          });
          lookupSpan.end({
            attributes: {
              cacheKind: "semantic",
              cacheOperation: "lookup",
              cacheId,
              promptId,
              operation,
              scopeHash,
              version,
              queryHash,
              hit: false,
              rejectionCategory: decision.category,
              durationMs: Date.now() - lookupStarted,
            },
          });
          return undefined;
        }
        const accepted = decision.result;
        observe.event({
          name: "semantic-cache.hit",
          attributes: {
            cacheKind: "semantic",
            cacheOperation: "lookup",
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
        });
        emitSemanticCacheArtifact(lookupSpan.spanId, "lookup-hit", {
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
        });
        lookupSpan.end({
          attributes: {
            cacheKind: "semantic",
            cacheOperation: "lookup",
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
          },
        });
        if (operation === "stream") {
          const replay = args.createCachedStreamResult?.({
            text: accepted.text,
            object: accepted.object,
            meta: accepted._meta ? { ...accepted._meta } : undefined,
          });
          if (replay !== undefined) {
            return attachCachedReleaseSeal(replay, {
              resultKind: entry.resultKind,
              text: accepted.text ?? "",
              ...(accepted.object !== undefined
                ? { object: accepted.object }
                : {}),
            });
          }
        }
        return accepted;
      }

      observe.event({
        name: "semantic-cache.miss",
        attributes: {
          cacheKind: "semantic",
          cacheOperation: "lookup",
          cacheId,
          promptId,
          operation,
          scopeHash,
          version,
          queryHash,
        },
      });
      lookupSpan.end({
        attributes: {
          cacheKind: "semantic",
          cacheOperation: "lookup",
          cacheId,
          promptId,
          operation,
          scopeHash,
          version,
          queryHash,
          hit: false,
          durationMs: Date.now() - lookupStarted,
        },
      });
      return undefined;
    } catch (error) {
      lookupSpan.error(error, {
        cacheKind: "semantic",
        cacheOperation: "lookup",
        cacheId,
        promptId,
        operation,
        scopeHash,
        version,
        queryHash,
        hit: false,
        durationMs: Date.now() - lookupStarted,
      });
      throw error;
    }
  });
}
