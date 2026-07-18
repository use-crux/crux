import { Icon } from "@/devtools/shell/Icon";
import { DevtoolsTooltip } from "@/devtools/shell/DevtoolsTooltip";
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
      ? "var(--devtools-danger)"
      : tone === "warn"
        ? "var(--devtools-warn)"
        : "var(--devtools-crux)";
  return (
    <DevtoolsTooltip content={parts.join(" · ")}>
      <span
        className="flex flex-shrink-0 items-center"
        style={{ color }}
        aria-label={parts.join(", ")}
      >
        <Icon name="layers" size={11} color={color} />
      </span>
    </DevtoolsTooltip>
  );
}
