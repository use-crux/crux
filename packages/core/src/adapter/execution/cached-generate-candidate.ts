/**
 * Adapter-owned release gate for hydrated generate cache candidates.
 *
 * This evaluator reuses the live terminal seam and grants no validation or
 * constraint regeneration authority. Expected content-policy failures reject
 * the cache hit; callback, infrastructure, and malformed-policy errors remain
 * visible to the caller.
 *
 * @internal
 * @module
 */

import type { z } from "zod";
import { ValidationExhaustedError } from "../../generation/validation-retry";
import type { Message } from "../../generation/messages";
import type { MiddlewareResult } from "../../runtime/types";
import type { CachedCandidateFinalizer } from "../../runtime/internal/cached-candidate-finalizer";
import {
  attachCachedStructuredCandidate,
  readCachedStructuredCandidate,
} from "../../runtime/internal/cached-structured-candidate";
import { ConstraintViolationError } from "../../safety/constraint/errors";
import { GuardrailBlockedError } from "../../safety/guardrail/errors";
import {
  finalizeSafetySessionLanguageOutput,
  type Safety,
  type StructuredSafetyContext,
} from "../../safety/session";
import { createStructuredCompletion } from "./structured-completion";

export type CachedGenerateCandidateOptions =
  | {
      readonly output: "text";
      readonly safety: Safety;
      readonly messages: () => readonly Message[];
    }
  | {
      readonly output: "object";
      readonly safety: Safety;
      readonly messages: () => readonly Message[];
      readonly schema: z.ZodType;
      readonly promptId: string;
      readonly structuredContext: StructuredSafetyContext;
    };

const unreachableRegeneration = (): Promise<never> =>
  Promise.reject(
    new Error("Cached candidate evaluation cannot regenerate output"),
  );

/**
 * Create the private finalizer attached to one adapter orchestration.
 *
 * Structured candidates require cached canonical `z.input`, run current output
 * guardrails, execute the authored `safeParse` exactly once, then run current
 * constraints over the schema-valid input and publish `safeParse.data`.
 */
export function createCachedGenerateCandidateFinalizer(
  options: CachedGenerateCandidateOptions,
): CachedCandidateFinalizer {
  return async (candidate) => {
    try {
      return options.output === "object"
        ? await finalizeStructuredCandidate(options, candidate)
        : await finalizeTextCandidate(options, candidate);
    } catch (error) {
      if (error instanceof ValidationExhaustedError) {
        return { kind: "reject", category: "schema" };
      }
      if (error instanceof GuardrailBlockedError && error.phase === "output") {
        return { kind: "reject", category: "guardrail" };
      }
      if (error instanceof ConstraintViolationError) {
        return { kind: "reject", category: "constraint" };
      }
      throw error;
    }
  };
}

async function finalizeTextCandidate(
  options: Extract<CachedGenerateCandidateOptions, { output: "text" }>,
  candidate: MiddlewareResult,
) {
  const final = await finalizeSafetySessionLanguageOutput(
    options.safety,
    { text: candidate.text ?? "", parsed: undefined },
    unreachableRegeneration,
    {
      messages: options.messages(),
      retryAuthority: "none",
      stepOutputAlreadyGated: false,
    },
  );
  return {
    kind: "accept" as const,
    result: publishCandidate(candidate, options.safety, {
      text: final.text,
    }),
  };
}

async function finalizeStructuredCandidate(
  options: Extract<CachedGenerateCandidateOptions, { output: "object" }>,
  candidate: MiddlewareResult,
) {
  const payload = readCachedStructuredCandidate(candidate);
  if (!payload) return { kind: "reject" as const, category: "schema" as const };

  const completion = createStructuredCompletion({
    safety: options.safety,
    schema: options.schema,
    decodeManifest: options.structuredContext.decodeManifest,
    structuredContext: options.structuredContext,
    promptId: options.promptId,
    validationRetry: undefined,
    retryAuthority: "none",
    maxSteps: 0,
    steps: () => 0,
    messages: options.messages,
    reprompt: unreachableRegeneration,
  });
  const result = await completion.finalize(
    completion.buildFromCanonical({
      text: candidate.text ?? "",
      value: payload.canonicalInput,
    }),
    { suspended: false },
  );
  const published = publishCandidate(candidate, options.safety, {
    text: result.text,
    object: result.object,
  });
  return {
    kind: "accept" as const,
    result: attachCachedStructuredCandidate(published, result.canonicalInput),
  };
}

function publishCandidate(
  candidate: MiddlewareResult,
  safety: Safety,
  value: { readonly text: string; readonly object?: unknown },
): MiddlewareResult {
  const { object: _staleObject, ...candidateWithoutObject } = candidate;
  const {
    guardrails: _staleGuardrails,
    constraints: _staleConstraints,
    ...currentMeta
  } = candidate._meta ?? {};
  return {
    ...candidateWithoutObject,
    text: value.text,
    ...(value.object !== undefined ? { object: value.object } : {}),
    _meta: safety.stamp(currentMeta),
  };
}
