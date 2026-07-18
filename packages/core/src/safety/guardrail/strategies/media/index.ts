import type { BoundaryDef, MediaPartSubject, MediaSafetyTargetId } from '../../../boundary'
import type { GuardrailRun, MediaGuardrailRunResult } from '../../types'
import { normalizeMediaGuardrailConfig } from './config'
import { evaluateMediaPolicy } from './evaluate'
import { inspectMediaPart } from './inspect'
import type { MediaGuardrailOptions } from './types'

type MediaBoundary = BoundaryDef<MediaSafetyTargetId, MediaPartSubject>

/**
 * Create a declarative policy callback for canonical input or output media.
 *
 * Inspection uses only metadata and bytes already supplied by the caller; it
 * never fetches a URL or calls a provider. Unknown MIME types fail configured
 * type rules unless `allowUnknown` is enabled. Image signature sniffing is a
 * fallback for undeclared local bytes only—it does not verify declared MIME
 * types against payload contents.
 *
 * @param options - Attachment rules and the action returned for violations.
 * @returns A callback restricted to media-only boundaries.
 *
 * @example
 * ```ts
 * import { boundary, guardrail } from '@use-crux/core/safety'
 *
 * const safeMedia = guardrail({
 *   id: 'safe-media',
 *   on: [boundary.input.media(), boundary.output.media()] as const,
 *   run: guardrail.media({
 *     mediaTypes: {
 *       allow: ['image/png', 'image/jpeg', 'application/pdf'],
 *     },
 *     action: 'block',
 *   }),
 * })
 * ```
 */
export function media(options: MediaGuardrailOptions): GuardrailRun<MediaBoundary> {
  const config = normalizeMediaGuardrailConfig(options)
  const run = async (subject: MediaPartSubject): Promise<MediaGuardrailRunResult> =>
    evaluateMediaPolicy(config, await inspectMediaPart(subject))

  return Object.assign(run, {
    strategy: Object.freeze({
      kind: 'guardrail.media',
      config,
    }),
  })
}

export type {
  MediaGuardrailAction,
  MediaGuardrailOptions,
  MediaSizeGuardrailRule,
  MediaSourceGuardrailRule,
  MediaTypeGuardrailRule,
  MediaTypePattern,
} from './types'
