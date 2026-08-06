/**
 * Shared, parameterized conformance suite for adapter normalized outcomes.
 *
 * Every provider adapter — the native single-turn ones (OpenAI, Anthropic,
 * Google) and the loop-owned `@use-crux/ai` runtime — must project its raw
 * finish signals and error surface into the same closed
 * {@link CruxFinishReason}/{@link CruxProviderError} taxonomy. Rather than
 * re-testing that per adapter with bespoke fakes, each adapter drives this one
 * suite with its own exported pure mappers and a small table of provider-raw
 * cases. Reusing the real mappers (instead of fake network clients) keeps the
 * conformance honest: the suite exercises the exact code the runtime uses.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import type {
  CruxFinishReason,
  CruxProviderError,
  CruxProviderErrorKind,
} from "../normalized-outcome";

/** The full closed finish-reason vocabulary, for membership assertions. */
const FINISH_REASONS: readonly CruxFinishReason[] = [
  "stop",
  "length",
  "tool-calls",
  "content-filter",
  "refusal",
  "error",
  "aborted",
  "unknown",
];

/** The full closed provider-error-kind vocabulary, for membership assertions. */
const ERROR_KINDS: readonly CruxProviderErrorKind[] = [
  "refusal",
  "safety",
  "content-filter",
  "rate-limit",
  "timeout",
  "aborted",
  "invalid-request",
  "invalid-response",
  "provider-error",
  "unknown",
];

/** One provider-raw → normalized finish-reason expectation. */
export interface NormalizedFinishReasonCase<TRaw> {
  /** Human-readable case label (usually the raw provider value). */
  readonly label: string;
  /** The raw finish signal as the provider reports it. */
  readonly raw: TRaw;
  /** The normalized finish reason the mapper must produce. */
  readonly expected: CruxFinishReason | undefined;
}

/** One thrown provider error → normalized classification expectation. */
export interface NormalizedErrorCase {
  /** Human-readable case label. */
  readonly label: string;
  /** The value the provider SDK throws. */
  readonly error: unknown;
  /** The normalized error kind the classifier must produce. */
  readonly kind: CruxProviderErrorKind;
  /** Whether the classifier must mark the failure retryable. */
  readonly retryable: boolean;
}

/** Standard HTTP-shaped failures shared by native provider SDK adapters. */
export function standardHttpErrorCases(): readonly NormalizedErrorCase[] {
  return [
    { label: "429", error: Object.assign(new Error("rate limited"), { status: 429 }), kind: "rate-limit", retryable: true },
    { label: "400", error: Object.assign(new Error("bad request"), { status: 400 }), kind: "invalid-request", retryable: false },
    { label: "408", error: Object.assign(new Error("timeout"), { status: 408 }), kind: "timeout", retryable: true },
    { label: "500", error: Object.assign(new Error("server"), { status: 500 }), kind: "provider-error", retryable: true },
    { label: "abort", error: Object.assign(new Error("abort"), { name: "APIUserAbortError" }), kind: "aborted", retryable: false },
  ];
}

/** Per-adapter inputs for {@link describeNormalizedOutcomeConformance}. */
export interface NormalizedOutcomeConformanceSpec<TRaw> {
  /** Adapter name, used in the suite title. */
  readonly name: string;
  /** The adapter's exported pure finish-reason mapper. */
  readonly mapFinishReason: (raw: TRaw) => CruxFinishReason | undefined;
  /** Provider-raw finish-reason cases, one per supported raw value. */
  readonly finishReasonCases: readonly NormalizedFinishReasonCase<TRaw>[];
  /**
   * A raw finish signal the provider vocabulary does not define. Proves an
   * unrecognized value clamps to `"unknown"` instead of leaking through.
   */
  readonly unrecognizedFinishReason: TRaw;
  /**
   * Whether the provider surfaces model-side blocking (safety/recitation/
   * refusal) as a `content-filter`/`refusal` finish reason. When set, the
   * suite asserts at least one such case exists.
   */
  readonly modelSideBlocking?: boolean;
  /** The adapter's error classifier (native `mapError` or the loop classifier). */
  readonly mapError: (error: unknown) => CruxProviderError | undefined;
  /** Thrown-error cases spanning the shared error taxonomy. */
  readonly errorCases: readonly NormalizedErrorCase[];
  /**
   * A thrown value the classifier must not recognize (returns `undefined`), so
   * core's generic normalization owns it. Proves the classifier defers rather
   * than mislabeling unknown failures.
   */
  readonly unrecognizedError: unknown;
}

