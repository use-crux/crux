/**
 * Run-detail card for `defer.scheduled` / `defer.run` spans.
 *
 * Keeps host reliability boundaries honest: handler-returned completion may
 * overlap streaming bodies, while named intent states stay explicit.
 */

import { Chip } from "@/qw/shell/primitives";
import type { ObservabilityRunDetailNode } from "@/types";
import {
  deferPresentationFromAttributes,
  type DeferredSpanPresentation,
} from "../lib/span-detail-defer";

export function DeferredWorkCard({
  node,
}: {
  node: ObservabilityRunDetailNode;
}) {
  const presentation = deferPresentationFromAttributes(
    (node.attributes ?? undefined) as Record<string, unknown> | undefined,
    node.primitive,
  );
  if (!presentation) {
    return (
      <div className="text-[12px]" style={{ color: "var(--qw-fg-muted)" }}>
        Deferred work details unavailable.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {presentation.mode && (
          <Chip tone="crux">{presentation.mode}</Chip>
        )}
        {presentation.stateLabel && (
          <Chip tone={stateTone(presentation)} dot>
            {presentation.stateLabel}
          </Chip>
        )}
        {presentation.completion && (
          <Chip tone="muted">{presentation.completion}</Chip>
        )}
      </div>

      {presentation.streamingNote && (
        <div
          className="rounded-md border px-3 py-2 text-[12px] leading-relaxed"
          style={{
            borderColor: "var(--qw-line)",
            background: "var(--qw-bg-soft)",
            color: "var(--qw-fg-muted)",
          }}
        >
          {presentation.streamingNote}
        </div>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
        {presentation.sequence !== undefined && (
          <>
            <dt style={{ color: "var(--qw-fg-muted)" }}>Sequence</dt>
            <dd>{presentation.sequence}</dd>
          </>
        )}
        {presentation.targetId && (
          <>
            <dt style={{ color: "var(--qw-fg-muted)" }}>Target</dt>
            <dd className="font-mono break-all">{presentation.targetId}</dd>
          </>
        )}
        {presentation.workId && (
          <>
            <dt style={{ color: "var(--qw-fg-muted)" }}>Work</dt>
            <dd className="font-mono break-all">{presentation.workId}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

function stateTone(
  presentation: DeferredSpanPresentation,
): "ok" | "danger" | "warn" | "muted" | "crux" {
  const state = presentation.intentState ?? presentation.outcome;
  switch (state) {
    case "released":
    case "completed":
      return "ok";
    case "failed":
    case "abandoned":
      return "danger";
    case "timed-out":
    case "cancelled":
      return "warn";
    case "staged":
    case "running":
      return "crux";
    default:
      return "muted";
  }
}
