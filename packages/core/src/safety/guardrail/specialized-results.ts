/**
 * Closed guardrail result families for specialized Safety boundaries.
 *
 * @module
 */

import type { SafetyFinding } from '../decision'
import { SafetyResultError } from '../errors'
import { validateSafetyFindings } from './findings'
import type { GuardrailRewriteKind } from './types'

/**
 * Result returned by a root tool-definition guardrail.
 *
 * @remarks
 * Enforcing `strip` removes the tool from provider exposure and executable
 * registration. Report mode records strip or block intent without changing
 * the exposed set.
 */
export type ToolDefinitionGuardrailResult =
  | {
      /** Retain the tool definition. */
      readonly action: 'allow'
    }
  | {
      /** Retain the tool definition and record a warning. */
      readonly action: 'warn'
      /** Privacy-safe explanation for the warning. */
      readonly reason: string
    }
  | {
      /** Stop the model call before provider exposure. */
      readonly action: 'block'
      /** Privacy-safe explanation for the block. */
      readonly reason: string
    }
  | {
      /** Remove the tool from exposure and executable registration. */
      readonly action: 'strip'
      /** Privacy-safe explanation for removing the tool. */
      readonly reason: string
    }

/**
 * Result returned by a managed-memory write guardrail.
 *
 * @remarks
 * The callback receives the post-redaction candidate. In enforce mode,
 * `rewrite` replaces that candidate before block-local validation, `drop`
 * skips persistence without failing generation, and `block` stops persistence
 * with an error. Report mode records intent without changing persistence.
 */
export type MemoryWriteGuardrailResult<TValue = unknown> =
  | {
      /** Continue the managed-memory commit pipeline unchanged. */
      readonly action: 'allow'
    }
  | {
      /** Continue the commit pipeline and record a warning. */
      readonly action: 'warn'
      /** Privacy-safe explanation for the warning. */
      readonly reason: string
    }
  | {
      /** Stop the managed-memory write with an error. */
      readonly action: 'block'
      /** Privacy-safe explanation for the block. */
      readonly reason: string
    }
  | {
      /** Skip persistence without failing the generation operation. */
      readonly action: 'drop'
      /** Privacy-safe explanation for dropping the candidate. */
      readonly reason: string
    }
  | {
      /** Replace the candidate before block-local validation and persistence. */
      readonly action: 'rewrite'
      /** Replacement value, preserving the boundary's candidate type. */
      readonly value: TValue
      /** Stable category describing the rewrite. */
      readonly rewrite: {
        /** Rewrite operation applied by the policy. */
        readonly kind: GuardrailRewriteKind
      }
      /** Optional validated, privacy-safe findings from this invocation. */
      readonly findings?: readonly SafetyFinding[]
    }

interface SpecializedResultValidationOptions {
  readonly policyId?: string
  readonly boundary?: string
}

/**
 * Validate a JavaScript-shaped root tool-definition result.
 *
 * @param value - Untrusted callback return value.
 * @param options - Policy coordinates used for a privacy-safe typed error.
 * @returns A normalized root tool-definition result.
 * @throws {@link SafetyResultError} when the result is malformed or unsupported.
 */
export function validateToolDefinitionGuardrailResult(
  value: unknown,
  options: SpecializedResultValidationOptions,
): ToolDefinitionGuardrailResult {
  const result = resultRecord(value, options, 'tool-definition')
  switch (result.action) {
    case 'allow':
      return { action: 'allow' }
    case 'warn':
    case 'block':
    case 'strip':
      return {
        action: result.action,
        reason: requiredReason(result, options, 'tool-definition'),
      }
    default:
      throw specializedResultError(
        options,
        `unknown tool-definition guardrail action "${result.action}"`,
      )
  }
}

/**
 * Validate a JavaScript-shaped managed-memory write result.
 *
 * @param value - Untrusted callback return value.
 * @param options - Policy coordinates used for a privacy-safe typed error.
 * @returns A normalized memory-write result whose replacement remains unknown
 * until the owning memory block validates it.
 * @throws {@link SafetyResultError} when the result is malformed or unsupported.
 */
export function validateMemoryWriteGuardrailResult(
  value: unknown,
  options: SpecializedResultValidationOptions,
): MemoryWriteGuardrailResult {
  const result = resultRecord(value, options, 'memory-write')
  switch (result.action) {
    case 'allow':
      return { action: 'allow' }
    case 'warn':
    case 'block':
    case 'drop':
      return {
        action: result.action,
        reason: requiredReason(result, options, 'memory-write'),
      }
    case 'rewrite':
      if (!('value' in result)) {
        throw specializedResultError(options, 'memory-write rewrite results require a value')
      }
      if (!isRecord(result.rewrite) || !isRewriteKind(result.rewrite.kind)) {
        throw specializedResultError(
          options,
          'memory-write rewrite results require a valid rewrite.kind',
        )
      }
      return {
        action: 'rewrite',
        value: result.value,
        rewrite: { kind: result.rewrite.kind },
        ...(result.findings === undefined
          ? {}
          : { findings: validateSafetyFindings(result.findings, options) }),
      }
    default:
      throw specializedResultError(
        options,
        `unknown memory-write guardrail action "${result.action}"`,
      )
  }
}

function resultRecord(
  value: unknown,
  options: SpecializedResultValidationOptions,
  family: string,
): Readonly<Record<string, unknown>> & { readonly action: string } {
  if (!isRecord(value) || !hasStringAction(value)) {
    throw specializedResultError(
      options,
      `${family} result must be an object with an action string`,
    )
  }
  return value
}

function hasStringAction(
  value: Readonly<Record<string, unknown>>,
): value is Readonly<Record<string, unknown>> & { readonly action: string } {
  return typeof value.action === 'string'
}

function requiredReason(
  result: Readonly<Record<string, unknown>>,
  options: SpecializedResultValidationOptions,
  family: string,
): string {
  if (typeof result.reason !== 'string' || result.reason.length === 0) {
    throw specializedResultError(
      options,
      `${family} ${String(result.action)} results require a reason`,
    )
  }
  return result.reason
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

function specializedResultError(
  options: SpecializedResultValidationOptions,
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
