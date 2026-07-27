/** Terminal language guardrail and constraint orchestration. @internal */

import type { z } from "zod";
import type { Message } from "../../generation/messages";
import { latestRewritePolicyId } from "../audit";
import { createGuardrailPipeline } from "../guardrail/pipeline";
import type { GuardrailAudit, GuardrailContext } from "../guardrail/types";
import type { GuardrailBinding } from "../registry";
import type { StructuredSafetyContext } from "../session-bridge";
import type { ConstraintOccurrenceSettlement } from "../constraint/settlement";
import type { SafetyOutput, SafetyProtocolEvent } from "../session";
import { resyncStructuredText } from "../structured";
import { gateStructuredOccurrences } from "../stream/structured-gating";
import type { SafetyRegenerate } from "../session-feedback-guard";

interface FinalizeLanguageTerminalOptions {
  /** Already step-guarded terminal candidate. */
  readonly output: SafetyOutput;
  /** Corrective provider call owned by the selected dialect. */
  readonly regenerate: SafetyRegenerate;
  /** Full output binding set for the call. */
  readonly bindings: readonly GuardrailBinding[];
  /** Run only object/both bindings when step guards already ran. */
  readonly terminalOnly: boolean;
  readonly enabled: boolean;
  readonly suspended?: boolean;
  readonly messages: readonly Message[];
  readonly schema?: z.ZodType;
  /** Cached candidate evaluations run constraints once without regeneration. */
  readonly retryAuthority?: "none";
  /**
   * Adapter-owned candidate validator injected between terminal guardrails and
   * constraints. It runs the single authoritative Zod `safeParse` (and any
   * validation retry) over the guarded canonical `z.input`, so constraints only
   * ever evaluate schema-valid candidates. Receives the guard function so a
   * validation-retry re-prompt can re-run terminal guardrails on the new output.
   * Absent for the text (non-structured) path, where guardrails are the candidate.
   */
  readonly prepareValidated?: (
    guarded: SafetyOutput,
    guardCandidate: (candidate: SafetyOutput) => Promise<SafetyOutput>,
  ) => Promise<SafetyOutput>;
  readonly context: GuardrailContext;
  readonly appendAudit: (audit: GuardrailAudit) => void;
  readonly transcript: SafetyProtocolEvent[];
  /** Compiled structured context (canonical schema) for object-occurrence gating. */
  readonly structuredContext?: StructuredSafetyContext;
  /** Skip object-occurrence gating when a live stream already sealed the value. */
  readonly objectOccurrencesAlreadyGated?: boolean;
  readonly constraintsEnabled: boolean;
  /**
   * Occurrence-precise settlement from an accepted stream attempt; a settled,
   * unchanged occurrence is not re-evaluated by the terminal constraints.
   */
  readonly settled?: readonly ConstraintOccurrenceSettlement[];
  readonly applyConstraints: (
    output: SafetyOutput,
    regenerate: SafetyRegenerate,
    guardCandidate: (candidate: SafetyOutput) => Promise<SafetyOutput>,
    settled?: readonly ConstraintOccurrenceSettlement[],
    retryAuthority?: "none",
  ) => Promise<SafetyOutput>;
  readonly applyReportConstraints: (output: SafetyOutput) => Promise<void>;
}

/** Finalize one language result without re-running per-step text/media policy. */
export async function finalizeLanguageTerminal(
  options: FinalizeLanguageTerminalOptions,
): Promise<SafetyOutput> {
  if (options.suspended) {
    if (options.enabled) options.transcript.push({ t: "suspend" });
    return options.output;
  }

  // Guardrails and constraints are gated on whether Safety is enabled, but the
  // adapter-owned validator (unconditional Zod validation) must always run — even
  // when no guardrails or constraints are configured.
  const bindings = !options.enabled
    ? []
    : options.terminalOnly
      ? options.bindings.filter(
          (binding) =>
            binding.boundary.id === "model.output.object" ||
            binding.boundary.id === "model.output",
        )
      : options.bindings;
  const guardCandidate = (candidate: SafetyOutput) =>
    bindings.length > 0
      ? applyTerminalGuards(options, bindings, candidate)
      : Promise.resolve(candidate);

  // Terminal guardrails run first, then the adapter-owned validator (one Zod
  // `safeParse` + validation retry). Constraints only ever see a schema-valid
  // candidate, and a regenerated candidate repeats this pipeline before recheck.
  const prepareCandidate = async (candidate: SafetyOutput) => {
    const guarded = await guardCandidate(candidate);
    return options.prepareValidated
      ? options.prepareValidated(guarded, guardCandidate)
      : guarded;
  };

  let current = await prepareCandidate(options.output);
  if (options.enabled && options.constraintsEnabled) {
    current = await options.applyConstraints(
      current,
      options.regenerate,
      prepareCandidate,
      options.settled,
      options.retryAuthority,
    );
  }
  if (options.enabled) await options.applyReportConstraints(current);
  return current;
}

/**
 * Terminal guards run in two passes over one candidate: the authoritative
 * structured-occurrence engine gates every `model.output.object` occurrence
 * (root / scalar-or-object path / array items) over the canonical value first, so
 * a later composite `model.output` or text guard sees the rewritten result; then
 * the guardrail pipeline gates the remaining text/composite bindings. Object
 * occurrences are skipped entirely when a live stream already gated and sealed
 * them.
 */
async function applyTerminalGuards(
  options: FinalizeLanguageTerminalOptions,
  bindings: readonly GuardrailBinding[],
  output: SafetyOutput,
): Promise<SafetyOutput> {
  const objectBindings = bindings.filter(
    (binding) => binding.boundary.id === "model.output.object",
  );
  const otherBindings = bindings.filter(
    (binding) => binding.boundary.id !== "model.output.object",
  );

  let current = output;
  const actions: string[] = [];

  if (
    objectBindings.length > 0 &&
    !options.objectOccurrencesAlreadyGated &&
    current.parsed !== undefined
  ) {
    const gated = await gateStructuredOccurrences(
      current.parsed,
      objectBindings,
      {
        guardContext: options.context,
        appendGuardrailAudit: (audit) => {
          options.appendAudit(audit);
          for (const entry of audit.applied) actions.push(entry.action);
        },
        ...(options.structuredContext?.canonicalSchema
          ? { canonicalSchema: options.structuredContext.canonicalSchema }
          : {}),
      },
    );
    if (gated !== current.parsed) {
      current = { text: serializeCanonical(gated), parsed: gated };
    }
  }

  if (otherBindings.length > 0) {
    const result = await createGuardrailPipeline(otherBindings).runOutput(
      current.text,
      options.context,
      { parsed: current.parsed, schema: options.schema },
    );
    options.appendAudit(result.audit);
    actions.push(...result.audit.applied.map((entry) => entry.action));
    current = resyncStructuredText(
      { text: current.text, parsed: result.parsed ?? current.parsed },
      result.content,
      { policyId: latestRewritePolicyId(result.audit.applied) },
    );
  }

  options.transcript.push({
    t: "output.guard",
    guards: bindings.length,
    actions,
  });
  return current;
}

/** Serialize a rewritten canonical tree to compact wire text. */
function serializeCanonical(value: unknown): string {
  const text = JSON.stringify(value);
  if (typeof text !== "string") {
    // The occurrence engine already validated serializability before release.
    throw new TypeError("structured occurrence tree is not JSON-serializable");
  }
  return text;
}
