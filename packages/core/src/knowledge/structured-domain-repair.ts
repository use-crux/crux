/**
 * One structured generate + one domain repair for connected-knowledge layers.
 *
 * Canonical `KnowledgeModel.generateObject` returns a schema-validated object.
 * First-party adapters may throw {@link ValidationExhaustedError} when the
 * authored parse fails. Custom models may still return an unvalidated object.
 * This helper treats both as the same failure class and issues exactly one
 * corrective repair with safe issue identities only.
 *
 * @internal
 * @module
 */

import type { z } from 'zod'
import {
  isValidationExhaustedError,
  ValidationExhaustedError,
  type ValidationIssueSummary,
} from '../generation/validation-retry'

type DomainObjectAccept<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly zodErrors: z.ZodError }

/**
 * Run `initial`, then at most one `repair` when the result fails `accept` or
 * the port throws {@link ValidationExhaustedError}. Exhaustion rethrows a
 * {@link ValidationExhaustedError} (attempts/maxAttempts 1).
 */
export async function generateObjectWithDomainRepair<T>(input: {
  readonly promptId: string
  readonly initial: () => Promise<{ readonly object: unknown }>
  readonly repair: (safeFeedback: string) => Promise<{ readonly object: unknown }>
  readonly accept: (object: unknown) => DomainObjectAccept<T>
}): Promise<T> {
  const first = await runDomainAttempt(input.initial, input.accept)
  if (first.ok) return first.data

  const feedback = formatSafeValidationFeedback(first.issues)
  const second = await runDomainAttempt(() => input.repair(feedback), input.accept)
  if (second.ok) return second.data

  throw new ValidationExhaustedError({
    zodErrors: second.zodErrors,
    attempts: 1,
    maxAttempts: 1,
    promptId: input.promptId,
  })
}

async function runDomainAttempt<T>(
  generate: () => Promise<{ readonly object: unknown }>,
  accept: (object: unknown) => DomainObjectAccept<T>,
): Promise<
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssueSummary[]; readonly zodErrors: z.ZodError }
> {
  try {
    const result = await generate()
    const accepted = accept(result.object)
    if (accepted.ok) return accepted
    return failureFromZod(accepted.zodErrors)
  } catch (error) {
    if (!isValidationExhaustedError(error)) throw error
    return {
      ok: false,
      issues: error.issues,
      zodErrors: error.zodErrors,
    }
  }
}

function failureFromZod(zodErrors: z.ZodError): {
  readonly ok: false
  readonly issues: readonly ValidationIssueSummary[]
  readonly zodErrors: z.ZodError
} {
  // Reuse ValidationExhaustedError sanitization so repair feedback never carries
  // custom messages or model-controlled record keys from the rejected payload.
  const sanitized = new ValidationExhaustedError({
    zodErrors,
    attempts: 0,
    maxAttempts: 0,
    promptId: '',
  })
  return { ok: false, issues: sanitized.issues, zodErrors: sanitized.zodErrors }
}

/** Content-free issue lines for domain repair prompts: path + code only. */
function formatSafeValidationFeedback(
  issues: readonly ValidationIssueSummary[],
): string {
  if (issues.length === 0) return '(root): invalid'
  return issues
    .map((issue) => {
      const where = issue.path.length > 0 ? issue.path : '(root)'
      return `${where}: ${issue.code}`
    })
    .join('\n')
}
