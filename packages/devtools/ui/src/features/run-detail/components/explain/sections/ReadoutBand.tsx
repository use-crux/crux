/**
 * The readout band — the lead of the `Explain` tab. The eyebrow + a one-line
 * plain-language readout (serif), then the scan chips that double as jump links
 * into the body. The readout is the backend's deterministic, evidence-bound
 * sentence; we never synthesise prose here.
 */

import type {
  ExplainChip,
  ExplainSection,
} from "@/features/run-detail/lib/explain/chips";
import { SummaryChip } from "../band";

export function ReadoutBand({
  readout,
  chips,
  activeJump,
  onJump,
}: {
  readout: string | undefined;
  chips: readonly ExplainChip[];
  activeJump?: ExplainSection | null;
  onJump: (section: ExplainSection) => void;
}) {
  return (
    <div
      className="mb-5 rounded-[12px] px-[18px] py-4"
      style={{
        background: "var(--qw-bg-elev)",
        border: "1px solid var(--qw-border)",
      }}
    >
      <div className="mb-2.5 flex items-baseline gap-2.5">
        <span
          className="font-mono text-[10.5px] uppercase tracking-[0.16em]"
          style={{ color: "var(--qw-crux)" }}
        >
          Turn explanation
        </span>
        <span
          className="text-[12.5px] italic"
          style={{ fontFamily: "var(--qw-serif)", color: "var(--qw-fg-muted)" }}
        >
          Evidence for what shaped this model call.
        </span>
      </div>
      {readout && (
        <p
          className="m-0 mb-3.5 text-[15px] leading-[1.5]"
          style={{
            fontFamily: "var(--qw-serif)",
            color: "var(--qw-fg)",
            maxWidth: 760,
          }}
        >
          {readout}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <SummaryChip
            key={chip.id}
            chip={chip}
            active={activeJump != null && chip.jump === activeJump}
            onClick={
              chip.jump ? () => onJump(chip.jump as ExplainSection) : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}
