/**
 * Observability emission for the semantic cache.
 *
 * Emits the `cache.report` artifact (linked to the active span) for lookup
 * hits and writes, and opens/closes the `semantic-cache.skip` span when a write
 * is skipped. Internal to the cache domain.
 *
 * @module
 */

import { observe } from '../observability'
import type { JsonObject } from '../store/types'
import type { SemanticCacheMode } from '../types'

/** Emit a `cache.report` artifact for a lookup hit or write and link it to the span. */
export function emitSemanticCacheArtifact(
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

/** Open and immediately close a `semantic-cache.skip` span explaining the skip. */
export function emitSemanticCacheSkipSpan(args: {
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
