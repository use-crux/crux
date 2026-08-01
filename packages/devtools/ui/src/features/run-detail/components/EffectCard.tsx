/** Purpose-built Run Detail card for canonical Effect execution spans. */

import type { ObservabilityRunDetailNode } from "@/types";
import { Chip, type ChipTone } from "@/devtools/shell/primitives";
import {
  projectEffectRun,
  type EffectOutcome,
  type EffectRecoveryState,
  type EffectResourceSummary,
} from "../lib/span-detail-effect";

export function EffectCard({
  node,
  root,
  onSelectSpan,
}: {
  readonly node: ObservabilityRunDetailNode;
  readonly root: ObservabilityRunDetailNode;
  readonly onSelectSpan?: (spanId: string) => void;
}) {
  const presentation = projectEffectRun(node, root);
  if (!presentation) {
    return (
      <div className="text-[12px] text-[var(--devtools-fg-muted)]">
        Effect details unavailable.
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border px-4 py-4"
      style={{
        borderColor: "var(--devtools-border)",
        background: "var(--devtools-bg-muted)",
      }}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Chip tone="plum">Effect</Chip>
        <Chip tone="muted">v{presentation.effectVersion}</Chip>
      </div>

      <div className="text-[14px] font-medium text-[var(--devtools-fg)]">
        Effect · {presentation.effectId}
      </div>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-[12px]">
        {presentation.resource && (
          <>
            <dt className="text-[var(--devtools-fg-muted)]">Resource</dt>
            <dd>{resourceLabel(presentation.resource)}</dd>
          </>
        )}
        <dt className="text-[var(--devtools-fg-muted)]">Status</dt>
        <dd className="flex flex-wrap items-center gap-2">
          <span>{outcomeLabel(presentation.outcome)}</span>
          <Chip tone={recoveryTone(presentation.recoveryState)} dot>
            {recoveryLabel(presentation.recoveryState)}
          </Chip>
        </dd>
        <dt className="text-[var(--devtools-fg-muted)]">Receipt</dt>
        <dd className="break-all font-mono">{presentation.receiptId}</dd>
        {presentation.recoveryOfSpanId && (
          <>
            <dt className="text-[var(--devtools-fg-muted)]">Recovery of</dt>
            <dd className="break-all font-mono">
              {onSelectSpan ? (
                <button
                  type="button"
                  className="cursor-pointer text-left text-[var(--devtools-crux)] hover:underline"
                  onClick={() => onSelectSpan(presentation.recoveryOfSpanId!)}
                >
                  {presentation.recoveryOfSpanId}
                </button>
              ) : (
                presentation.recoveryOfSpanId
              )}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

function resourceLabel(
  resource: EffectResourceSummary | readonly EffectResourceSummary[],
): string {
  const resources = "type" in resource ? [resource] : resource;
  return resources
    .map((entry) =>
      [entry.type, entry.namespace, entry.id]
        .filter((part): part is string => Boolean(part))
        .join(" · "),
    )
    .join("; ");
}

function outcomeLabel(outcome: EffectOutcome): string {
  return outcome.charAt(0).toUpperCase() + outcome.slice(1);
}

function recoveryLabel(state: EffectRecoveryState): string {
  switch (state) {
    case "recoverable":
      return "Recoverable";
    case "irreversible":
      return "Irreversible";
    case "recovered":
      return "Recovered";
    case "recovery-failed":
      return "Recovery failed";
    case "ambiguous":
      return "Ambiguous";
    default:
      return "Unavailable";
  }
}

function recoveryTone(state: EffectRecoveryState): ChipTone {
  switch (state) {
    case "recovered":
      return "ok";
    case "recovery-failed":
      return "danger";
    case "ambiguous":
      return "warn";
    case "recoverable":
      return "plum";
    default:
      return "muted";
  }
}
