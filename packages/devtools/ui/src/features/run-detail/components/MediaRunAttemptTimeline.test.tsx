import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MediaRunAttempt } from "../lib/media-run-projection";
import { MediaRunAttemptTimeline } from "./MediaRunAttemptTimeline";

describe("MediaRunAttemptTimeline", () => {
  it("renders safe progressive facts for each physical attempt", () => {
    const html = renderToStaticMarkup(
      <MediaRunAttemptTimeline
        attempts={[
          attempt({
            spanId: "attempt-1",
            attempt: 1,
            previewCount: 2,
            deltaCount: 3,
            finalCount: 0,
            byteCount: 1_500,
            mediaTypes: ["image/png"],
          }),
          attempt({
            spanId: "attempt-2",
            attempt: 2,
            previewCount: 0,
            deltaCount: 4,
            finalCount: 1,
            byteCount: 2_400,
            mediaTypes: ["image/webp", "image/png"],
          }),
        ]}
      />,
    );

    expect(html).toContain("2 previews");
    expect(html).toContain("3 deltas");
    expect(html).toContain("0 finals");
    expect(html).toContain("1,500 bytes");
    expect(html).toContain("4 deltas");
    expect(html).toContain("1 final");
    expect(html).toContain("2,400 bytes");
    expect(html).toContain("image/png");
    expect(html).toContain("image/webp");
  });

  it("does not render payload-bearing fields from an attempt", () => {
    const unsafeAttempt = {
      ...attempt({
        previewCount: 1,
        deltaCount: 1,
        finalCount: 1,
        byteCount: 64,
        mediaTypes: ["audio/l16; rate=24000; channels=1"],
      }),
      prompt: "SECRET_PROMPT",
      data: "SECRET_BASE64",
      raw: { nativeEvent: "SECRET_NATIVE_EVENT" },
      url: "https://files.example/SECRET_AUDIO",
      filename: "SECRET.wav",
    } as MediaRunAttempt;
    const html = renderToStaticMarkup(
      <MediaRunAttemptTimeline attempts={[unsafeAttempt]} />,
    );

    expect(html).toContain("audio/l16; rate=24000; channels=1");
    expect(html).not.toMatch(
      /SECRET|prompt|base64|nativeEvent|https?:|filename|<img|<audio/i,
    );
  });
});

function attempt(overrides: Partial<MediaRunAttempt> = {}): MediaRunAttempt {
  return {
    spanId: "attempt",
    primitive: "media.generate_image",
    name: "media.generate_image",
    status: "ok",
    role: "attempt",
    provider: "openai",
    model: "gpt-image-1",
    terminal: "ok",
    committed: true,
    ...overrides,
  };
}
