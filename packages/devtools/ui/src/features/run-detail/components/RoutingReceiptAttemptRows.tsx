import type { ReactNode } from "react";
import { Chip, type ChipTone } from "@/qw/shell/primitives";
import { RoutingStepShell } from "./RoutingReceiptStepShell";
import {
  fmtCost,
  fmtDuration,
  shortModelId,
} from "../lib/span-detail-inspection";
import type {
  RoutingAttemptView,
  RoutingStepView,
  RoutingTierView,
} from "../lib/routing-receipt";

export function AttemptStep({
  title,
  kind,
  attempts,
  index,
  right,
}: {
  title: string;
  kind: "retry" | "fallback";
  attempts: RoutingAttemptView[];
  index: number;
  right?: ReactNode;
}) {
  return (
    <RoutingStepShell
      title={title}
      index={index}
      right={
        <div className="flex gap-1.5">
          <Chip tone="muted" mono>
            {attempts.length}x
          </Chip>
          {right}
        </div>
      }
    >
      <div className="flex flex-col gap-1.5">
        {attempts.map((attempt, attemptIndex) => (
          <AttemptRow
            key={`${kind}-${attempt.model}-${attemptIndex}`}
            attempt={attempt}
            index={attemptIndex}
          />
        ))}
      </div>
    </RoutingStepShell>
  );
}

function AttemptRow({
  attempt,
  index,
}: {
  attempt: RoutingAttemptView;
  index: number;
}) {
  const ok = attempt.status === "ok";
  return (
    <div className="flex flex-col gap-1">
      <div
        className="grid items-center gap-2 font-mono text-[11.5px]"
        style={{ gridTemplateColumns: "22px minmax(0, 1fr) 72px 64px auto" }}
      >
        <span style={{ color: "var(--qw-fg-faint)" }}>{index + 1}</span>
        <span
          className="truncate font-semibold"
          style={{ color: "var(--qw-fg)" }}
        >
          {shortModelId(attempt.model) ?? attempt.model}
        </span>
        <span style={{ color: "var(--qw-fg-muted)" }}>
          {attempt.durationMs != null ? fmtDuration(attempt.durationMs) : ""}
        </span>
        <span style={{ color: "var(--qw-fg-muted)" }}>
          {attempt.cost != null ? fmtCost(attempt.cost) : ""}
        </span>
        <Chip tone={ok ? "ok" : "warn"} dot>
          {attempt.errorCategory ?? attempt.status}
        </Chip>
      </div>
      {(attempt.delayMs != null || attempt.error) && (
        <div
          className="flex flex-wrap gap-x-3 gap-y-1 pl-[30px] font-mono text-[10.5px]"
          style={{ color: "var(--qw-fg-faint)" }}
        >
          {attempt.delayMs != null && (
            <span>delay {fmtDuration(attempt.delayMs)}</span>
          )}
          {attempt.error && (
            <span title={attempt.error} style={{ overflowWrap: "anywhere" }}>
              {boundedReceiptText(attempt.error)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function CascadeStep({
  step,
  index,
}: {
  step: Extract<RoutingStepView, { kind: "cascade" }>;
  index: number;
}) {
  return (
    <RoutingStepShell
      title="Cascade"
      index={index}
      right={
        <div className="flex gap-1.5">
          {step.acceptedAtTier != null && (
            <Chip tone="ok" mono>
              tier {step.acceptedAtTier + 1}
            </Chip>
          )}
          {step.budgetExceeded && <Chip tone="warn">budget</Chip>}
        </div>
      }
    >
      <div className="flex flex-col gap-1.5">
        {step.tiers.map((tier, tierIndex) => (
          <TierRow key={`${tier.model}-${tierIndex}`} tier={tier} />
        ))}
      </div>
    </RoutingStepShell>
  );
}

function TierRow({ tier }: { tier: RoutingTierView }) {
  return (
    <div className="flex flex-col gap-1">
      <div
        className="grid items-center gap-2 font-mono text-[11.5px]"
        style={{
          gridTemplateColumns: "22px minmax(0, 1fr) 72px 76px 72px auto",
        }}
      >
        <span style={{ color: "var(--qw-fg-faint)" }}>{tier.index + 1}</span>
        <span
          className="truncate font-semibold"
          style={{ color: "var(--qw-fg)" }}
        >
          {shortModelId(tier.model) ?? tier.model}
        </span>
        <span style={{ color: "var(--qw-fg-muted)" }}>
          {tier.durationMs != null ? fmtDuration(tier.durationMs) : ""}
        </span>
        <span style={{ color: "var(--qw-fg-muted)" }}>
          {tier.cost != null ? fmtCost(tier.cost) : ""}
        </span>
        <span style={{ color: "var(--qw-fg-muted)" }}>
          {tier.judgeCost != null ? `judge ${fmtCost(tier.judgeCost)}` : ""}
        </span>
        <Chip tone={tierTone(tier.status)} dot>
          {tier.confidence != null
            ? `${tier.status} ${tier.confidence.toFixed(2)}`
            : tier.status}
        </Chip>
      </div>
      {(tier.budget != null || tier.note) && (
        <div
          className="flex flex-wrap gap-x-3 gap-y-1 pl-[30px] font-mono text-[10.5px]"
          style={{ color: "var(--qw-fg-faint)" }}
        >
          {tier.budget != null && <span>budget {fmtCost(tier.budget)}</span>}
          {tier.note && (
            <span title={tier.note} style={{ overflowWrap: "anywhere" }}>
              {boundedReceiptText(tier.note)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function boundedReceiptText(value: string, limit = 180): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, limit - 3)}...`;
}

function tierTone(status: string): ChipTone {
  if (status === "accepted") return "ok";
  if (status === "rejected" || status === "error") return "warn";
  return "muted";
}
