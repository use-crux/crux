import { observe } from "../../observability";
import type {
  SafetyFinding,
  SafetyFindingCollector,
  SafetyRunContext,
} from "../decision";
import type { ModelInputOrigin } from "../input-origin";
import { safeCaptureSummary } from "../errors";
import { GuardrailBlockedError } from "../guardrail/errors";
import { findingCountAttributes } from "../guardrail/finding-observability";
import {
  recordMediaGuardrailBlockedEdge,
  recordMediaGuardrailReport,
} from "../guardrail/observability";
import type {
  GuardrailAudit,
  GuardrailAuditEntry,
  GuardrailContext,
  MediaGuardrailRunResult,
} from "../guardrail/types";
import type { GuardrailBinding } from "../registry";
import type { MediaPartLocation } from "./types";

/** @internal One completed media-policy evaluation awaiting final group state. */
export interface MediaEvaluation {
  readonly groupId: string;
  readonly binding: GuardrailBinding;
  readonly result: MediaGuardrailRunResult;
  readonly findings?: readonly SafetyFinding[];
  readonly location: MediaPartLocation;
  readonly model?: string;
  /** Privacy-safe semantic provenance shared across media projections. */
  readonly origin?: ModelInputOrigin;
  readonly durationMs: number;
  readonly span: ReturnType<typeof observe.openSpan>;
  escalatedToBlock: boolean;
}

/** Finalize ordered media observations and audit after group validation. */
export function finalizeMediaEvaluations(
  options: Readonly<{
    phase: "input" | "output";
    appendAudit: (audit: GuardrailAudit) => void;
  }>,
  evaluations: readonly MediaEvaluation[],
  terminal?: MediaEvaluation,
): void {
  for (const evaluation of evaluations) {
    const {
      binding,
      result,
      findings,
      location,
      model,
      origin,
      durationMs,
      escalatedToBlock,
      span,
    } = evaluation;
    span.withContext(() => {
      recordMediaGuardrailReport(
        binding,
        result,
        location,
        durationMs,
        escalatedToBlock,
        origin,
        findings,
      );
      if (evaluation === terminal && result.action !== "allow") {
        recordMediaGuardrailBlockedEdge(
          binding,
          result.reason,
          location,
          escalatedToBlock,
          origin,
          findings,
        );
      }
    });
    span.end({
      attributes: {
        action: result.action,
        ...(escalatedToBlock ? { escalatedToBlock: true as const } : {}),
        ...findingCountAttributes(findings),
        durationMs,
      },
    });
    options.appendAudit({
      applied: [
        auditEntry(
          options.phase,
          binding,
          result,
          location,
          model,
          origin,
          durationMs,
          escalatedToBlock,
          evaluation.findings,
        ),
      ],
      blocked:
        (result.action === "block" && binding.mode === "enforce") ||
        escalatedToBlock,
    });
  }
}

/** Build the canonical terminal error for a media block or escalation. */
export function mediaBlockedError(
  phase: "input" | "output",
  binding: GuardrailBinding,
  reason: string,
  location: MediaPartLocation,
  durationMs: number,
  escalatedToBlock = false,
  model?: string,
  origin?: ModelInputOrigin,
  findings?: readonly SafetyFinding[],
): GuardrailBlockedError {
  return new GuardrailBlockedError({
    guardrailId: binding.policy.id,
    phase,
    reason,
    decisions: [
      {
        policyId: binding.policy.id,
        kind: "guardrail",
        boundary: binding.boundary.id,
        ...(origin ? { origin } : {}),
        mode: binding.mode,
        action: "block",
        reason,
        ...(model ? { model } : {}),
        location,
        ...(escalatedToBlock ? { escalatedToBlock: true as const } : {}),
        ...(findings ? { findings } : {}),
        ...(binding.tuned ? { tuned: binding.tuned } : {}),
        durationMs,
        captured: safeCaptureSummary(""),
      },
    ],
  });
}

/** Project the private session context into one public media callback context. */
export function mediaRunContext(
  binding: GuardrailBinding,
  context: GuardrailContext,
  findings: SafetyFindingCollector,
): Omit<SafetyRunContext, "origin"> & { readonly origin?: ModelInputOrigin } {
  return {
    policy: { id: binding.policy.id, mode: binding.mode },
    boundary: { id: binding.boundary.id, kind: binding.boundary.id },
    prompt: { id: context.promptId },
    model: { id: context.model },
    trace: { id: context.traceId },
    attempt: { index: 0, kind: "initial" },
    metadata: context.metadata,
    findings,
    ...(context.stream ? { stream: context.stream } : {}),
    ...(context.origin ? { origin: context.origin } : {}),
  };
}

function auditEntry(
  phase: "input" | "output",
  binding: GuardrailBinding,
  result: MediaGuardrailRunResult,
  location: MediaPartLocation,
  model: string | undefined,
  origin: ModelInputOrigin | undefined,
  durationMs: number,
  escalatedToBlock: boolean,
  findings: readonly SafetyFinding[] | undefined,
): GuardrailAuditEntry {
  return {
    guard: binding.policy.id,
    ...(binding.policy.category !== undefined
      ? { category: binding.policy.category }
      : {}),
    boundary: binding.boundary.id,
    ...(origin ? { origin } : {}),
    mode: binding.mode,
    phase,
    action: result.action,
    ...(result.action === "allow" ? {} : { reason: result.reason }),
    ...(model ? { model } : {}),
    location,
    ...(escalatedToBlock ? { escalatedToBlock: true as const } : {}),
    ...(findings ? { findings } : {}),
    durationMs,
  };
}
