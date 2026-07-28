import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BoundedMediaStreamRun } from "../lib/media-run-projection-types";
import { BoundedMediaStreamCard } from "./BoundedMediaStreamCard";

function stream(
  overrides: Partial<BoundedMediaStreamRun> = {},
): BoundedMediaStreamRun {
  return {
    operation: "streamImage",
    role: "logical",
    route: "fallback",
    committed: true,
    attemptCount: 2,
    previewCount: 2,
    deltaCount: 3,
    finalCount: 1,
    byteCount: 1_500,
    mediaTypes: ["image/png"],
    firstPublicEventMs: 12,
    durationMs: 42,
    terminal: "ok",
    safety: {
      occurrences: [
        {
          phase: "preview",
          mode: "enforce",
          action: "allow",
          mediaPartType: "image",
          outputIndex: 0,
          sequence: 1,
        },
        {
          phase: "final",
          mode: "enforce",
          action: "allow",
          mediaPartType: "image",
          outputIndex: 0,
        },
      ],
      blocked: false,
      deltaDelivery: "held-released",
    },
    ...overrides,
  };
}

describe("BoundedMediaStreamCard", () => {
  it("renders safe progressive, routing, commitment, and Safety facts", () => {
    const html = renderToStaticMarkup(
      <BoundedMediaStreamCard stream={stream()} />,
    );

    expect(html).toContain("Bounded media stream");
    expect(html).toContain("streamImage");
    expect(html).toContain("fallback");
    expect(html).toContain("committed");
    expect(html).toContain("2 attempts");
    expect(html).toContain("2 previews");
    expect(html).toContain("3 deltas");
    expect(html).toContain("1 final");
    expect(html).toContain("1,500 bytes");
    expect(html).toContain("image/png");
    expect(html).toContain("first public event 12 ms");
    expect(html).toContain("total 42 ms");
    expect(html).toContain("held, then released");
    expect(html).toContain("preview");
    expect(html).toContain("final");
    expect(html).not.toMatch(/prompt|base64|filename|asset:|https?:|<img/i);
  });

  it("renders block, cancellation, and timeout terminal states honestly", () => {
    const blocked = renderToStaticMarkup(
      <BoundedMediaStreamCard
        stream={stream({
          committed: false,
          terminal: "error",
          safety: {
            occurrences: [
              {
                phase: "preview",
                mode: "enforce",
                action: "block",
                mediaPartType: "image",
                outputIndex: 0,
                sequence: 0,
              },
            ],
            blocked: true,
            deltaDelivery: "held-discarded",
          },
        })}
      />,
    );
    expect(blocked).toContain("not committed");
    expect(blocked).toContain("blocked");
    expect(blocked).toContain("held, then discarded");

    for (const terminal of ["cancelled", "timeout"] as const) {
      const html = renderToStaticMarkup(
        <BoundedMediaStreamCard
          stream={stream({ terminal, committed: false })}
        />,
      );
      expect(html).toContain(terminal);
      expect(html).toContain("not committed");
    }
  });
});
