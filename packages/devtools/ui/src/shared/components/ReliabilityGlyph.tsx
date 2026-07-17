import { Icon } from "@/qw/shell/Icon";
import { QwTooltip } from "@/qw/shell/QwTooltip";
import {
  reliabilityParts,
  reliabilityTone,
  type ReliabilitySignals,
} from "@/shared/lib/run-reliability";

/** Shared Runs/Run Detail reliability glyph and tooltip. */
export function ReliabilityGlyph({ run }: { run: ReliabilitySignals }) {
  const parts = reliabilityParts(run);
  const tone = reliabilityTone(run);
  const color =
    tone === "danger"
      ? "var(--qw-danger)"
      : tone === "warn"
        ? "var(--qw-warn)"
        : "var(--qw-crux)";
  return (
    <QwTooltip content={parts.join(" · ")}>
      <span
        className="flex flex-shrink-0 items-center"
        style={{ color }}
        aria-label={parts.join(", ")}
      >
        <Icon name="layers" size={11} color={color} />
      </span>
    </QwTooltip>
  );
}
