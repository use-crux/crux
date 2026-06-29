/**
 * Shared validation-retry policy for adapter factories.
 *
 * Owns the structured-output validation step used by both `adapter()`
 * (core-driven tool loop) and `executorAdapter()` (SDK-driven loop):
 * text repair, JSON parsing, Zod validation, and corrective-message
 * formatting. The retry *loop* lives in the factories; the policy of
 * what counts as valid and how to phrase feedback lives here, once.
 *
 * @module
 */

import { z } from 'zod'
import { repairJsonText } from '../../generation/repair-json'

/** Result of validating structured output against a Zod schema. */
export interface ValidationResult {
  /** `true` when the (possibly repaired) text parsed and passed the schema. */
  readonly valid: boolean
  /**
   * The text that was actually validated. May differ from the input when
   * repair stripped markdown fences, trailing commas, or similar noise —
   * callers should surface this text, not the original, on success.
   */
  readonly repairedText: string
  /**
   * The validation failure, present only when `valid` is `false`. JSON
   * parse failures are reported as a synthetic single-issue `ZodError`
   * so callers handle one error shape for both failure modes.
   */
  readonly error?: z.ZodError
}

/**
 * Validate a model's raw text output against a structured-output schema.
 *
 * This is the single definition of "what counts as valid structured output"
 * shared by every adapter factory. It runs cheap text repair first
 * (`repairJsonText` — strips markdown fences, fixes trailing commas), then
 * parses and validates, so a model that wrapped perfectly good JSON in
 * ` ```json ` fences does not burn a retry.
 *
 * @param text - The model's raw text output.
 * @param schema - The Zod schema the prompt declared as its `output`.
 * @returns A {@link ValidationResult}. Never throws — parse failures come
 *   back as `{ valid: false, error }` so the caller's retry loop stays
 *   in control.
 *
 * @example
 * ```ts
 * const result = validateStructuredOutput(response.text, prompt.schema)
 * if (!result.valid) {
 *   messages.push({ role: 'user', content: formatValidationFeedback(response.text, result.error!) })
 *   continue // retry
 * }
 * const value = JSON.parse(result.repairedText)
 * ```
 */
export function validateStructuredOutput(text: string, schema: z.ZodType): ValidationResult {
  // Attempt text repair first (strips markdown fences, fixes trailing commas, etc.)
  const repaired = repairJsonText(text)
  const textToValidate = repaired ?? text

  // Try to parse as JSON
  let parsed: unknown
  try {
    parsed = JSON.parse(textToValidate)
  } catch {
    // JSON parse failure — create a synthetic ZodError
    const error = new z.ZodError([
      {
        code: 'custom',
        path: [],
        message: `Invalid JSON: ${text.slice(0, 200)}`,
      },
    ])
    return { valid: false, repairedText: textToValidate, error }
  }

  // Validate against schema
  const result = schema.safeParse(parsed)
  if (result.success) {
    return { valid: true, repairedText: textToValidate }
  }

  return { valid: false, repairedText: textToValidate, error: result.error }
}

/**
 * Format a validation failure as a corrective user message the model can
 * act on in the next attempt.
 *
 * The message quotes the model's failed output verbatim and lists every
 * Zod issue with its JSON path (`- Expected number at "count"`), which is
 * what makes self-correction reliable: the model sees exactly which fields
 * to fix rather than a generic "invalid JSON" complaint.
 *
 * Both `adapter()` and `executorAdapter()` inject this message on each
 * validation retry, so the corrective phrasing models are tuned against
 * stays identical across every Crux adapter.
 *
 * @param failedOutput - The raw model output that failed validation.
 * @param error - The `ZodError` from {@link validateStructuredOutput}.
 * @returns A user-role message body to append before re-calling the model.
 */
export function formatValidationFeedback(failedOutput: string, error: z.ZodError): string {
  const issueLines = error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? ` at "${issue.path.join('.')}"` : ''
      return `- ${issue.message}${path}`
    })
    .join('\n')

  return [
    'Validation failed for your previous output. Please fix these issues and return valid JSON.',
    '',
    'Your output:',
    failedOutput,
    '',
    'Validation errors:',
    issueLines,
  ].join('\n')
}
