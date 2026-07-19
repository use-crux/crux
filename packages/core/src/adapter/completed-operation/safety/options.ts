import type { Constraint } from '../../../safety/constraint/types'
import type { Guardrail } from '../../../safety/guardrail/types'
import type { SafetyTuneOptions } from '../../../safety/tune'

/** Internal portable Safety fields threaded through a completed operation. */
export interface CompletedOperationSafetyOptions {
  readonly guardrails?: readonly Guardrail[]
  readonly constraints?: readonly Constraint[]
  readonly safety?: SafetyTuneOptions
}
