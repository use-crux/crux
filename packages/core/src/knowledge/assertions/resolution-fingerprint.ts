/**
 * Assertion resolution cache fingerprinting.
 *
 * @module
 */

import type { z } from 'zod'
import type { AssertionResolutionPolicy } from './resolution'

/** Fingerprint the resolution policy surface. Internal. */
export function policyFingerprint<TTypes extends Record<string, z.ZodType<unknown>>, TSelected extends keyof TTypes & string>(
  policy: AssertionResolutionPolicy<TTypes, TSelected> | undefined,
): unknown {
  if (!policy) return { mode: 'explicit' }
  if ('model' in policy && policy.model) {
    return {
      id: policy.id,
      version: policy.version,
      mode: 'model',
      model: { name: policy.model.name, fingerprint: policy.model.fingerprint },
      instructions: policy.instructions ?? null,
    }
  }
  return { id: policy.id, version: policy.version, mode: 'run' }
}
