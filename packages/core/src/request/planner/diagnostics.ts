/**
 * Redacted request-planning failures and predictive warnings.
 *
 * @module
 */

import {
  RequestCompositionError,
  type RequestDiagnostic,
} from "../errors";
import { estimateRequestTokens } from "../measure/estimate";
import type { RequestWarning } from "../receipt/adaptations";
import type { SealRequestInput } from "./seal";

const warnedExactHistory = new Set<string>();

/** Build one redacted strict-limit failure. @internal */
export function tooLargeError<
  TExtra extends Record<string, unknown>,
>(
  input: SealRequestInput<TExtra>,
  requestId: string,
  inputTokens: number,
  maxInputTokens: number,
  breakdown: ReturnType<typeof estimateRequestTokens>["breakdown"],
): RequestCompositionError {
  const largest = breakdown.contributions.slice(0, 3);
  const diagnostics: RequestDiagnostic[] = [
    {
      id: `${requestId}:input-limit`,
      code: "REQUEST_INPUT_LIMIT",
      tokens: inputTokens,
      message: `Minimum required input is ${inputTokens} tokens; ${maxInputTokens} are available.`,
    },
    ...largest.map((entry, index) => ({
      id: `${requestId}:contributor:${index + 1}`,
      code: "LARGEST_REQUIRED_CONTRIBUTOR",
      contributor: entry.contributor,
      tokens: entry.tokens,
      message: `${entry.contributor} contributes approximately ${entry.tokens} tokens.`,
    })),
    {
      id: `${requestId}:alternatives`,
      code: "EXACT_REPRESENTATION_EXHAUSTED",
      message:
        "The exact representation is the only authorized representation and does not fit.",
    },
    ...(input.history?.policy === "exact"
      ? [
          {
            id: `${requestId}:history-remedy`,
            code: "HISTORY_EXACT_REMEDY",
            contributor: "history",
            message:
              "Keep canonical history exact and configure history.recent() for a stateless window or history() for managed adaptation.",
          },
        ]
      : []),
    {
      id: `${requestId}:remedy`,
      code: "REQUEST_REMEDY",
      message:
        "Increase inputBudget.max, reduce exact input, reserve fewer output tokens, or authorize a lower representation.",
    },
  ];
  const names =
    largest.map((entry) => entry.contributor).join(", ") || "none";
  return new RequestCompositionError(
    "REQUEST_TOO_LARGE",
    `Request "${requestId}" for model "${input.model}" requires ${inputTokens} input tokens but only ${maxInputTokens} are available. Largest required contributors: ${names}. Exact representation exhausted.`,
    diagnostics,
    requestId,
  );
}

/** Build predictive exact-history pressure warnings. @internal */
export function requestWarnings<
  TExtra extends Record<string, unknown>,
>(
  input: SealRequestInput<TExtra>,
  inputTokens: number,
  optimizeAt: number,
): readonly RequestWarning[] {
  const warnings = [...(input.history?.warnings ?? [])];
  if (
    input.history?.policy !== "exact" ||
    inputTokens <= optimizeAt
  ) {
    return warnings;
  }
  warnings.push({
    code: "HISTORY_EXACT_NEAR_LIMIT",
    message:
      "Complete exact history crossed the request optimization watermark and may eventually stop fitting; configure history.recent() or history().",
  });
  const warningKey = `${input.provider}:${input.model}`;
  if (
    !warnedExactHistory.has(warningKey) &&
    (typeof process === "undefined" ||
      process.env.NODE_ENV !== "production")
  ) {
    warnedExactHistory.add(warningKey);
    console.warn(
      `[Crux] Complete exact history for ${input.provider}/${input.model} crossed its request optimization watermark. Configure history.recent() or history() before it stops fitting.`,
    );
  }
  return warnings;
}
