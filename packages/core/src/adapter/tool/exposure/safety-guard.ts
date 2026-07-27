/**
 * Safety-session callbacks for provider-visible tool exposure.
 *
 * @internal
 * @module
 */

import type {
  ToolDefinitionOrigin,
  ToolDefinitionSubject,
  ToolDescriptionOrigin,
} from "../../../safety";
import { safeCaptureSummary, SafetyResultError } from "../../../safety/errors";
import { GuardrailBlockedError } from "../../../safety/guardrail/errors";
import { validateGuardrailRunResult } from "../../../safety/guardrail/result-validation";
import { validateToolDefinitionGuardrailResult } from "../../../safety/guardrail/specialized-results";
import { runGuardWithObservability } from "../../../safety/guardrail/run-guard";
import type {
  GuardrailAudit,
  GuardrailContext,
  GuardrailRewriteKind,
  ClosedGuardrailRunResult,
} from "../../../safety/guardrail/types";
import type { GuardrailBinding } from "../../../safety/registry";
import type { ToolExposureGuards } from "./types";

interface ToolExposureSafetyGuardOptions {
  readonly bindings: readonly GuardrailBinding[];
  readonly context: (
    origin: ToolDefinitionOrigin | ToolDescriptionOrigin,
  ) => GuardrailContext<ToolDefinitionOrigin>;
  readonly appendAudit: (audit: GuardrailAudit) => void;
}

/** Create the two Safety-owned callbacks consumed by a tool lifecycle. */
export function createToolExposureSafetyGuards(
  options: ToolExposureSafetyGuardOptions,
): ToolExposureGuards {
  return {
    root: (subject, origin) => guardRoot(subject, origin, options),
    descriptions: (text, origin) =>
      guardDescription(text, origin, options),
  };
}

async function guardRoot(
  subject: ToolDefinitionSubject,
  origin: ToolDefinitionOrigin,
  options: ToolExposureSafetyGuardOptions,
) {
  for (const binding of matchingBindings(options.bindings, origin.kind, false)) {
    const outcome = await runGuardWithObservability({
      binding,
      subject,
      ctx: options.context(origin),
      phase: "input",
      streaming: false,
      last: true,
      validateResult: validateToolDefinitionGuardrailResult,
    });
    const enforcedBlock =
      outcome.result.action === "block" && binding.mode === "enforce";
    options.appendAudit({
      applied: [outcome.entry],
      blocked: enforcedBlock,
    });
    if (enforcedBlock) {
      throw new GuardrailBlockedError({
        guardrailId: binding.policy.id,
        phase: "input",
        reason: outcome.result.reason,
        decisions: [
          {
            policyId: binding.policy.id,
            kind: "guardrail",
            boundary: binding.boundary.id,
            origin,
            mode: binding.mode,
            action: "block",
            reason: outcome.result.reason,
            ...(binding.tuned ? { tuned: binding.tuned } : {}),
            durationMs: outcome.durationMs,
            captured: safeCaptureSummary(""),
          },
        ],
      });
    }
    if (outcome.result.action === "strip" && binding.mode === "enforce") {
      return outcome.result;
    }
  }
  return { action: "allow" } as const;
}

async function guardDescription(
  text: string,
  origin: ToolDescriptionOrigin,
  options: ToolExposureSafetyGuardOptions,
) {
  let current = text;
  let rewriteKind: GuardrailRewriteKind | undefined;
  for (const binding of matchingBindings(options.bindings, origin.kind, true)) {
    const outcome = await runGuardWithObservability({
      binding,
      subject: current,
      ctx: options.context(origin),
      phase: "input",
      streaming: false,
      last: true,
      validateResult: validateToolDescriptionResult,
    });
    const enforcedBlock =
      outcome.result.action === "block" && binding.mode === "enforce";
    options.appendAudit({
      applied: [outcome.entry],
      blocked: enforcedBlock,
    });
    if (enforcedBlock) {
      throw new GuardrailBlockedError({
        guardrailId: binding.policy.id,
        phase: "input",
        reason: outcome.result.reason,
        decisions: [
          {
            policyId: binding.policy.id,
            kind: "guardrail",
            boundary: binding.boundary.id,
            origin,
            mode: binding.mode,
            action: "block",
            reason: outcome.result.reason,
            ...(binding.tuned ? { tuned: binding.tuned } : {}),
            durationMs: outcome.durationMs,
            captured: safeCaptureSummary(""),
          },
        ],
      });
    }
    if (outcome.result.action !== "rewrite" || binding.mode === "report") {
      continue;
    }
    current = outcome.result.value;
    rewriteKind = outcome.result.rewrite.kind;
  }
  return rewriteKind
    ? { action: "rewrite" as const, value: current, rewrite: { kind: rewriteKind } }
    : { action: "allow" as const };
}

function validateToolDescriptionResult(
  value: unknown,
  options: {
    readonly streaming: boolean;
    readonly last: boolean;
    readonly policyId: string;
    readonly boundary: string;
  },
): ClosedGuardrailRunResult<string> {
  const result = validateGuardrailRunResult(value, options);
  if (result.action === "hold") {
    throw new SafetyResultError({
      message: `Safety policy "${options.policyId}" returned an invalid result: hold is unavailable for tool descriptions.`,
      policyId: options.policyId,
      boundary: options.boundary,
      problem: "hold is unavailable for tool descriptions",
    });
  }
  if (result.action !== "rewrite") return result;
  if (typeof result.value !== "string") {
    throw new SafetyResultError({
      message: `Safety policy "${options.policyId}" returned an invalid result: tool-description rewrite value must be a string.`,
      policyId: options.policyId,
      boundary: options.boundary,
      problem: "tool-description rewrite value must be a string",
    });
  }
  return { ...result, value: result.value };
}

function matchingBindings(
  bindings: readonly GuardrailBinding[],
  source: ToolDefinitionOrigin["kind"],
  descriptions: boolean,
): readonly GuardrailBinding[] {
  return bindings.filter((binding) => {
    if (binding.boundary.id !== "model.input.tools") return false;
    if ((binding.boundary.selector === "descriptions") !== descriptions) {
      return false;
    }
    const selected = binding.boundary.from;
    if (selected === undefined) return true;
    return (Array.isArray(selected) ? selected : [selected]).includes(source);
  });
}
