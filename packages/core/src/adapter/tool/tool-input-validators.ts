/**
 * Provider-neutral tool-argument validators and their sanitized failure contract.
 *
 * A tool's authored schema (a Zod schema, or an AI SDK schema's own `validate`)
 * is adapted to a single {@link ToolInputValidator} the lifecycle runs once over
 * decoded canonical `z.input`. Validation failures are surfaced to the model, so
 * they must never echo the raw arguments — an authored validator (Zod custom
 * messages included) can embed argument values or secrets in its message. Only
 * information Crux can prove safe (schema paths and Zod issue codes) is retained;
 * every free-text validator message is replaced with a stable generic reason.
 *
 * @module
 */

import type { z } from "zod";

/** The validated (and possibly transformed) result of an authored tool validator. */
export type ToolInputValidationOutcome =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly issues: readonly string[] };

/**
 * A provider-neutral tool-argument validator run once over decoded `z.input`.
 * Wraps the tool's authored schema (a Zod schema or an AI SDK schema's own
 * `validate`) and may transform the value or reject with sanitized issues.
 */
export type ToolInputValidator = (
  input: unknown,
) => ToolInputValidationOutcome | PromiseLike<ToolInputValidationOutcome>;

/**
 * The AI SDK / Standard-Schema-style validator signature, recognized structurally
 * so core never imports the AI SDK.
 */
export type SchemaValidate = (
  value: unknown,
) =>
  | { success: true; value: unknown }
  | { success: false; error: unknown }
  | PromiseLike<
      { success: true; value: unknown } | { success: false; error: unknown }
    >;

/** Stable, argument-free reason surfaced to the model on any validation failure. */
const GENERIC_VALIDATION_ISSUE = "the value does not satisfy the tool schema";

/**
 * Raised when a tool's model-supplied arguments fail its authored validator.
 *
 * @remarks
 * Not a policy-terminal error: the tool lifecycle settles it as a model-visible
 * error tool result so the model can correct it on a later step. Carries only
 * sanitized issue lines (schema paths / issue codes) — never raw arguments,
 * validator message text, or secrets.
 */
export class CruxToolInputValidationError extends Error {
  override readonly name = "CruxToolInputValidationError";
  readonly code = "tool_input_validation" as const;
  /** Sanitized issue descriptions (no raw arguments). */
  readonly issues: readonly string[];

  constructor(toolName: string, issues: readonly string[]) {
    super(
      `Tool "${toolName}" received arguments that do not match its schema:\n${issues.join(
        "\n",
      )}`,
    );
    this.issues = issues;
  }
}

/** Wrap a Zod schema as the authored validator (safeParse, sanitized issues). */
export function zodValidator(schema: z.ZodType): ToolInputValidator {
  return (input) => {
    const result = schema.safeParse(input);
    return result.success
      ? { ok: true, value: result.data }
      : { ok: false, issues: toolInputIssuesFromZodError(result.error) };
  };
}

/** Adapt an authored schema `validate` to the provider-neutral validator. */
export function wrapAuthoredValidator(
  validate: SchemaValidate,
): ToolInputValidator {
  return async (input) => {
    let result: Awaited<ReturnType<SchemaValidate>>;
    try {
      result = await validate(input);
    } catch {
      // An authored validator may throw with a message embedding the arguments;
      // it is never forwarded to the model.
      return { ok: false, issues: [GENERIC_VALIDATION_ISSUE] };
    }
    if (result && typeof result === "object" && "success" in result) {
      return result.success
        ? { ok: true, value: result.value }
        : { ok: false, issues: [GENERIC_VALIDATION_ISSUE] };
    }
    return { ok: false, issues: [GENERIC_VALIDATION_ISSUE] };
  };
}

/**
 * Sanitized Zod issue lines: schema path and issue code only. Zod messages (and
 * custom `.refine` messages) can echo the received value, so they are not used.
 */
function toolInputIssuesFromZodError(error: z.ZodError): readonly string[] {
  return error.issues.map((issue) => {
    const location = issue.path.length > 0 ? `"${issue.path.join(".")}"` : "(root)";
    return `- ${GENERIC_VALIDATION_ISSUE} at ${location} (${issue.code})`;
  });
}
