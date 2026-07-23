import { SafetyStructuredSyncError } from './errors'

/** Output pair that must stay synchronized after safety rewrites. */
export interface StructuredSafetyOutput {
  readonly text: string
  readonly parsed?: unknown
}

/**
 * Resynchronize the canonical `z.input` after a text-boundary guard rewrites
 * structured output text.
 *
 * This is JSON resynchronization only: it keeps the returned `text` and `parsed`
 * pair from diverging after a rewrite by reparsing the rewritten JSON back into
 * canonical `z.input`. It never runs Zod — the authoritative `safeParse` and all
 * schema-validation, error, and retry handling are owned by adapter execution,
 * which parses the guarded canonical input exactly once after guardrails and
 * before constraints. Invalid JSON is still a synchronization failure; a
 * schema-invalid-but-valid-JSON rewrite flows to normal validation handling.
 */
export function resyncStructuredText(
  output: StructuredSafetyOutput,
  rewrittenText: string,
  opts: {
    readonly policyId?: string
  } = {},
): StructuredSafetyOutput {
  if (output.parsed === undefined || rewrittenText === output.text) {
    return { ...output, text: rewrittenText }
  }

  const policyId = opts.policyId ?? 'unknown'

  try {
    const parsed = JSON.parse(rewrittenText) as unknown
    return { text: rewrittenText, parsed }
  } catch (error) {
    throw new SafetyStructuredSyncError({
      message: 'Safety rewrote structured output text, but the rewritten text is not valid JSON.',
      policyId,
      parseError: error instanceof Error ? error.message : String(error),
    })
  }
}
