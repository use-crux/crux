import { afterEach, describe, expect, it } from "vitest";
import {
  observe,
  resetObservabilityRuntime,
  type CruxGraphRecord,
} from "@use-crux/core/observability";
import { resetHooks, updateHooks } from "@use-crux/core";
import {
  defineCompletedOperation,
  runCompletedMediaOperation,
} from "@use-crux/core/adapter";
import { withTelemetry } from "../src";
import type { TraceSpan } from "../src/types";

const FORBIDDEN = [
  "SECRET_BYTES",
  "SECRET_URL",
  "SECRET_ID",
  "data:image",
  "asset://SECRET",
  "base64,",
] as const;

describe("OTel multimodal media export", () => {
  afterEach(() => {
    resetObservabilityRuntime();
    resetHooks();
  });

  it("maps media primitives to documented gen_ai operation names and span names", async () => {
    const spans: TraceSpan[] = [];
    const installed = withTelemetry({
      exporter: (batch) => {
        spans.push(...batch);
      },
    }).install({});

    for (const [primitive, operation, model] of [
      ["media.generate_image", "generate_image", "gpt-image-1"],
      ["media.transcribe", "transcribe", "whisper-1"],
      ["media.generate_speech", "generate_speech", "tts-1"],
      ["media.describe", "generate_content", "gemini-2.5-flash"],
    ] as const) {
      const span = observe.openSpan({
        name: `${operation} ${model}`,
        primitive,
        attributes: {
          provider: "test",
          model,
          executionKind: "native",
          calls: 1,
        },
      });
      span.end({
        attributes: {
          executionKind: "native",
          calls: 1,
          segments: primitive === "media.transcribe" ? 2 : undefined,
        },
      });
    }
    installed.dispose?.();

    expect(
      spans
        .filter((span) => typeof span.attributes["gen_ai.operation.name"] === "string")
        .map((span) => ({
          name: span.name,
          operation: span.attributes["gen_ai.operation.name"],
          model: span.attributes["gen_ai.request.model"],
        })),
    ).toEqual(
      expect.arrayContaining([
        {
          name: "generate_image gpt-image-1",
          operation: "generate_image",
          model: "gpt-image-1",
        },
        {
          name: "transcribe whisper-1",
          operation: "transcribe",
          model: "whisper-1",
        },
        {
          name: "generate_speech tts-1",
          operation: "generate_speech",
          model: "tts-1",
        },
        {
          name: "generate_content gemini-2.5-flash",
          operation: "generate_content",
          model: "gemini-2.5-flash",
        },
      ]),
    );

    const transcribe = spans.find(
      (span) => span.attributes["gen_ai.operation.name"] === "transcribe",
    );
    expect(transcribe?.attributes).toMatchObject({
      "crux.executionKind": "native",
      "crux.calls": 1,
      "crux.segments": 2,
    });
  });

  it("keeps production text off by default and never weakens media sanitizer on opt-in", async () => {
    const secretAudio = new Uint8Array([1, 2, 3, 4]);
    const definition = defineCompletedOperation({
      normalize: (input: Readonly<{ model: string; audio: Uint8Array }>) =>
        Object.freeze(input),
      support: () => "supported" as const,
      invoke: async (input, context) =>
        context.call("audio.transcribe", async () => ({
          text: "TRANSCRIPT_TEXT hello speaker",
          segments: [
            {
              start: 0,
              end: 1,
              text: "TRANSCRIPT_TEXT hello",
              speaker: "SPEAKER_A",
            },
          ],
          audio: secretAudio,
          url: "https://example.com/SECRET_URL.wav",
          fileId: "SECRET_ID",
        })),
      validate: (raw) => ({
        text: raw.text,
        segments: raw.segments,
        warnings: [],
        execution: { kind: "native" as const, calls: 1 },
        raw,
      }),
      report: () => ({ kind: "audio" as const, segments: 1 }),
      conformance: [],
    });

    async function runOnce(captureMessageContent: boolean): Promise<{
      spans: TraceSpan[];
      records: CruxGraphRecord[];
    }> {
      resetObservabilityRuntime();
      resetHooks();
      const spans: TraceSpan[] = [];
      const installed = withTelemetry({
        captureMessageContent,
        exporter: (batch) => {
          spans.push(...batch);
        },
      }).install({});
      // Local capture remains useful by default.
      updateHooks({
        observabilityCapture: {
          recordInputs: true,
          recordOutputs: true,
        },
      });
      await runCompletedMediaOperation({
        definition,
        provider: "openai",
        operation: "transcribe",
        model: "whisper-1",
        input: { model: "whisper-1", audio: secretAudio },
      });
      await observe.flush();
      installed.dispose?.();
      return { spans, records: [] };
    }

    const off = await runOnce(false);
    const offJson = JSON.stringify(off.spans);
    expect(offJson).not.toContain("TRANSCRIPT_TEXT");
    expect(offJson).not.toContain("SPEAKER_A");
    for (const token of FORBIDDEN) {
      expect(offJson).not.toContain(token);
    }

    const on = await runOnce(true);
    const onJson = JSON.stringify(on.spans);
    // Opt-in may export transcript text, but never raw media locators/bytes.
    for (const token of FORBIDDEN) {
      expect(onJson).not.toContain(token);
    }
    expect(onJson).not.toContain("SECRET_ID");
    expect(onJson).not.toContain("SECRET_URL");
  });
});
