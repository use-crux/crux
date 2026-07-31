/**
 * Canonical observability projection for executed request receipts.
 *
 * @module
 */

import type { CruxRequestPlanPreview } from "../../observability/contract";
import { observe } from "../../observability/observe";
import type { RequestInspection } from "./inspection";
import type { RequestReceipt } from "./receipt";

/** Emit one content-free request plan on the active provider-call span. @internal */
export function emitRequestPlan(
  receipt: RequestReceipt,
  inspection: RequestInspection,
  stage: CruxRequestPlanPreview["stage"],
): void {
  const preview: CruxRequestPlanPreview = {
    kind: "request.plan",
    stage,
    receipt: {
      id: receipt.id,
      model: receipt.model,
      inputTokens: receipt.inputTokens,
      maxInputTokens: receipt.maxInputTokens,
      measurement: receipt.measurement,
      adaptations: receipt.adaptations,
      warnings: receipt.warnings,
      ...(receipt.previousRequestId
        ? { previousRequestId: receipt.previousRequestId }
        : {}),
    },
    inspection,
  };
  observe.artifact({
    kind: "request.plan",
    contentType: "application/json",
    encoding: "json",
    preview,
    attributes: {
      requestId: receipt.id,
      model: receipt.model,
      inputTokens: receipt.inputTokens,
      maxInputTokens: receipt.maxInputTokens,
      adaptationCount: receipt.adaptations.length,
      stage,
      ...(receipt.previousRequestId
        ? { previousRequestId: receipt.previousRequestId }
        : {}),
    },
  });
}
