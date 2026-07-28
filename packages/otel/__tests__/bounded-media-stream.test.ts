import { afterEach, describe, expect, it } from "vitest";
import {
  observe,
  resetObservabilityRuntime,
} from "@use-crux/core/observability";
import { withTelemetry } from "../src";
import type { TraceSpan } from "../src/types";

describe("OTel bounded media stream projection", () => {
  afterEach(() => resetObservabilityRuntime());

  it.each([
    ["streamImage", "media.generate_image", "image/png"],
    ["streamSpeech", "media.generate_speech", "audio/pcm"],
  ] as const)(
    "preserves safe logical and attempt facts for %s",
    (operation, primitive, mediaType) => {
      const spans: TraceSpan[] = [];
      const installed = withTelemetry({
        exporter: (batch) => {
          spans.push(...batch);
        },
      }).install({});
      const logical = observe.openSpan({
        name: operation,
        primitive,
        attributes: {
          provider: "test",
          model: "safe-model",
          operation,
          streamingRole: "logical",
          route: "fallback",
          prompt: "SECRET_PROMPT",
          bytes: "SECRET_BYTES",
          url: "https://private.example/SECRET_URL",
        },
      });
      logical.withContext(() => {
        const attempt = observe.openSpan({
          name: `${operation} attempt`,
          primitive,
          implicitRun: false,
          attributes: {
            provider: "test",
            model: "safe-model-1",
            operation,
            streamingRole: "attempt",
            attempt: 1,
          },
        });
        attempt.end({
          attributes: {
            committed: false,
            terminal: "error",
            previewCount: 0,
            deltaCount: 1,
            finalCount: 0,
            byteCount: 120,
            mediaTypes: [mediaType],
            firstEventMs: 5,
            durationMs: 12,
          },
        });
      });
      logical.end({
        attributes: {
          committed: true,
          terminal: "ok",
          attemptCount: 1,
          previewCount: operation === "streamImage" ? 1 : 0,
          deltaCount: 2,
          finalCount: 1,
          byteCount: 480,
          mediaTypes: [mediaType],
          firstEventMs: 8,
          durationMs: 25,
        },
      });
      installed.dispose?.();

      const logicalSpan = spans.find(
        (span) => span.attributes["crux.streamingRole"] === "logical",
      );
      const attemptSpan = spans.find(
        (span) => span.attributes["crux.streamingRole"] === "attempt",
      );
      expect(logicalSpan?.attributes).toMatchObject({
        "crux.operation": operation,
        "crux.route": "fallback",
        "crux.committed": true,
        "crux.terminal": "ok",
        "crux.attemptCount": 1,
        "crux.deltaCount": 2,
        "crux.finalCount": 1,
        "crux.byteCount": 480,
        "crux.mediaTypes": [mediaType],
        "crux.firstEventMs": 8,
        "crux.durationMs": 25,
      });
      expect(attemptSpan?.attributes).toMatchObject({
        "crux.operation": operation,
        "crux.attempt": 1,
        "crux.committed": false,
        "crux.terminal": "error",
        "crux.deltaCount": 1,
      });
      expect(attemptSpan?.parentSpanId).toBe(logicalSpan?.spanId);
      const serialized = JSON.stringify(spans);
      for (const secret of [
        "SECRET_PROMPT",
        "SECRET_BYTES",
        "SECRET_URL",
        "private.example",
      ]) {
        expect(serialized).not.toContain(secret);
      }
    },
  );
});
