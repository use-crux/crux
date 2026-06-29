/**
 * Instrumentation for workspace operations.
 *
 * Wraps each operation in an {@link observe} span, emits an output artifact with
 * a redacted preview (file contents are never stored), and forwards a structured
 * event to the runtime's instrumentation hooks.
 *
 * @module
 */

import { observe } from '../observability'
import type { WorkspaceProvenance } from './artifact-types'
import type { WorkspaceOperation } from './types'

interface WorkspaceEvent {
  readonly workspaceId: string
  readonly operation: WorkspaceOperation
  readonly namespace: string
  readonly path: string
}

/** Capture artifact provenance from an already-active caller run/span. */
export function activeWorkspaceProvenance(): WorkspaceProvenance | undefined {
  const context = observe.captureContext()
  if (!context) return undefined
  return {
    runId: context.runId,
    ...(context.currentSpanId ? { spanId: context.currentSpanId } : {}),
  }
}

/** Run a workspace operation inside a span, emitting artifacts, hooks, and timings. */
export async function instrument<T>(event: WorkspaceEvent, run: () => Promise<T>): Promise<T> {
  const start = Date.now()
  const span = observe.openSpan({
    name: `workspace.${event.operation}`,
    family: 'workspace',
    primitive: 'workspace.operation',
    attributes: {
      workspaceId: event.workspaceId,
      operation: event.operation,
      namespaceHash: hashString(event.namespace),
      pathHash: hashString(event.path),
    },
  })
  try {
    const result = await span.withContext(run)
    span.withContext(() => emitWorkspaceArtifact(span.spanId, event, result))
    const resultAttributes = workspaceResultAttributes(result)
    span.end({
      attributes: {
        workspaceId: event.workspaceId,
        operation: event.operation,
        namespaceHash: hashString(event.namespace),
        pathHash: hashString(event.path),
        status: 'success',
        ...resultAttributes,
      },
    })
    return result
  } catch (error) {
    span.error(error, {
      workspaceId: event.workspaceId,
      operation: event.operation,
      namespaceHash: hashString(event.namespace),
      pathHash: hashString(event.path),
      status: 'error',
    })
    throw error
  }
}

function emitWorkspaceArtifact(
  spanId: ReturnType<typeof observe.openSpan>['spanId'],
  event: WorkspaceEvent,
  result: unknown,
): void {
  const preview = workspaceResultPreview(result)
  if (preview === undefined) return
  const artifactId = observe.artifact({
    kind: 'output',
    contentType: 'application/json',
    encoding: 'json',
    preview,
    attributes: {
      primitive: 'workspace.operation',
      workspaceId: event.workspaceId,
      operation: event.operation,
      namespaceHash: hashString(event.namespace),
      pathHash: hashString(event.path),
      ...workspaceResultAttributes(result),
    },
  })
  if (!artifactId) return
  observe.edge({
    edgeType: 'produced',
    from: { kind: 'span', id: spanId },
    to: { kind: 'artifact', id: artifactId },
    attributes: { primitive: 'workspace.operation', operation: event.operation, workspaceId: event.workspaceId },
  })
}

function workspaceResultPreview(result: unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== 'object') return undefined
  const record = result as Record<string, unknown>
  if (Array.isArray(record.entries)) {
    return {
      resultKind: 'list',
      entryCount: record.entries.length,
      entries: record.entries.slice(0, 50).map((entry) => workspaceEntryPreview(entry)),
    }
  }
  if (record.kind === 'file') {
    return {
      resultKind: 'file',
      path: record.path,
      mimeType: record.mimeType,
      size: record.size,
      storage: record.storage,
      metadata: record.metadata,
    }
  }
  if (record.kind === 'text' || record.kind === 'json' || record.kind === 'binary') {
    return {
      resultKind: record.kind,
      path: record.path,
      mimeType: record.mimeType,
      size: record.size,
      metadata: record.metadata,
      preview: typeof record.preview === 'string' ? record.preview.slice(0, 500) : undefined,
      contentStored: false,
    }
  }
  return undefined
}

function workspaceEntryPreview(entry: unknown): Record<string, unknown> {
  if (!entry || typeof entry !== 'object') return { kind: 'unknown' }
  const record = entry as Record<string, unknown>
  return {
    kind: record.kind,
    path: record.path,
    mimeType: record.mimeType,
    size: record.size,
    storage: record.storage,
  }
}

function workspaceResultAttributes(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== 'object') return {}
  const record = result as Record<string, unknown>
  if (Array.isArray(record.entries)) return { resultKind: 'list', entryCount: record.entries.length }
  if (typeof record.kind === 'string') {
    return {
      resultKind: record.kind,
      ...(typeof record.mimeType === 'string' ? { mimeType: record.mimeType } : {}),
      ...(typeof record.size === 'number' ? { size: record.size } : {}),
      ...(typeof record.storage === 'string' ? { storage: record.storage } : {}),
    }
  }
  return {}
}

function hashString(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`
}
