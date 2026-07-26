/** Guardrail finding validation, detachment, and per-invocation collection. */

import type {
  SafetyFinding,
  SafetyFindingCollector,
} from '../decision'
import { SafetyResultError } from '../errors'

export interface FindingValidationOptions {
  readonly policyId?: string
  readonly boundary?: string
}

/** One isolated finding collector and its eventual immutable snapshot. */
export interface GuardrailFindingCollection {
  readonly collector: SafetyFindingCollector
  readonly snapshot: () => readonly SafetyFinding[] | undefined
}

/** Create one validating collector for exactly one policy invocation. */
export function createGuardrailFindingCollection(
  options: FindingValidationOptions,
): GuardrailFindingCollection {
  const findings: SafetyFinding[] = []
  return {
    collector: {
      add(finding) {
        findings.push(validateSafetyFinding(finding, options))
      },
    },
    snapshot: () =>
      findings.length === 0 ? undefined : Object.freeze([...findings]),
  }
}

/** Validate and detach a JavaScript-shaped finding array. */
export function validateSafetyFindings(
  value: unknown,
  options: FindingValidationOptions,
): readonly SafetyFinding[] {
  if (!Array.isArray(value)) {
    throw findingError(options, 'findings must be an array')
  }
  return Object.freeze(
    value.map((finding) => validateSafetyFinding(finding, options)),
  )
}

/** Merge collector evidence before result evidence in stable order. */
export function mergeSafetyFindings(
  collected: readonly SafetyFinding[] | undefined,
  returned: readonly SafetyFinding[] | undefined,
): readonly SafetyFinding[] | undefined {
  if (!collected?.length && !returned?.length) return undefined
  return Object.freeze([...(collected ?? []), ...(returned ?? [])])
}

function validateSafetyFinding(
  value: unknown,
  options: FindingValidationOptions,
): SafetyFinding {
  if (!isRecord(value) || typeof value.type !== 'string' || value.type.length === 0) {
    throw findingError(options, 'finding.type must be a non-empty string')
  }
  if (
    value.count !== undefined &&
    (!Number.isInteger(value.count) || (value.count as number) < 0)
  ) {
    throw findingError(options, 'finding.count must be a non-negative integer')
  }
  const span = validateSpan(value.span, options)
  if (
    value.category !== undefined &&
    (typeof value.category !== 'string' || value.category.length === 0)
  ) {
    throw findingError(options, 'finding.category must be a non-empty string')
  }
  validateNormalizedNumber(value.score, 'score', options)
  validateNormalizedNumber(value.threshold, 'threshold', options)

  return Object.freeze({
    type: value.type,
    ...(value.count === undefined ? {} : { count: value.count as number }),
    ...(span ? { span } : {}),
    ...(value.category === undefined ? {} : { category: value.category as string }),
    ...(value.score === undefined ? {} : { score: value.score as number }),
    ...(value.threshold === undefined
      ? {}
      : { threshold: value.threshold as number }),
  })
}

function validateSpan(
  value: unknown,
  options: FindingValidationOptions,
): SafetyFinding['span'] {
  if (value === undefined) return undefined
  if (
    !isRecord(value) ||
    !Number.isInteger(value.start) ||
    !Number.isInteger(value.end) ||
    (value.start as number) < 0 ||
    (value.end as number) < (value.start as number)
  ) {
    throw findingError(
      options,
      'finding.span must contain non-negative integer start/end with end >= start',
    )
  }
  return Object.freeze({
    start: value.start as number,
    end: value.end as number,
  })
}

function validateNormalizedNumber(
  value: unknown,
  field: 'score' | 'threshold',
  options: FindingValidationOptions,
): void {
  if (value === undefined) return
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw findingError(
      options,
      `finding.${field} must be a finite number between 0 and 1`,
    )
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function findingError(
  options: FindingValidationOptions,
  problem: string,
): SafetyResultError {
  const policyId = options.policyId ?? 'unknown'
  const boundary = options.boundary ?? 'unknown'
  return new SafetyResultError({
    message: `Safety policy "${policyId}" returned an invalid result: ${problem}.`,
    policyId,
    boundary,
    problem,
  })
}
