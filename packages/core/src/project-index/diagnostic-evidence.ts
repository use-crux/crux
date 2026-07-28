/**
 * Structured evidence attached to PromptText construction diagnostics.
 *
 * The Project Index stores conclusions rather than compiler objects so every
 * semantic backend can publish the same stable, serializable contract.
 *
 * @module
 */

import { z } from "zod";

/** Maximum interpolation index representable by the diagnostic identity. */
const MAX_INTERPOLATION_INDEX = 2_147_483_647;

/** Canonical order for runtime kinds proven invalid by PromptText. */
export const PROMPT_TEXT_RUNTIME_KINDS = [
  "non-finite-number",
  "boolean",
  "bigint",
  "symbol",
  "function",
  "object",
  "cyclic-array",
] as const;

/** A closed runtime category that PromptText composition rejects. */
export type PromptTextRuntimeKind = (typeof PROMPT_TEXT_RUNTIME_KINDS)[number];

/** Evidence that every value at an interpolation site violates PromptText. */
export interface PromptTextInvalidInterpolationCause {
  readonly kind: "invalid-interpolation";
  readonly runtimeKinds: readonly PromptTextRuntimeKind[];
  readonly mdJsonApplicable?: true;
}

/** Evidence that a sequence appears where PromptText requires a scalar. */
export interface PromptTextInlineSequenceCause {
  readonly kind: "inline-sequence";
  readonly joinableWithComma?: true;
}

/** Evidence that canonical `md.json()` cannot produce text. */
export interface PromptTextJsonSerializationCause {
  readonly kind: "json-serialization";
  readonly reason: "undefined-result";
}

/** The closed set of construction failures represented by Project Index data. */
export type PromptTextDiagnosticCause =
  | PromptTextInvalidInterpolationCause
  | PromptTextInlineSequenceCause
  | PromptTextJsonSerializationCause;

/**
 * Backend-neutral proof for one exact PromptText interpolation.
 *
 * `interpolationIndex` is local to the source-ref template. A path identifies
 * a guaranteed invalid leaf in a required tuple and is therefore legal only
 * for invalid-interpolation evidence.
 */
export interface PromptTextDiagnosticEvidence {
  readonly kind: "prompt-text";
  readonly sourceRefId: string;
  readonly interpolationIndex: number;
  readonly interpolationPath?: readonly number[];
  readonly proof: "syntax-exact" | "semantic-exact";
  readonly cause: PromptTextDiagnosticCause;
}

const PromptTextRuntimeKindSchema = z.enum(PROMPT_TEXT_RUNTIME_KINDS);

const BoundedInterpolationIndexSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_INTERPOLATION_INDEX);

const RuntimeKindsSchema = z
  .array(PromptTextRuntimeKindSchema)
  .min(1)
  .max(PROMPT_TEXT_RUNTIME_KINDS.length)
  .superRefine((runtimeKinds, context) => {
    let previousIndex = -1;

    for (const runtimeKind of runtimeKinds) {
      const index = PROMPT_TEXT_RUNTIME_KINDS.indexOf(runtimeKind);
      if (index <= previousIndex) {
        context.addIssue({
          code: "custom",
          message: "Runtime kinds must be unique and canonically ordered",
        });
        return;
      }
      previousIndex = index;
    }
  });

const InvalidInterpolationCauseSchema = z
  .object({
    kind: z.literal("invalid-interpolation"),
    runtimeKinds: RuntimeKindsSchema,
    mdJsonApplicable: z.literal(true).optional(),
  })
  .strict()
  .superRefine((cause, context) => {
    if (
      cause.mdJsonApplicable &&
      cause.runtimeKinds.some(
        (runtimeKind) =>
          runtimeKind !== "non-finite-number" && runtimeKind !== "boolean",
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["mdJsonApplicable"],
        message:
          "mdJsonApplicable requires only boolean or non-finite-number kinds",
      });
    }
  });

const InlineSequenceCauseSchema = z
  .object({
    kind: z.literal("inline-sequence"),
    joinableWithComma: z.literal(true).optional(),
  })
  .strict();

const JsonSerializationCauseSchema = z
  .object({
    kind: z.literal("json-serialization"),
    reason: z.literal("undefined-result"),
  })
  .strict();

/**
 * Runtime validator for {@link PromptTextDiagnosticEvidence}.
 *
 * The evidence object and every nested cause reject unknown fields. Parsing
 * does not make the surrounding Project Index diagnostic strict.
 *
 * @example
 * ```ts
 * const evidence = PromptTextDiagnosticEvidenceSchema.parse(input)
 * ```
 */
export const PromptTextDiagnosticEvidenceSchema = z
  .object({
    kind: z.literal("prompt-text"),
    sourceRefId: z.string().min(1),
    interpolationIndex: BoundedInterpolationIndexSchema,
    interpolationPath: z
      .array(BoundedInterpolationIndexSchema)
      .min(1)
      .max(64)
      .optional(),
    proof: z.enum(["syntax-exact", "semantic-exact"]),
    cause: z.discriminatedUnion("kind", [
      InvalidInterpolationCauseSchema,
      InlineSequenceCauseSchema,
      JsonSerializationCauseSchema,
    ]),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (
      evidence.interpolationPath &&
      evidence.cause.kind !== "invalid-interpolation"
    ) {
      context.addIssue({
        code: "custom",
        path: ["interpolationPath"],
        message:
          "Interpolation paths are legal only for invalid interpolations",
      });
    }
  }) satisfies z.ZodType<PromptTextDiagnosticEvidence>;
