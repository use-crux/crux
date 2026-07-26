import { SafetyConfigError } from './errors'

/** Per-policy posture overrides allowed at a call site. */
export interface SafetyTunePolicyOptions {
  readonly mode?: 'enforce' | 'report'
  readonly enabled?: boolean
}

/** Explicit per-call safety tuning keyed by policy id. */
export interface SafetyTuneOptions {
  readonly tune?: Readonly<Record<string, SafetyTunePolicyOptions>>
}

export type SafetyTuneField = keyof SafetyTunePolicyOptions

const allowedTuneFields = new Set<SafetyTuneField>(['mode', 'enabled'])

/** Validate that a tune object only refers to known policies and allowed fields. */
export function validateSafetyTuneOptions(
  options: SafetyTuneOptions | undefined,
  knownPolicyIds?: ReadonlySet<string>,
): Readonly<Record<string, SafetyTunePolicyOptions>> {
  const tune = options?.tune ?? {}
  for (const [policyId, value] of Object.entries(tune)) {
    if (knownPolicyIds && !knownPolicyIds.has(policyId)) {
      throw new SafetyConfigError({
        message: `Unknown safety tune id "${policyId}".`,
      })
    }
    validateTunePolicyOptions(policyId, value)
  }
  return tune
}

function validateTunePolicyOptions(policyId: string, value: SafetyTunePolicyOptions): void {
  if (typeof value !== 'object' || value === null) {
    throw new SafetyConfigError({
      message: `Safety tune for "${policyId}" must be an object.`,
    })
  }
  for (const field of Object.keys(value)) {
    if (!allowedTuneFields.has(field as SafetyTuneField)) {
      throw new SafetyConfigError({
        message: `Safety tune for "${policyId}" cannot set "${field}". Allowed fields: mode, enabled.`,
      })
    }
  }
  if (value.mode !== undefined && value.mode !== 'enforce' && value.mode !== 'report') {
    throw new SafetyConfigError({
      message: `Safety tune for "${policyId}" has invalid mode "${String(value.mode)}".`,
    })
  }
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
    throw new SafetyConfigError({
      message: `Safety tune for "${policyId}" has invalid enabled value.`,
    })
  }
}
