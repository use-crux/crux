import { SafetyStructuredSyncError } from './errors'
import type { z } from 'zod'

/** Output pair that must stay synchronized after safety rewrites. */
export interface StructuredSafetyOutput {
  readonly text: string
  readonly parsed?: unknown
}

/**
 * Reparse structured JSON text after a text-boundary guard rewrites it.
 *
 * Structured adapters already validate provider output before safety. This
 * helper keeps the returned `text` and `parsed` pair from diverging after a
 * guardrail rewrite; schema revalidation is owned by adapter integration in
 * later slices.
 */
export function resyncStructuredText(
  output: StructuredSafetyOutput,
  rewrittenText: string,
  opts: {
    readonly schema?: z.ZodType
    readonly policyId?: string
  } = {},
): StructuredSafetyOutput {
  if (output.parsed === undefined || rewrittenText === output.text) {
    return { ...output, text: rewrittenText }
  }

  const policyId = opts.policyId ?? 'unknown'

  try {
    const parsed = JSON.parse(rewrittenText) as unknown
    if (opts.schema) {
      const validation = opts.schema.safeParse(parsed)
      if (!validation.success) {
        throw new SafetyStructuredSyncError({
          message: 'Safety rewrote structured output text, but the rewritten object does not match the schema.',
          policyId,
          parseError: validation.error.message,
        })
      }
      return { text: rewrittenText, parsed: validation.data }
    }
    return { text: rewrittenText, parsed }
  } catch (error) {
    if (error instanceof SafetyStructuredSyncError) throw error
    throw new SafetyStructuredSyncError({
      message: 'Safety rewrote structured output text, but the rewritten text is not valid JSON.',
      policyId,
      parseError: error instanceof Error ? error.message : String(error),
    })
  }
}
