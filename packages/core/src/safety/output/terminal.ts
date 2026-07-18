/** Terminal language guardrail and constraint orchestration. @internal */

import type { z } from "zod";
import type { Message } from "../../generation/messages";
import { createGuardrailPipeline } from "../guardrail/pipeline";
import type {
  GuardrailAudit,
  GuardrailAuditEntry,
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
  if (!options.enabled) return options.output;
  if (options.suspended) {
    options.transcript.push({ t: "suspend" });
    return options.output;
  }

  const bindings = options.terminalOnly
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

  let current = await guardCandidate(options.output);
  if (options.constraintsEnabled) {
    current = await options.applyConstraints(
      current,
      options.regenerate,
      guardCandidate,
    );
  }
  await options.applyReportConstraints(current);
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
    schema: options.schema,
    policyId: latestRewritePolicyId(result.audit.applied),
    },
  );
}

function latestRewritePolicyId(
  entries: readonly GuardrailAuditEntry[],
): string | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (
      entry?.action === "redact" ||
      entry?.action === "transform" ||
      entry?.action === "rewrite"
    ) {
      return entry.guard;
    }
  }
  return undefined;
}
