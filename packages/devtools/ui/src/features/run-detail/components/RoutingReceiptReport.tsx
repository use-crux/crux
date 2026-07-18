import type { CruxRoutingReportPreview } from "@use-crux/core/observability";
import { Chip } from "@/devtools/shell/primitives";
import { EmptyHint } from "./SpanDetailPanelAtoms";
import { RoutingReceiptSteps } from "./RoutingReceiptSteps";
import {
  fmtCost,
  fmtDuration,
  shortModelId,
} from "../lib/span-detail-inspection";
import {
  routingFactsFromReport,
  routingStepViews,
} from "../lib/routing-receipt";

/** Render the canonical routing receipt trace emitted by `routing.report`. */
export function RoutingReceiptReport({
  report,
  attrs = {},
}: {
  report: CruxRoutingReportPreview;
  attrs?: Record<string, unknown>;
}) {
  const steps = routingStepViews(report);
  if (steps.length === 0)
    return (
      <EmptyHint>
        No routing receipt trace recorded for this operation.
      </EmptyHint>
    );
  const facts = routingFactsFromReport(report, attrs);
  const chosen = facts.chosen
    ? (shortModelId(facts.chosen) ?? facts.chosen)
    : undefined;

  return (
    <div className="flex flex-col gap-5">
      <RoutingReceiptSteps
        steps={steps}
        right={
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {chosen && (
              <Chip tone="ok" mono>
                {chosen}
              </Chip>
            )}
            {report.cost != null && (
              <Chip tone="muted" mono>
                {fmtCost(report.cost)}
              </Chip>
            )}
            {facts.firstTokenAt != null && (
              <Chip tone="muted" mono>
                TTFT {fmtDuration(facts.firstTokenAt)}
              </Chip>
            )}
            {facts.hasDefaultRoute && <Chip tone="warn">default route</Chip>}
            {facts.hasMidStreamFailure && <Chip tone="warn">mid-stream</Chip>}
            {facts.underBudget === false && <Chip tone="warn">budget</Chip>}
          </div>
        }
      />
    </div>
  );
}
