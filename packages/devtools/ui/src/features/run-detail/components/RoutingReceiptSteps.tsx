import type { ReactNode } from "react";
import { Chip } from "@/devtools/shell/primitives";
import { AttemptStep, CascadeStep } from "./RoutingReceiptAttemptRows";
import {
  RoutingReceiptSection,
  RoutingStepShell,
} from "./RoutingReceiptStepShell";
import type { RoutingStepView } from "../lib/routing-receipt";

export function RoutingReceiptSteps({
  steps,
  right,
}: {
  steps: RoutingStepView[];
  right?: ReactNode;
}) {
  return (
    <RoutingReceiptSection title="Routing receipt" right={right}>
      <div className="flex flex-col gap-3">
        {steps.map((step, index) => (
          <RoutingStepRow
            key={`${step.kind}-${step.id ?? index}`}
            step={step}
            index={index}
          />
        ))}
      </div>
    </RoutingReceiptSection>
  );
}

function RoutingStepRow({
  step,
  index,
}: {
  step: RoutingStepView;
  index: number;
}) {
  switch (step.kind) {
    case "router":
      return <RouterStep step={step} index={index} />;
    case "split":
      return <SplitStep step={step} index={index} />;
    case "retry":
      return (
        <AttemptStep
          title="Retry"
          kind="retry"
          attempts={step.attempts}
          index={index}
        />
      );
    case "fallback":
      return (
        <AttemptStep
          title="Fallback"
          kind="fallback"
          attempts={step.attempts}
          index={index}
          right={
            step.midStreamFailure ? (
              <Chip tone="warn">mid-stream</Chip>
            ) : undefined
          }
        />
      );
    case "cascade":
      return <CascadeStep step={step} index={index} />;
  }
}

function RouterStep({
  step,
  index,
}: {
  step: Extract<RoutingStepView, { kind: "router" }>;
  index: number;
}) {
  return (
    <RoutingStepShell
      title="Router"
      index={index}
      right={
        <div className="flex gap-1.5">
          {step.forced && <Chip tone="warn">forced</Chip>}
          {step.usedDefaultRoute && <Chip tone="warn">default</Chip>}
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2 font-mono text-[12px]">
        {step.classifiedAs && (
          <span
            className="rounded-[4px] px-2 py-0.5"
            style={{
              background: "var(--devtools-crux-soft)",
              color: "var(--devtools-crux)",
            }}
          >
            {step.classifiedAs}
          </span>
        )}
        <span style={{ color: "var(--devtools-fg-faint)" }}>route</span>
        <span className="font-semibold" style={{ color: "var(--devtools-fg)" }}>
          {step.route ?? "default"}
        </span>
      </div>
    </RoutingStepShell>
  );
}

function SplitStep({
  step,
  index,
}: {
  step: Extract<RoutingStepView, { kind: "split" }>;
  index: number;
}) {
  return (
    <RoutingStepShell title="Split" index={index}>
      <div
        className="grid gap-2 font-mono text-[12px]"
        style={{ gridTemplateColumns: "80px minmax(0, 1fr)" }}
      >
        <span style={{ color: "var(--devtools-fg-faint)" }}>bucket</span>
        <span
          className="truncate font-semibold"
          style={{ color: "var(--devtools-fg)" }}
        >
          {step.route ?? "-"}
        </span>
        {step.seed && (
          <>
            <span style={{ color: "var(--devtools-fg-faint)" }}>seed</span>
            <span className="truncate" style={{ color: "var(--devtools-fg-muted)" }}>
              {step.seed}
            </span>
          </>
        )}
      </div>
    </RoutingStepShell>
  );
}
