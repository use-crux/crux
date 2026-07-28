/**
 * Run header — the persistent chrome above every lens (design `v7-parts`
 * `RunHeader` + `LensBar`, integrated per `v7-integrated`).
 *
 * Breadcrumb · kind · name · status · provider/model · headline metric strip ·
 * diagnostics badge · actions, then the lens segmented control. The metrics
 * live here (run-level) so collapsing the inspector never hides the numbers.
 */

import { Btn } from "@/devtools/shell/primitives";
import { Icon } from "@/devtools/shell/Icon";
import {
  fmtCost,
  fmtDuration,
  fmtTokens,
} from "@/features/run-detail/lib/span-detail-inspection";
import type { RunLens } from "@/features/run-detail/types";
import type { CruxObservabilityRedactionEvidence } from "@use-crux/core/observability";
import {
  KindTag,
  StatStrip,
  StatusPill,
  LensSwitch,
  type RunNodeKind,
} from "./atoms";
import { RedactionBadge } from "./RedactionEvidence";

export interface RunHeaderProps {
  traceId: string;
  kind: RunNodeKind;
  name: string;
  status: string;
  provider?: string;
  model?: string;
  modelExtraCount?: number;
  modelTitle?: string;
  startedAt?: string;
  durationMs?: number;
  tokens?: number;
  cost?: number;
  cacheRead?: number;
  diagnosticsCount: number;
  redaction?: CruxObservabilityRedactionEvidence;
  lens: RunLens;
  onSelectLens: (lens: RunLens) => void;
  onCompare: () => void;
  onShare: () => void;
  onReplay: () => void;
}

export function RunHeader({
  traceId,
  kind,
  name,
  status,
  provider,
  model,
  modelExtraCount,
  modelTitle,
  startedAt,
  durationMs,
  tokens,
  cost,
  cacheRead,
  diagnosticsCount,
  redaction,
  lens,
  onSelectLens,
  onCompare,
  onShare,
  onReplay,
}: RunHeaderProps) {
  return (
    <header
      className="flex flex-shrink-0 flex-col gap-3 px-7 pb-2.5 pt-3"
      style={{
        borderBottom: "1px solid var(--devtools-border)",
        background: "var(--devtools-bg)",
      }}
    >
      <div
        className="font-mono text-[10.5px] uppercase tracking-[0.06em]"
        style={{ color: "var(--devtools-fg-faint)" }}
      >
        Runs / {traceId.slice(0, 16)}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <KindTag kind={kind} size={10} />
        <h1 className="m-0 text-[21px] font-semibold tracking-[-0.02em]">
          {name}
        </h1>
        <StatusPill status={status} />
        <RedactionBadge evidence={redaction} />
        {(provider || model) && (
          <span
            className="font-mono text-[12px]"
            style={{ color: "var(--devtools-fg-muted)" }}
            title={modelTitle}
          >
            {[provider, model].filter(Boolean).join(" · ")}
            {modelExtraCount != null && modelExtraCount > 0 && (
              <span style={{ color: "var(--devtools-fg-faint)" }}>
                {" "}
                +{modelExtraCount}
              </span>
            )}
          </span>
        )}
        {startedAt && (
          <span
            className="font-mono text-[11px]"
            style={{ color: "var(--devtools-fg-faint)" }}
          >
            · {startedAt}
          </span>
        )}

        <div className="flex-1" />

        <StatStrip
          items={[
            { label: "dur", value: fmtDuration(durationMs) },
            { label: "tokens", value: fmtTokens(tokens) },
            { label: "cost", value: fmtCost(cost) },
            ...(cacheRead != null
              ? [
                  {
                    label: "cache",
                    value: fmtTokens(cacheRead),
                    tone: "ok" as const,
                  },
                ]
              : []),
          ]}
          size={11.5}
          gap={14}
        />

        {diagnosticsCount > 0 && (
          <div
            className="flex items-center gap-1.5 rounded-[6px] px-2 py-1"
            style={{ background: "var(--devtools-warn-soft)" }}
            title={`${diagnosticsCount} run diagnostic${diagnosticsCount === 1 ? "" : "s"}`}
          >
            <Icon name="alert" size={13} color="var(--devtools-warn)" />
            <span
              className="text-[11px] font-semibold"
              style={{ color: "var(--devtools-warn)" }}
            >
              {diagnosticsCount}
            </span>
          </div>
        )}

        <div
          className="mx-0.5 h-5 w-px"
          style={{ background: "var(--devtools-border)" }}
        />

        <Btn
          size="sm"
          icon={<Icon name="compare" size={13} />}
          onClick={onCompare}
        >
          Compare
        </Btn>
        <Btn
          size="sm"
          icon={<Icon name="arrowUp" size={13} />}
          onClick={onShare}
        >
          Share
        </Btn>
        <Btn
          size="sm"
          variant="primary"
          icon={<Icon name="play" size={13} />}
          onClick={onReplay}
        >
          Replay
        </Btn>
      </div>

      <div>
        <LensSwitch active={lens} onSelect={onSelectLens} dense />
      </div>
    </header>
  );
}
