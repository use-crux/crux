import { observe } from '@use-crux/core/observability'
import type { IngestFormat } from './types'

let ingestCounter = 0

export interface IngestParseObservationOptions {
  readonly parser: string
  readonly format: IngestFormat
  readonly namespace: string
  readonly sourceId: string
  readonly byteLength: number
  readonly contentType?: string
}

export interface IngestParseEndAttributes {
  readonly partCount: number
  readonly warningCount: number
}

export interface IngestParseErrorAttributes extends IngestParseEndAttributes {
  readonly phase: 'ingest.parse'
}

export interface IngestParseObservation {
  readonly ingestId: string
  withContext<T>(fn: () => T | Promise<T>): T | Promise<T>
  end(attributes: IngestParseEndAttributes): void
  error(error: unknown, attributes: IngestParseErrorAttributes): void
}

/**
 * Open the canonical `ingest.parse` span around a document parser.
 *
 * The returned observation owns the common span attributes and duration
 * calculation, so parser code only reports parse-specific result counts.
 */
export function openIngestParseObservation(
  options: IngestParseObservationOptions,
): IngestParseObservation {
  const ingestId = `ingest_${Date.now().toString(36)}_${++ingestCounter}`
  const startedAt = Date.now()
  const attributes = {
    ingestId,
    parser: options.parser,
    format: options.format,
    namespace: options.namespace,
    sourceId: options.sourceId,
    byteLength: options.byteLength,
    ...(options.contentType ? { contentType: options.contentType } : {}),
  }
  const span = observe.openSpan({
    name: `parse ${options.format}`,
    primitive: 'ingest.parse',
    attributes,
  })

  return {
    ingestId,
    withContext: span.withContext,
    end(resultAttributes) {
      span.end({
        attributes: {
          ...attributes,
          durationMs: Date.now() - startedAt,
          ...resultAttributes,
        },
      })
    },
    error(error, resultAttributes) {
      span.error(error, {
        ...attributes,
        durationMs: Date.now() - startedAt,
        ...resultAttributes,
      })
    },
  }
}
