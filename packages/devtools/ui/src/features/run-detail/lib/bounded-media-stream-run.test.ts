import { describe, expect, it } from "vitest";
import {
  assertNoRetainedMediaSecrets,
  projectMediaRunView,
  type GraphLikeRecord,
} from "./media-run-projection";

type Operation = "streamImage" | "streamSpeech";
type Terminal = "ok" | "error" | "cancelled" | "timeout";

interface Scenario {
  readonly name: string;
  readonly operation: Operation;
  readonly terminal: Terminal;
  readonly committed: boolean;
  readonly previewCount?: number;
  readonly deltaCount?: number;
  readonly finalCount?: number;
  readonly byteCount?: number;
  readonly attemptCount?: number;
  readonly route?: string;
  readonly attempts?: readonly AttemptFixture[];
  readonly safety?: SafetyFixture;
}

interface AttemptFixture {
  readonly terminal: Terminal;
  readonly committed: boolean;
  readonly deltaCount?: number;
  readonly finalCount?: number;
}

interface SafetyFixture {
  readonly mode: "enforce" | "report";
  readonly action: "allow" | "block";
  readonly phase: "preview" | "final";
}

const scenarios = [
  {
    name: "successful image preview streaming",
    operation: "streamImage",
    terminal: "ok",
    committed: true,
    previewCount: 2,
    finalCount: 1,
    byteCount: 900,
  },
  {
    name: "image byte streaming",
    operation: "streamImage",
    terminal: "ok",
    committed: true,
    deltaCount: 3,
    finalCount: 1,
    byteCount: 1_500,
  },
  {
    name: "speech byte streaming",
    operation: "streamSpeech",
    terminal: "ok",
    committed: true,
    deltaCount: 4,
    finalCount: 1,
    byteCount: 2_400,
  },
  {
    name: "pre-commit fallback",
    operation: "streamImage",
    terminal: "ok",
    committed: true,
    attemptCount: 2,
    route: "fallback",
    attempts: [
      { terminal: "error", committed: false, deltaCount: 1 },
      { terminal: "ok", committed: true, finalCount: 1 },
    ],
  },
  {
    name: "post-commit failure",
    operation: "streamImage",
    terminal: "error",
    committed: true,
    deltaCount: 1,
    attempts: [{ terminal: "error", committed: true, deltaCount: 1 }],
  },
  {
    name: "enforcing Safety hold and release",
    operation: "streamSpeech",
    terminal: "ok",
    committed: true,
    deltaCount: 2,
    finalCount: 1,
    safety: { mode: "enforce", action: "allow", phase: "final" },
  },
  {
    name: "Safety block",
    operation: "streamImage",
    terminal: "error",
    committed: false,
    previewCount: 1,
    safety: { mode: "enforce", action: "block", phase: "preview" },
  },
  {
    name: "cancellation",
    operation: "streamSpeech",
    terminal: "cancelled",
    committed: false,
  },
  {
    name: "timeout",
    operation: "streamSpeech",
    terminal: "timeout",
    committed: false,
  },
] as const satisfies readonly Scenario[];

describe("bounded media stream run projection", () => {
  it.each(scenarios)("projects $name", (scenario: Scenario) => {
    const view = projectMediaRunView(streamGraph(scenario));

    expect(view?.boundedStream).toMatchObject({
      operation: scenario.operation,
      terminal: scenario.terminal,
      committed: scenario.committed,
      attemptCount: scenario.attemptCount ?? scenario.attempts?.length ?? 1,
      previewCount: scenario.previewCount ?? 0,
      deltaCount: scenario.deltaCount ?? 0,
      finalCount: scenario.finalCount ?? 0,
      byteCount: scenario.byteCount ?? 0,
      mediaTypes: [
        scenario.operation === "streamImage" ? "image/png" : "audio/pcm",
      ],
      firstPublicEventMs: 12,
      durationMs: 42,
      ...(scenario.route ? { route: scenario.route } : {}),
    });
    expect(view?.attempts).toHaveLength(scenario.attempts?.length ?? 1);
    expect(view?.attempts.every((attempt) => attempt.role === "attempt")).toBe(
      true,
    );
    expect(
      view?.attempts.some((attempt) => attempt.spanId === "logical"),
    ).toBe(false);
    if (scenario.safety) {
      expect(view?.boundedStream?.safety.occurrences).toEqual([
        expect.objectContaining({
          phase: scenario.safety.phase,
          mode: scenario.safety.mode,
          action: scenario.safety.action,
        }),
      ]);
    }
    if (scenario.name === "enforcing Safety hold and release") {
      expect(view?.boundedStream?.safety.deltaDelivery).toBe("held-released");
    }
    if (scenario.name === "Safety block") {
      expect(view?.boundedStream?.safety).toMatchObject({
        blocked: true,
        deltaDelivery: "held-discarded",
      });
    }
    expect(JSON.stringify(view)).not.toContain("SECRET_MEDIA_TYPE_URL");
    expect(assertNoRetainedMediaSecrets(view)).toEqual([]);
  });
});

