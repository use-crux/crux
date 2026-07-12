/**
 * Nested media observation for ingest describe/transcribe derivation.
 *
 * Opens the canonical media primitive under the active `ingest.parse` span and
 * records a `called` edge so Runs can walk parse → describe/transcribe without
 * inventing a second graph when the application callback already emits its own
 * child operation (for example a bound `media.transcribe` completed operation).
 *
 * @module
 * @internal
 */

import { observe } from '@use-crux/core/observability'
import type { CruxPrimitiveName } from '@use-crux/core/observability'

/**
 * Run an ingest media derivation under its canonical media primitive.
 *
 * @example
 * ```ts
 * const text = await observeIngestMediaCall('media.describe', () =>
 *   describe({ messages }),
 * )
 * ```
 */
export async function observeIngestMediaCall<T>(
  primitive: Extract<
    CruxPrimitiveName,
    'media.describe' | 'media.transcribe'
  >,
  run: () => Promise<T>,
  attributes?: Readonly<Record<string, unknown>>,
): Promise<T> {
  const parentSpanId = observe.captureContext()?.currentSpanId
  const span = observe.openSpan({
    name: primitive.slice('media.'.length),
    primitive,
    implicitRun: false,
    attributes: {
      source: 'ingest',
      ...(attributes ?? {}),
    },
  })
  try {
    const value = await span.withContext(run)
    span.end({ attributes: { status: 'ok' } })
    if (parentSpanId) {
      observe.edge({
        edgeType: 'called',
        from: { kind: 'span', id: parentSpanId },
        to: { kind: 'span', id: span.spanId },
        attributes: { primitive, source: 'ingest' },
      })
    }
    return value
  } catch (error) {
    span.error(error, { status: 'error' })
    throw error
  }
}
