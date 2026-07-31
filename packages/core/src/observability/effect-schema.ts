/**
 * Qualified schema rules for canonical Effects observability records.
 *
 * @internal
 * @module
 */

import { z } from "zod";
import type {
  CruxEffectReceiptSummary,
  CruxEffectRunAttributes,
} from "./contract";

const nonEmptyString = z.string().min(1);

const EffectResourceSummarySchema = z
  .object({
    type: nonEmptyString,
    id: nonEmptyString.optional(),
    namespace: nonEmptyString.optional(),
    attributes: z
      .record(
        z.string(),
        z.union([z.string(), z.number().finite(), z.boolean()]),
      )
      .optional(),
  })
  .strict();

/** Runtime schema for a privacy-safe effect receipt summary. */
export const EffectReceiptSummarySchema = z
  .object({
    kind: z.literal("effect.receipt"),
    receiptId: nonEmptyString,
    effectId: nonEmptyString,
    effectVersion: z.number().int().positive(),
    scopeId: nonEmptyString,
    boundaryId: nonEmptyString,
    parentReceiptId: nonEmptyString.optional(),
    outcome: z.enum(["succeeded", "failed", "cancelled", "unknown"]),
    recovery: z.enum([
      "available",
      "unavailable",
      "irreversible",
      "expired",
      "conflict",
      "handler_unavailable",
      "ambiguous",
      "recovered",
    ]),
    resource: z
      .union([
        EffectResourceSummarySchema,
        z.array(EffectResourceSummarySchema).readonly(),
      ])
      .optional(),
  })
  .strict() satisfies z.ZodType<CruxEffectReceiptSummary>;

/** Runtime schema for canonical `effect.run` span attributes. */
export const EffectRunAttributesSchema = z
  .object({
    "crux.effect.id": nonEmptyString,
    "crux.effect.version": z.number().int().positive(),
    "crux.effect.receipt.id": nonEmptyString,
    "crux.effect.scope.id": nonEmptyString,
    "crux.effect.boundary.id": nonEmptyString,
    "crux.effect.parent_receipt.id": nonEmptyString.optional(),
    "crux.effect.outcome": z.enum([
      "preparing",
      "running",
      "succeeded",
      "failed",
      "cancelled",
      "unknown",
    ]),
    "crux.effect.recovery": z.enum([
      "available",
      "unavailable",
      "irreversible",
      "expired",
      "conflict",
      "handler_unavailable",
      "ambiguous",
      "recovered",
    ]),
  })
  .passthrough() satisfies z.ZodType<CruxEffectRunAttributes>;

interface EffectArtifactShape {
  readonly kind: string;
  readonly contentType: string;
  readonly encoding: string;
  readonly preview?: unknown;
}

/** Qualify the new receipt artifact without changing older artifact rules. */
export function validateEffectReceiptArtifact(
  artifact: EffectArtifactShape,
  context: z.RefinementCtx,
): void {
  if (artifact.kind !== "effect.receipt") return;
  if (
    artifact.contentType !== "application/json" ||
    artifact.encoding !== "json"
  ) {
    addIssue(context, "encoding", "Effect receipt summaries must be inline JSON");
  }
  const parsed = EffectReceiptSummarySchema.safeParse(artifact.preview);
  if (parsed.success) return;
  for (const issue of parsed.error.issues) {
    context.addIssue({
      code: "custom",
      message: issue.message,
      path: ["preview", ...issue.path],
    });
  }
}

interface EffectEdgeShape {
  readonly edgeType: string;
  readonly from: { readonly kind: string };
  readonly to: { readonly kind: string };
}

/** Require recovery links to connect an attempt span to its original span. */
export function validateRecoveryOfEdge(
  edge: EffectEdgeShape,
  context: z.RefinementCtx,
): void {
  if (edge.edgeType !== "recovery.of") return;
  if (edge.from.kind !== "span") {
    addIssue(context, "from", "Recovery links must start at an effect span");
  }
  if (edge.to.kind !== "span") {
    addIssue(context, "to", "Recovery links must target an effect span");
  }
}

function addIssue(
  context: z.RefinementCtx,
  field: string,
  message: string,
): void {
  context.addIssue({ code: "custom", message, path: [field] });
}