function streamGraph(scenario: Scenario): readonly GraphLikeRecord[] {
  const primitive =
    scenario.operation === "streamImage"
      ? "media.generate_image"
      : "media.generate_speech";
  const mediaType =
    scenario.operation === "streamImage" ? "image/png" : "audio/pcm";
  const attempts = scenario.attempts ?? [
    {
      terminal: scenario.terminal,
      committed: scenario.committed,
      deltaCount: scenario.deltaCount,
      finalCount: scenario.finalCount,
    },
  ];
  const records: GraphLikeRecord[] = [
    {
      type: "span:start",
      spanId: "logical",
      primitive,
      name: scenario.operation,
      attributes: {
        operation: scenario.operation,
        streamingRole: "logical",
        provider: "test",
        model: "safe-model",
        ...(scenario.route ? { route: scenario.route } : {}),
        prompt: "SECRET_PROMPT",
        nativeEvent: "SECRET_NATIVE_EVENT",
      },
    },
    ...attempts.flatMap((attempt, index): GraphLikeRecord[] => [
      {
        type: "span:start",
        spanId: `attempt-${index + 1}`,
        parentSpanId: "logical",
        primitive,
        name: `${scenario.operation} attempt`,
        attributes: {
          operation: scenario.operation,
          streamingRole: "attempt",
          attempt: index + 1,
          provider: "test",
          model: `safe-model-${index + 1}`,
        },
      },
      {
        type: "span:end",
        spanId: `attempt-${index + 1}`,
        status: attempt.terminal === "ok" ? "ok" : "error",
        durationMs: 20,
        attributes: {
          terminal: attempt.terminal,
          committed: attempt.committed,
          previewCount: 0,
          deltaCount: attempt.deltaCount ?? 0,
          finalCount: attempt.finalCount ?? 0,
          byteCount: (attempt.deltaCount ?? attempt.finalCount ?? 0) * 100,
          mediaTypes: [
            mediaType,
            "https://example.test/SECRET_MEDIA_TYPE_URL",
          ],
        },
      },
    ]),
    {
      type: "span:end",
      spanId: "logical",
      status: scenario.terminal === "ok" ? "ok" : "error",
      durationMs: 42,
      attributes: {
        operation: scenario.operation,
        terminal: scenario.terminal,
        committed: scenario.committed,
        attemptCount: scenario.attemptCount ?? attempts.length,
        previewCount: scenario.previewCount ?? 0,
        deltaCount: scenario.deltaCount ?? 0,
        finalCount: scenario.finalCount ?? 0,
        byteCount: scenario.byteCount ?? 0,
        mediaTypes: [mediaType],
        firstEventMs: 12,
        durationMs: 42,
      },
    },
  ];
  if (scenario.safety) {
    records.push({
      type: "artifact",
      spanId: "attempt-1",
      kind: "guardrail.report",
      preview: {
        kind: "guardrail.report",
        target: { id: "model.output.media", label: "Model output · Media" },
        originKind: "operation",
        operation: scenario.operation,
        operationPhase: scenario.safety.phase,
        field:
          scenario.operation === "streamImage" ? "images" : "audio",
        outputIndex: 0,
        sequence: scenario.safety.phase === "preview" ? 0 : undefined,
        mediaPartType:
          scenario.operation === "streamImage" ? "image" : "audio",
        mode: scenario.safety.mode,
        action: scenario.safety.action,
        payload: "SECRET_HELD_BYTES",
      },
    });
  }
  return records;
}
