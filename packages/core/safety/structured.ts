import { SafetyStructuredSyncError } from './errors'

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
): StructuredSafetyOutput {
  if (output.parsed === undefined || rewrittenText === output.text) {
    return { ...output, text: rewrittenText }
  }

  try {
    return { text: rewrittenText, parsed: JSON.parse(rewrittenText) }
  } catch (error) {
    throw new SafetyStructuredSyncError({
      message: 'Safety rewrote structured output text, but the rewritten text is not valid JSON.',
      policyId: 'unknown',
      parseError: error instanceof Error ? error.message : String(error),
    })
  }
}
