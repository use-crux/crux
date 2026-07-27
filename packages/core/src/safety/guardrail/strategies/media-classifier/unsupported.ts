/** Recognized media-capability handling for the classifier strategy. */

import type { UnsupportedCapabilityError } from '../../../../content/media-errors'
import type { SafetyRunContext } from '../../../decision'
import type { MediaGuardrailRunResult } from '../../types'
import type {
  MediaClassifierUnsupportedAction,
} from './types'

/** Record a capability gap and return its explicitly configured media action. */
export function handleUnsupportedMedia(
  action: MediaClassifierUnsupportedAction,
  error: UnsupportedCapabilityError,
  ctx: SafetyRunContext,
): MediaGuardrailRunResult {
  ctx.findings.add({ type: 'media_not_inspected' })
  if (action === 'allow') return { action: 'allow' }

  return {
    action,
    reason:
      `Media classifier could not inspect this part: adapter "${error.adapter}" ` +
      `model "${error.model}" does not support "${error.capability}".`,
  }
}
