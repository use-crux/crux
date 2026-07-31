/**
 * Strict result and error envelopes for exact prompt preview.
 *
 * Results expose only the bounded inspection projection. Application input,
 * schemas, runtime objects, stacks, Runs, and traces are deliberately absent.
 *
 * @module
 */

import { z } from "zod";

import {
  PromptPreviewCatalogueRevisionSchema,
  ScalarValidStringSchema,
} from "./protocol";

/** One validation issue retained in resolver order. */
export const PromptPreviewValidationIssueSchema = z
  .object({
    code: ScalarValidStringSchema.min(1).max(64),
    path: z
      .array(
        z.union([
          ScalarValidStringSchema.max(256),
          z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        ]),
      )
      .max(32),
    message: ScalarValidStringSchema.min(1).max(1024),
  })
  .strict();

/** Expected input-validation outcome returned as a successful command result. */
export const PromptPreviewValidationResultSchema = z
  .object({
    status: z.literal("validation-error"),
    targetId: ScalarValidStringSchema.min(1).max(512),
    catalogueRevision: PromptPreviewCatalogueRevisionSchema,
    issues: z.array(PromptPreviewValidationIssueSchema).max(128),
    omittedIssueCount: z.number().int().nonnegative(),
  })
  .strict();

const RequestWarningSchema = z
  .object({
    code: ScalarValidStringSchema.min(1).max(128),
    message: ScalarValidStringSchema.max(2048),
  })
  .strict();

const RequestDiagnosticSchema = z
  .object({
    id: ScalarValidStringSchema.min(1).max(512),
    code: ScalarValidStringSchema.min(1).max(128),
    contributor: ScalarValidStringSchema.max(512).optional(),
    tokens: z.number().int().nonnegative().optional(),
    message: ScalarValidStringSchema.max(2048),
  })
  .strict();

const PreviewAdaptationSchema = z
  .object({
    contributor: ScalarValidStringSchema.min(1).max(512),
    representation: z.enum([
      "authored",
      "summary",
      "offload",
      "omitted",
    ]),
    state: z.enum(["selected", "unprepared"]),
    fullTokens: z.number().int().nonnegative().optional(),
    selectedTokens: z.number().int().nonnegative().optional(),
  })
  .strict();

/** Exact, bounded projection of observational request preview. */
export const PromptPreviewReadyResultSchema = z
  .object({
    status: z.literal("ready"),
    targetId: ScalarValidStringSchema.min(1).max(512),
    catalogueRevision: PromptPreviewCatalogueRevisionSchema,
    preview: z
      .object({
        status: z.enum(["fits", "over-limit", "unknown"]),
        model: ScalarValidStringSchema.max(512).optional(),
        inputTokens: z.number().int().nonnegative().optional(),
        maxInputTokens: z.number().int().nonnegative().optional(),
        measurement: z.enum([
          "exact",
          "estimated",
          "conservative",
          "incomplete",
        ]),
        adaptations: z.array(PreviewAdaptationSchema).max(1024),
        warnings: z.array(RequestWarningSchema).max(1024),
        diagnostics: z.array(RequestDiagnosticSchema).max(1024),
      })
      .strict(),
  })
  .strict();

/** Successful exact-preview command outcome. */
export const PromptPreviewResultSchema = z.discriminatedUnion("status", [
  PromptPreviewReadyResultSchema,
  PromptPreviewValidationResultSchema,
]);

/** Strict successful exact-preview command envelope. */
export const PromptPreviewResultEnvelopeSchema = z
  .object({
    type: z.literal("command.result"),
    commandId: ScalarValidStringSchema.min(1).max(128),
    result: PromptPreviewResultSchema,
  })
  .strict();

/** Closed failures owned by exact-preview execution in the application. */
export const PromptPreviewErrorCodeSchema = z.enum([
  "invalid_request",
  "target_unavailable",
  "catalogue_changed",
  "target_retired",
  "input_limit_exceeded",
  "inspection_timeout",
  "inspection_failed",
  "result_limit_exceeded",
  "internal_error",
]);

/** Safe exact-preview error without input, output, schema, or stack data. */
export const PromptPreviewErrorSchema = z
  .object({
    code: PromptPreviewErrorCodeSchema,
    message: ScalarValidStringSchema.min(1).max(1024),
    details: z
      .object({
        targetId: ScalarValidStringSchema.min(1).max(512).optional(),
        expectedCatalogueRevision:
          PromptPreviewCatalogueRevisionSchema.optional(),
        actualCatalogueRevision:
          PromptPreviewCatalogueRevisionSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** Strict failed exact-preview command envelope. */
export const PromptPreviewErrorEnvelopeSchema = z
  .object({
    type: z.literal("command.error"),
    commandId: ScalarValidStringSchema.min(1).max(128),
    error: PromptPreviewErrorSchema,
  })
  .strict();

export type PromptPreviewResult = z.infer<typeof PromptPreviewResultSchema>;
export type PromptPreviewError = z.infer<typeof PromptPreviewErrorSchema>;
