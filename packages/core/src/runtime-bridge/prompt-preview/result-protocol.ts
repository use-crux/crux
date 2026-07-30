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

/** Half-open UTF-16 provenance relative to its containing text. */
export const PromptPreviewSegmentSchema = z
  .object({
    kind: z.enum(["static", "dynamic", "unknown"]),
    startUtf16: z.number().int().nonnegative(),
    endUtf16: z.number().int().nonnegative(),
    source: ScalarValidStringSchema.min(1).max(512).optional(),
    observedAt: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    sourceVersion: ScalarValidStringSchema.min(1).max(256).optional(),
  })
  .strict();

const PromptPreviewPartSchema = z
  .object({
    source: ScalarValidStringSchema.min(1).max(512),
    text: ScalarValidStringSchema,
    tokens: z.number().int().nonnegative(),
    skipped: z.boolean(),
    segments: z.array(PromptPreviewSegmentSchema),
    staticTokens: z.number().int().nonnegative().optional(),
    dynamicTokens: z.number().int().nonnegative().optional(),
  })
  .strict();

const PromptPreviewDroppedContextSchema = z
  .object({
    source: ScalarValidStringSchema.min(1).max(512),
    text: ScalarValidStringSchema,
    tokens: z.number().int().nonnegative(),
    priority: z.number().finite(),
    segments: z.array(PromptPreviewSegmentSchema),
  })
  .strict();

const PromptPreviewExcludedContextSchema = z
  .object({
    source: ScalarValidStringSchema.min(1).max(512),
    reason: ScalarValidStringSchema.max(1024),
  })
  .strict();

/** Exact, bounded projection of canonical `Prompt.inspect()`. */
export const PromptPreviewReadyResultSchema = z
  .object({
    status: z.literal("ready"),
    targetId: ScalarValidStringSchema.min(1).max(512),
    catalogueRevision: PromptPreviewCatalogueRevisionSchema,
    inspection: z
      .object({
        system: z
          .object({
            text: ScalarValidStringSchema,
            tokens: z.number().int().nonnegative(),
            coverage: z.enum(["complete", "partial"]),
            parts: z.array(PromptPreviewPartSchema).max(1024),
          })
          .strict(),
        prompt: z
          .object({
            text: ScalarValidStringSchema,
            tokens: z.number().int().nonnegative(),
            segments: z.array(PromptPreviewSegmentSchema),
            staticTokens: z.number().int().nonnegative().optional(),
            dynamicTokens: z.number().int().nonnegative().optional(),
          })
          .strict()
          .optional(),
        totalTokens: z.number().int().nonnegative(),
        droppedContexts: z.array(PromptPreviewDroppedContextSchema).max(1024),
        excludedContexts: z.array(PromptPreviewExcludedContextSchema).max(1024),
        tools: z
          .array(ScalarValidStringSchema.min(1).max(512))
          .max(1024)
          .optional(),
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
