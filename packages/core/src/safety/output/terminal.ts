/** Terminal language guardrail and constraint orchestration. @internal */

import type { z } from "zod";
import type { Message } from "../../generation/messages";
import { latestRewritePolicyId } from "../audit";
import { createGuardrailPipeline } from "../guardrail/pipeline";
import type {
  GuardrailAudit,
  GuardrailContext,
} from "../guardrail/types";
import type { GuardrailBinding } from "../registry";
import type { SafetyOutput, SafetyProtocolEvent } from "../session";
import { resyncStructuredText } from "../structured";

interface FinalizeLanguageTerminalOptions {
  /** Already step-guarded terminal candidate. */
  readonly output: SafetyOutput;
  /** Corrective provider call owned by the selected dialect. */
  readonly regenerate: (
    corrective: readonly Message[],
  ) => Promise<SafetyOutput>;
  /** Full output binding set for the call. */
  readonly bindings: readonly GuardrailBinding[];
  /** Run only object/both bindings when step guards already ran. */
  readonly terminalOnly: boolean;
  readonly enabled: boolean;
  readonly suspended?: boolean;
  readonly messages: readonly Message[];
  readonly schema?: z.ZodType;
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
  readonly constraintsEnabled: boolean;
  readonly applyConstraints: (
    output: SafetyOutput,
    regenerate: (corrective: readonly Message[]) => Promise<SafetyOutput>,
    guardCandidate: (candidate: SafetyOutput) => Promise<SafetyOutput>,
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
    );
  }
  if (options.enabled) await options.applyReportConstraints(current);
  return current;
}

async function applyTerminalGuards(
  options: FinalizeLanguageTerminalOptions,
  bindings: readonly GuardrailBinding[],
  output: SafetyOutput,
): Promise<SafetyOutput> {
  const result = await createGuardrailPipeline(bindings).runOutput(
    output.text,
    options.context,
    { parsed: output.parsed, schema: options.schema },
  );
  options.appendAudit(result.audit);
  options.transcript.push({
    t: "output.guard",
    guards: bindings.length,
    actions: result.audit.applied.map((entry) => entry.action),
  });
  return resyncStructuredText(
    { text: output.text, parsed: result.parsed ?? output.parsed },
    result.content,
    {
      policyId: latestRewritePolicyId(result.audit.applied),
    },
  );
}
