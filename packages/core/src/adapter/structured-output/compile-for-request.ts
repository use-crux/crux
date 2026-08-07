/**
 * Request-time structured-output compilation with diagnostics surfacing.
 *
 * `compileStructuredOutput` is pure and returns diagnostics on the plan. At a
 * live generation the compiler also needs to make those diagnostics observable,
 * so this thin wrapper emits each one through a diagnostics sink (the resolver
 * {@link DiagnosticsPort} satisfies it structurally) with the stable diagnostic
 * code, canonical path, prompt id, and compilation fingerprint attached.
 *
 * @module
 */

import type { z } from "zod";
import type { StructuredOutputCapabilities } from "./capabilities";
import type { StructuredOutputPlan } from "./plan";
import { compileStructuredOutput } from "./compile";
import { compileStructuredOutputPassthrough } from "./compile";
import type { StructuredOutputResolution } from "./plan";
import { CruxUnsupportedStructuredOutputError } from "./errors";

/** Minimal diagnostics sink; the resolver `DiagnosticsPort` satisfies it. */
export interface StructuredOutputDiagnosticsSink {
  warn(message: string, detail?: unknown): void;
}

export function compileResolvedStructuredOutputForRequest(
  schema: z.ZodType,
  resolution: StructuredOutputResolution,
  context: StructuredOutputRequestContext,
): StructuredOutputPlan {
  if (resolution.strategy === "reject") {
    throw new CruxUnsupportedStructuredOutputError(
      resolution.profileId,
      "unknown model policy is reject",
    );
  }
  if (resolution.strategy === "passthrough") {
    return compileStructuredOutputPassthrough(schema, resolution.profileId);
  }
  return compileStructuredOutputForRequest(
    schema,
    resolution.capabilities,
    context,
  );
}

/** Context surfaced alongside each emitted structured-output diagnostic. */
export interface StructuredOutputRequestContext {
  readonly diagnostics?: StructuredOutputDiagnosticsSink;
  readonly promptId?: string;
}

/**
 * Compile an authored schema for one request and surface every lowering
 * diagnostic through the request's diagnostics sink. The returned plan is the
 * same immutable {@link StructuredOutputPlan} `compileStructuredOutput` produces.
 */
export function compileStructuredOutputForRequest(
  schema: z.ZodType,
  capabilities: StructuredOutputCapabilities,
  context: StructuredOutputRequestContext,
): StructuredOutputPlan {
  const plan = compileStructuredOutput(schema, capabilities);
  const sink = context.diagnostics;
  if (sink) {
    for (const diagnostic of plan.diagnostics) {
      sink.warn(
        `structured-output(${capabilities.id}): ${diagnostic.code} — ${diagnostic.message}`,
        {
          code: diagnostic.code,
          path: diagnostic.path,
          promptId: context.promptId,
          fingerprint: plan.fingerprint,
        },
      );
    }
  }
  return plan;
}
