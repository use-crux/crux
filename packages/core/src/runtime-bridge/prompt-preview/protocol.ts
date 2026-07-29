/**
 * Strict wire contracts for explicit, runtime-owned prompt inspection.
 *
 * These schemas are intentionally separate from the compatible `store.read`
 * branch: exact preview handles application input and therefore rejects
 * unknown fields at every new object boundary.
 *
 * @module
 */

import { z } from "zod";

/** JSON data accepted by exact-preview input after wire validation. */
export type StrictJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly StrictJsonValue[]
  | { readonly [key: string]: StrictJsonValue };

/** Positive identity of one immutable process prompt catalogue. */
export const PromptPreviewCatalogueRevisionSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

/** String containing only complete Unicode scalar values. */
export const ScalarValidStringSchema = z
  .string()
  .superRefine((value, context) => {
    for (let index = 0; index < value.length; index += 1) {
      const codeUnit = value.charCodeAt(index);
      if (codeUnit < 0xd800 || codeUnit > 0xdfff) continue;
      const next = value.charCodeAt(index + 1);
      if (codeUnit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
        index += 1;
        continue;
      }
      context.addIssue({ code: "custom", message: "Invalid Unicode scalar." });
      return;
    }
  });

/** Recursively scalar-valid, finite JSON value. */
export const StrictJsonValueSchema: z.ZodType<StrictJsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    ScalarValidStringSchema,
    z.array(StrictJsonValueSchema),
    z.record(ScalarValidStringSchema, StrictJsonValueSchema),
  ]),
);

/** Object-root JSON accepted as exact-preview input and schema metadata. */
export const StrictJsonObjectSchema = z.record(
  ScalarValidStringSchema,
  StrictJsonValueSchema,
);

/** Description of the active prompt's authoritative runtime input contract. */
export const PromptPreviewInputDescriptorSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }).strict(),
  z
    .object({
      mode: z.literal("schema"),
      schema: StrictJsonObjectSchema,
    })
    .strict(),
  z.object({ mode: z.literal("raw") }).strict(),
]);

/** One canonical Prompt definition executable by the active runtime. */
export const PromptPreviewTargetSchema = z
  .object({
    definitionId: ScalarValidStringSchema.min(1).max(512),
    kind: z.literal("prompt"),
    name: ScalarValidStringSchema.min(1).max(512),
    description: ScalarValidStringSchema.min(1).max(4096).optional(),
    input: PromptPreviewInputDescriptorSchema,
  })
  .strict();

/** Complete exact-preview capability for one immutable catalogue revision. */
export const PromptPreviewCapabilitySchema = z
  .object({
    command: z.literal("prompt.previewExact"),
    catalogueRevision: PromptPreviewCatalogueRevisionSchema,
    targets: z.array(PromptPreviewTargetSchema).min(1).max(512),
  })
  .strict();

/** Provider-neutral options forwarded to canonical `Prompt.inspect()`. */
export const PromptPreviewOptionsSchema = z
  .object({
    provider: ScalarValidStringSchema.min(1).max(128).optional(),
    modelId: ScalarValidStringSchema.min(1).max(256).optional(),
    tokenBudget: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();

/** Bounded application input for one explicit inspection. */
export const PromptPreviewPayloadSchema = z
  .object({
    input: StrictJsonObjectSchema,
    options: PromptPreviewOptionsSchema.optional(),
  })
  .strict();

/** Target-scoped exact-preview request sent to the application runtime. */
export const PromptPreviewRequestSchema = z
  .object({
    type: z.literal("command.request"),
    commandId: ScalarValidStringSchema.min(1).max(128),
    command: z.literal("prompt.previewExact"),
    targetId: ScalarValidStringSchema.min(1).max(512),
    catalogueRevision: PromptPreviewCatalogueRevisionSchema,
    payload: PromptPreviewPayloadSchema,
    deadlineMs: z.number().int().positive().max(30_000),
  })
  .strict();

/** Cancellation signal for one in-flight WebSocket preview command. */
export const PromptPreviewCancelSchema = z
  .object({
    type: z.literal("command.cancel"),
    commandId: ScalarValidStringSchema.min(1).max(128),
    reason: z.enum(["cancelled", "deadline-exceeded", "target-retired"]),
  })
  .strict();

export type PromptPreviewTarget = z.infer<typeof PromptPreviewTargetSchema>;
export type PromptPreviewCapability = z.infer<
  typeof PromptPreviewCapabilitySchema
>;
export type PromptPreviewRequest = z.infer<typeof PromptPreviewRequestSchema>;
export type PromptPreviewCancel = z.infer<typeof PromptPreviewCancelSchema>;
