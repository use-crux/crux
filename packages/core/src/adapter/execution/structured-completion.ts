/**
 * Shared completed-candidate pipeline for structured output.
 *
 * Both the native (core-driven) and SDK-driven routes run every completed
 * structured candidate through the same invariant:
 *
 * ```text
 * provider value
 *   -> repair + JSON parse + manifest decode to canonical z.input
 *   -> terminal Safety guardrails over canonical z.input
 *   -> original Zod safeParse exactly once
 *   -> constraints over validated canonical input
 *   -> expose safeParse.data as z.output
 * ```
 *
 * `validationRetry` only controls whether a failed attempt is retried; it never
 * controls whether validation runs. Validation retry and constraint regeneration
 * share one `maxSteps` provider-call budget.
 *
 * @module
 */

import { z } from "zod";
import type { Message } from "../../generation/messages";
import { ValidationExhaustedError } from "../../generation/validation-retry";
import type { ValidationRetryOptions } from "../../generation/validation-retry";
import { repairJsonText } from "../../generation/repair-json";
import {
  finalizeSafetySessionLanguageOutput,
  type Safety,
  type SafetyOutput,
} from "../../safety/session";
import {
  decodeStructuredValue,
  type StructuredOutputDecodeManifest,
} from "../structured-output";
import { formatValidationFeedback } from "../policy/validation-retry";

/** Dependencies for one call's structured completion pipeline. */
export interface StructuredCompletionDeps {
  readonly safety: Safety;
  /** Authored Zod schema — the sole semantic validator. */
  readonly schema: z.ZodType;
  /** Reversible decode manifest for the compiled plan, when any. */
  readonly decodeManifest: StructuredOutputDecodeManifest | undefined;
  readonly promptId: string;
  readonly validationRetry: ValidationRetryOptions | undefined;
  /** Shared provider-call budget. */
  readonly maxSteps: number;
  /** Current provider-call count (shared across the whole generation). */
  readonly steps: () => number;
  /** Messages snapshot for the terminal Safety guard context. */
  readonly messages: () => readonly Message[];
  /**
   * Re-call the provider with corrective messages and return the new candidate
   * text. Implementations own their result-accumulation side effects and MUST
   * increment the shared step count. Only invoked while budget remains.
   */
  readonly reprompt: (corrective: readonly Message[]) => Promise<string>;
}

/** The completed, validated candidate. */
export interface StructuredCompletionResult {
  /** Repaired/resynchronized pre-Zod structured text. */
  readonly text: string;
  /** Post-Zod `safeParse.data`; `undefined` when suspended. */
  readonly object: unknown;
}

/** A single-issue `ZodError` used when provider output is not valid JSON. */
export function invalidJsonZodError(): z.ZodError {
  return new z.ZodError([{ code: "custom", path: [], message: "Invalid JSON" }]);
}

/**
 * Repair, JSON-parse, and manifest-decode provider text into canonical `z.input`.
 *
 * In the structured path a valid JSON value never parses to `undefined`, so a
 * `parsed` of `undefined` unambiguously marks a JSON parse failure.
 */
export function buildStructuredCandidateInput(
  text: string,
  decodeManifest: StructuredOutputDecodeManifest | undefined,
): SafetyOutput {
  const repaired = repairJsonText(text) ?? text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(repaired);
  } catch {
    parsed = undefined;
  }
  if (parsed !== undefined && decodeManifest) {
    parsed = decodeStructuredValue(parsed, decodeManifest);
  }
  return { text: repaired, parsed };
}

/**
 * Create the completed-candidate pipeline for one structured call.
 *
 * `buildInput` prepares a candidate; `finalize` runs terminal Safety, the single
 * authoritative parse, and constraints, returning `{ text, object }`.
 */
export function createStructuredCompletion(deps: StructuredCompletionDeps): {
  buildFromText: (text: string) => SafetyOutput;
  buildFromWireValue: (candidate: {
    readonly text: string;
    readonly value: unknown;
  }) => SafetyOutput;
  finalize: (
    initial: SafetyOutput,
    opts: { readonly suspended: boolean },
  ) => Promise<StructuredCompletionResult>;
} {
  const maxRetries = deps.validationRetry?.maxRetries ?? 0;
  let validationRetries = 0;
  let acceptedObject: unknown;
  let currentText = "";

  // Text-authoritative candidate: repair + JSON parse + manifest decode. Used
  // for regenerated candidates (and any route without a pre-parsed wire value).
  const buildFromText = (text: string): SafetyOutput => {
    const output = buildStructuredCandidateInput(text, deps.decodeManifest);
    currentText = output.text;
    return output;
  };

  // Value-authoritative candidate: the runtime already parsed the provider wire
  // value against the installed wire schema. `text` stays authoritative for the
  // public `result.text` and text-boundary Safety; `value` is the initial
  // semantic value, manifest-decoded to canonical `z.input`. Both must come from
  // the same completed provider candidate.
  const buildFromWireValue = (candidate: {
    readonly text: string;
    readonly value: unknown;
  }): SafetyOutput => {
    currentText = candidate.text;
    const parsed = deps.decodeManifest
      ? decodeStructuredValue(candidate.value, deps.decodeManifest)
      : candidate.value;
    return { text: candidate.text, parsed };
  };

  // Provider re-call shared by validation retry and constraint regeneration.
  // Once the shared budget is exhausted, no provider call is made — the current
  // candidate is returned so the caller settles within its own bounds.
  const repromptCandidate = async (
    corrective: readonly Message[],
  ): Promise<SafetyOutput> => {
    if (deps.steps() >= deps.maxSteps) {
      return buildFromText(currentText);
    }
    return buildFromText(await deps.reprompt(corrective));
  };

  const validate = (value: unknown): z.ZodError | undefined => {
    const result = deps.schema.safeParse(value);
    if (result.success) {
      acceptedObject = result.data;
      return undefined;
    }
    return result.error;
  };

  const prepareValidated = async (
    guarded: SafetyOutput,
    guardCandidate: (candidate: SafetyOutput) => Promise<SafetyOutput>,
  ): Promise<SafetyOutput> => {
    let current = guarded;
    for (;;) {
      const error =
        current.parsed === undefined ? invalidJsonZodError() : validate(current.parsed);
      if (error === undefined) return current;

      if (
        deps.validationRetry &&
        validationRetries < maxRetries &&
        deps.steps() < deps.maxSteps
      ) {
        validationRetries++;
        deps.validationRetry.onRetry?.(validationRetries, error);
        const reprompted = await repromptCandidate([
          { role: "user", content: formatValidationFeedback(current.text, error) },
        ]);
        current = await guardCandidate(reprompted);
        continue;
      }
      deps.validationRetry?.onExhausted?.(validationRetries, error);
      throw new ValidationExhaustedError({
        lastRawOutput: current.text,
        zodErrors: error,
        attempts: validationRetries,
        maxAttempts: maxRetries,
        promptId: deps.promptId,
      });
    }
  };

  const finalize = async (
    initial: SafetyOutput,
    { suspended }: { readonly suspended: boolean },
  ): Promise<StructuredCompletionResult> => {
    const finalOutput = await finalizeSafetySessionLanguageOutput(
      deps.safety,
      initial,
      repromptCandidate,
      {
        suspended,
        messages: deps.messages(),
        schema: deps.schema,
        ...(suspended ? {} : { prepareValidated }),
      },
    );
    return {
      text: finalOutput.text,
      object: suspended ? undefined : acceptedObject,
    };
  };

  return { buildFromText, buildFromWireValue, finalize };
}