/**
 * Register the shared normalized-outcome conformance suite for one adapter.
 *
 * Covers, using the adapter's own exported mappers:
 * - finish reasons normalize to the exact expected closed-union value;
 * - every produced finish reason is a member of {@link CruxFinishReason};
 * - an unrecognized finish reason clamps to `"unknown"`;
 * - model-side blocking maps to `content-filter`/`refusal` where applicable;
 * - errors (rate-limit, invalid-request, server/connection, timeout, abort)
 *   classify to the expected `{ kind, retryable }` with a bounded string code;
 * - an unrecognized error defers to core (`undefined`).
 *
 * @param spec - The adapter's mappers and provider-raw case tables.
 */
export function describeNormalizedOutcomeConformance<TRaw>(
  spec: NormalizedOutcomeConformanceSpec<TRaw>,
): void {
  describe(`${spec.name} normalized-outcome conformance`, () => {
    describe("finish reasons map into the closed union", () => {
      for (const testCase of spec.finishReasonCases) {
        it(`maps ${testCase.label} → ${String(testCase.expected)}`, () => {
          const mapped = spec.mapFinishReason(testCase.raw);
          expect(mapped).toBe(testCase.expected);
          if (mapped !== undefined) expect(FINISH_REASONS).toContain(mapped);
        });
      }

      it('clamps an unrecognized finish reason to "unknown"', () => {
        expect(spec.mapFinishReason(spec.unrecognizedFinishReason)).toBe(
          "unknown",
        );
      });

      if (spec.modelSideBlocking) {
        it("maps model-side blocking to content-filter or refusal", () => {
          const blocking = spec.finishReasonCases.some(
            (testCase) =>
              testCase.expected === "content-filter" ||
              testCase.expected === "refusal",
          );
          expect(blocking).toBe(true);
        });
      }
    });

    describe("errors classify into the shared taxonomy", () => {
      for (const testCase of spec.errorCases) {
        it(`classifies ${testCase.label} → ${testCase.kind} (retryable=${testCase.retryable})`, () => {
          const mapped = spec.mapError(testCase.error);
          expect(mapped?.kind).toBe(testCase.kind);
          expect(mapped?.retryable).toBe(testCase.retryable);
          expect(typeof mapped?.code).toBe("string");
          expect(mapped?.code.length).toBeGreaterThan(0);
        });
      }

      it("defers an unrecognized error to core generic classification", () => {
        expect(spec.mapError(spec.unrecognizedError)).toBeUndefined();
      });
    });
  });
}

// ─────────────────────────────────────────────────────────────────
// Behavioral conformance — real adapter/runtime surfaces
// ─────────────────────────────────────────────────────────────────

/**
 * Provider-neutral snapshot of a normalized *successful* adapter outcome.
 *
 * Captured by driving a real adapter surface (`generate()`/`stream()`) and
 * reading the canonical `finalStep.finishReason`, so every provider is compared
 * against the same shape instead of its raw finish signal.
 */
export interface NormalizedResultSnapshot {
  /** The normalized finish reason the adapter reported. */
  readonly finishReason: CruxFinishReason;
  /** Fully assembled calls exposed only after the provider step completed. */
  readonly toolCalls?: readonly {
    readonly id?: string;
    readonly name: string;
    readonly args: unknown;
  }[];
}

/**
 * Provider-neutral snapshot of a normalized adapter *failure*.
 *
 * Captured from a thrown {@link CruxProviderError} (`kind`/`retryable`), so a
 * timeout, abort, or mid-stream error compares identically across providers.
 */
export interface NormalizedErrorSnapshot {
  /** The normalized error kind the adapter classified the failure as. */
  readonly kind: CruxProviderErrorKind;
  /** Whether the adapter marked the failure retryable. */
  readonly retryable: boolean;
}

/**
 * Snapshot of an erroring stream. A runtime that surfaces the failure on both
 * `textStream` iteration and the completion promise reports both; one that only
 * exposes the completion promise omits `iteration`.
 */
export interface NormalizedStreamErrorSnapshot {
  /** Error observed while iterating `textStream`, where the runtime exposes it. */
  readonly iteration?: NormalizedErrorSnapshot;
  /** Error observed awaiting the completion promise. */
  readonly completion: NormalizedErrorSnapshot;
}

/**
 * A small async harness each adapter package implements over its *real*
 * adapter/runtime surface using its own local scripted client/gateway.
 *
 * Core owns this provider-neutral contract and the assertions in
 * {@link describeNormalizedOutcomeBehavior}; no adapter package depends on
 * another, and core imports no provider SDK. Model-side blocking is truthfully
 * optional: providers with no distinct refusal signal (AI SDK, Google) omit
 * `refusal`, and providers with no distinct content-filter stop reason
 * (Anthropic) omit `contentFilter` — but every harness must supply at least one.
 */
