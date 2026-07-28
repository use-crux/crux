/**
 * Purpose-built, payload-free presentation for one logical bounded stream.
 *
 * The card renders progress counters and canonical Safety coordinates only.
 * It intentionally has no media preview, playback, download, or raw-event UI.
 */

import type { BoundedMediaStreamRun } from "../lib/media-run-projection-types";

/** Render safe progressive facts for one logical bounded media stream. */
export function BoundedMediaStreamCard({
  stream,
}: {
  readonly stream: BoundedMediaStreamRun;
}) {
  return (
    <section
      aria-label="Bounded media stream"
      className="grid gap-2 rounded-md border border-(--devtools-border) p-2"
    >
      <header className="flex flex-wrap items-center gap-2 text-xs">
        <strong className="text-(--devtools-fg)">Bounded media stream</strong>
        <code>{stream.operation}</code>
        <span>{stream.terminal}</span>
      </header>

      <p className="text-xs text-(--devtools-fg-muted)">
        {[
          stream.route ? `route ${stream.route}` : undefined,
          stream.committed ? "committed" : "not committed",
          countLabel(stream.attemptCount, "attempt"),
          countLabel(stream.previewCount, "preview"),
          countLabel(stream.deltaCount, "delta"),
          countLabel(stream.finalCount, "final"),
          `${stream.byteCount.toLocaleString("en-US")} bytes`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>

      <p className="text-xs text-(--devtools-fg-muted)">
        {[
          ...stream.mediaTypes,
          stream.firstPublicEventMs !== undefined
            ? `first public event ${formatMs(stream.firstPublicEventMs)} ms`
            : "first public event unavailable",
          stream.durationMs !== undefined
            ? `total ${formatMs(stream.durationMs)} ms`
            : "total duration unavailable",
        ].join(" · ")}
      </p>

      <div aria-label="Streaming Safety" className="grid gap-1 text-xs">
        <h4 className="font-medium text-(--devtools-fg-muted)">Safety</h4>
        <p>
          {stream.safety.blocked ? "blocked" : "not blocked"} ·{" "}
          {deltaDeliveryLabel(stream.safety.deltaDelivery)}
        </p>
        {stream.safety.occurrences.length > 0 ? (
          <ul className="grid gap-1">
            {stream.safety.occurrences.map((occurrence, index) => (
              <li
                key={`${occurrence.phase}-${occurrence.outputIndex ?? "none"}-${occurrence.sequence ?? "none"}-${index}`}
              >
                {[
                  occurrence.phase,
                  occurrence.mode,
                  occurrence.action,
                  occurrence.mediaPartType,
                  occurrence.outputIndex !== undefined
                    ? `output ${occurrence.outputIndex}`
                    : undefined,
                  occurrence.sequence !== undefined
                    ? `sequence ${occurrence.sequence}`
                    : undefined,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </li>
            ))}
          </ul>
        ) : (
          <p role="status" className="text-(--devtools-fg-muted)">
            No output-media Safety occurrence was recorded.
          </p>
        )}
      </div>
    </section>
  );
}

function countLabel(value: number, noun: string): string {
  return `${value.toLocaleString("en-US")} ${noun}${value === 1 ? "" : "s"}`;
}

function formatMs(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function deltaDeliveryLabel(
  delivery: BoundedMediaStreamRun["safety"]["deltaDelivery"],
): string {
  if (delivery === "held-released") return "held, then released";
  if (delivery === "held-discarded") return "held, then discarded";
  if (delivery === "live") return "streamed live in report mode";
  return "hold behavior not observed";
}
