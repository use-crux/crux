/** Fail-closed runtime validation for JavaScript-shaped guardrail results. */

import type {
  GuardrailRewriteKind,
  GuardrailRunResult,
  MediaGuardrailRunResult,
} from './types'
import { SafetyResultError } from '../errors'
import { validateSafetyFindings } from './findings'

interface ResultValidationOptions {
  readonly policyId?: string
  readonly boundary?: string
}

/** Validate a JavaScript-shaped media guardrail result. */
export function validateMediaGuardrailRunResult(
  value: unknown,
  options: ResultValidationOptions,
): MediaGuardrailRunResult {
  if (!isRecord(value) || typeof value.action !== 'string') {
    throw resultError(
      options,
      'media result must be an object with an action string',
    )
  }

  switch (value.action) {
    case 'allow':
      return { action: 'allow' }
    case 'warn':
    case 'block':
    case 'strip':
      if (typeof value.reason !== 'string' || value.reason.length === 0) {
        throw resultError(
          options,
          `media ${value.action} results require a reason`,
        )
      }
      return { action: value.action, reason: value.reason }
    default:
      throw resultError(
        options,
        `unknown media guardrail action "${value.action}"`,
      )
  }
}

/** Validate a JavaScript-shaped text or structured guardrail result. */
export function validateGuardrailRunResult(
  value: unknown,
  options: ResultValidationOptions & {
    readonly streaming: boolean
    readonly last: boolean
  },
): GuardrailRunResult<unknown> {
  if (!isRecord(value) || typeof value.action !== 'string') {
    throw resultError(options, 'result must be an object with an action string')
  }

  switch (value.action) {
    case 'allow':
      return { action: 'allow' }
    case 'block':
    case 'warn':
      if (typeof value.reason !== 'string' || value.reason.length === 0) {
        throw resultError(options, `${value.action} results require a reason`)
      }
      return { action: value.action, reason: value.reason }
    case 'rewrite': {
      if (!('value' in value)) {
        throw resultError(options, 'rewrite results require a value')
      }
      if (!isRecord(value.rewrite) || !isRewriteKind(value.rewrite.kind)) {
        throw resultError(
          options,
          'rewrite results require a valid rewrite.kind',
        )
      }
      return {
        action: 'rewrite',
        value: value.value,
        rewrite: { kind: value.rewrite.kind },
        ...(value.findings === undefined
          ? {}
          : { findings: validateSafetyFindings(value.findings, options) }),
      }
    }
    case 'hold':
      if (!options.streaming || options.last) {
        throw resultError(
          options,
          'hold is only valid for non-final stream segments',
        )
      }
      return { action: 'hold' }
    default:
      throw resultError(
        options,
        `unknown guardrail action "${value.action}"`,
      )
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRewriteKind(value: unknown): value is GuardrailRewriteKind {
  return (
    value === 'redact' ||
    value === 'mask' ||
    value === 'hash' ||
    value === 'normalize'
  )
}

function resultError(
  options: ResultValidationOptions,
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