export interface NormalizedOutcomeBehavioralHarness {
  /** Drive a successful single-shot generate to a normal `stop`. */
  readonly generateSuccess: () => Promise<NormalizedResultSnapshot>;
  /**
   * Drive a successful stream that completes with a completed tool call. The
   * suite asserts only the completed `tool-calls` finish reason, never streamed
   * delta fragments.
   */
  readonly streamCompletedToolCall: () => Promise<NormalizedResultSnapshot>;
  /** Drive a content-filter stop, or omit when the provider has no such stop. */
  readonly contentFilter?: () => Promise<NormalizedResultSnapshot>;
  /** Drive a model-side refusal, or omit when the provider has no distinct refusal. */
  readonly refusal?: () => Promise<NormalizedResultSnapshot>;
  /** Drive a step timeout and capture the normalized error. */
  readonly timeout: () => Promise<NormalizedErrorSnapshot>;
  /** Drive a user abort and capture the normalized error. */
  readonly userAbort: () => Promise<NormalizedErrorSnapshot>;
  /** Drive a mid-stream failure and capture the normalized error(s). */
  readonly erroringStream: () => Promise<NormalizedStreamErrorSnapshot>;
}

/** Per-adapter inputs for {@link describeNormalizedOutcomeBehavior}. */
export interface NormalizedOutcomeBehaviorSpec {
  /** Adapter name, used in the suite title. */
  readonly name: string;
  /** The adapter's harness over its real generate/stream surface. */
  readonly harness: NormalizedOutcomeBehavioralHarness;
}

/** Assert a captured error snapshot is a well-formed member of the taxonomy. */
function assertNormalizedError(snapshot: NormalizedErrorSnapshot): void {
  expect(ERROR_KINDS).toContain(snapshot.kind);
  expect(typeof snapshot.retryable).toBe("boolean");
}

/**
 * Register the shared *behavioral* normalized-outcome suite for one adapter.
 *
 * Unlike {@link describeNormalizedOutcomeConformance} (which tests pure
 * mappers), this drives each adapter's real generate/stream surface with its
 * local scripted client/gateway and asserts the provider-neutral normalized
 * result/error shape for: a successful generate; a completed streamed tool
 * call; model-side blocking (content-filter and/or refusal, per provider); a
 * step timeout; a user abort; and an erroring stream completion (checking both
 * iteration and completion where the runtime exposes both). No adapter is
 * skipped: the required scenarios run for every adapter, and each must expose at
 * least one model-side blocking outcome.
 *
 * @param spec - The adapter name and its behavioral harness.
 */
export function describeNormalizedOutcomeBehavior(
  spec: NormalizedOutcomeBehaviorSpec,
): void {
  const { harness } = spec;
  const { contentFilter, refusal } = harness;
  describe(`${spec.name} normalized-outcome behavior`, () => {
    it("normalizes a successful generate to stop", async () => {
      const snapshot = await harness.generateSuccess();
      expect(snapshot.finishReason).toBe("stop");
    });

    it("normalizes a completed streamed tool call to tool-calls", async () => {
      const snapshot = await harness.streamCompletedToolCall();
      expect(snapshot.finishReason).toBe("tool-calls");
      expect(snapshot.toolCalls).toEqual([
        expect.objectContaining({ name: "lookup", args: { q: "x" } }),
      ]);
    });

    it("exposes at least one model-side blocking outcome", () => {
      expect(contentFilter !== undefined || refusal !== undefined).toBe(true);
    });

    if (contentFilter) {
      it("normalizes a content-filter stop to content-filter", async () => {
        const snapshot = await contentFilter();
        expect(snapshot.finishReason).toBe("content-filter");
      });
    }

    if (refusal) {
      it("normalizes a model-side refusal to refusal", async () => {
        const snapshot = await refusal();
        expect(snapshot.finishReason).toBe("refusal");
      });
    }

    it("normalizes a step timeout to a retryable timeout error", async () => {
      const snapshot = await harness.timeout();
      assertNormalizedError(snapshot);
      expect(snapshot.kind).toBe("timeout");
      expect(snapshot.retryable).toBe(true);
    });

    it("normalizes a user abort to a non-retryable aborted error", async () => {
      const snapshot = await harness.userAbort();
      assertNormalizedError(snapshot);
      expect(snapshot.kind).toBe("aborted");
      expect(snapshot.retryable).toBe(false);
    });

    it("normalizes an erroring stream completion", async () => {
      const snapshot = await harness.erroringStream();
      if (snapshot.iteration) assertNormalizedError(snapshot.iteration);
      assertNormalizedError(snapshot.completion);
    });
  });
}
