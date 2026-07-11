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
