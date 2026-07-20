/** Canonical per-step language output guarding. @internal */

import type { ResultStepFacts } from "../../adapter/result-accumulator";
import type { StepContentEdit } from "../../adapter/executor-types";
import { textFromAssistantContent } from "../../adapter/assistant-output";
import { repairJsonText } from "../../generation/repair-json";
import type { AssistantContentPart } from "../../types/content";
import type { z } from "zod";
import { latestRewritePolicyId } from "../audit";
import { createGuardrailPipeline } from "../guardrail/pipeline";
import type { GuardrailAudit, GuardrailContext } from "../guardrail/types";
import type { GuardrailBinding } from "../registry";
import type { SafetyProtocolEvent } from "../session";
import { resyncStructuredText } from "../structured";
import { guardOutputMedia } from "./media";

interface GuardLanguageStepOptions {
  /** Monotonic provider-response ordinal used by media origins. */
  readonly stepIndex: number;
  /** Canonical facts projected from one provider response. */
  readonly facts: ResultStepFacts;
  /** Enabled output bindings for this Safety session. */
  readonly bindings: readonly GuardrailBinding[];
  /** Safe policy context for this call. */
  readonly context: GuardrailContext;
  /** Append one policy pass to the call-level audit. */
  readonly appendAudit: (audit: GuardrailAudit) => void;
  /** Session protocol ledger shared by both execution dialects. */
  readonly transcript: SafetyProtocolEvent[];
}

/**
 * Guard one normalized provider step before accumulation or continuation.
 *
 * Text and reasoning slots are evaluated independently in original part order.
 * The returned fact record and content array are frozen; usage, tool calls,
 * finish data, warnings, and provider metadata retain their original values.
 */
export async function guardLanguageStep(
  options: GuardLanguageStepOptions,
): Promise<ResultStepFacts> {
  return (await guardLanguageStepWithEdits(options)).facts;
}

/** Guard one step and retain the canonical edit script for loop-owned runtimes. */
export async function guardLanguageStepWithEdits(
  options: GuardLanguageStepOptions,
): Promise<{
  readonly facts: ResultStepFacts;
  readonly edits: readonly StepContentEdit[];
  readonly rewritePolicyId?: string;
}> {
  const textBindings = options.bindings.filter(
    (binding) => binding.boundary.id === "model.output.text",
  );
  const mediaBindings = options.bindings.filter(
    (binding) => binding.boundary.id === "model.output.media",
  );
  if (textBindings.length === 0 && mediaBindings.length === 0) {
    return {
      facts: freezeStep(options.facts, options.facts.content),
      edits: [],
    };
  }

  const pipeline = createGuardrailPipeline(textBindings);
  const content: AssistantContentPart[] = [];
  const edits: StepContentEdit[] = [];
  const actions: string[] = [];
  let rewritePolicyId: string | undefined;
  for (const [partIndex, part] of options.facts.content.entries()) {
    if (part.type === "tool-call") {
      content.push(part);
      continue;
    }
    if (part.type === "text" || part.type === "reasoning") {
      if (textBindings.length === 0) {
        content.push(part);
        continue;
      }
      const result = await pipeline.runOutput(part.text, options.context);
      options.appendAudit(result.audit);
      actions.push(...result.audit.applied.map((entry) => entry.action));
      if (result.content !== part.text) {
        edits.push({ kind: "replace-text", partIndex, text: result.content });
        rewritePolicyId =
          latestRewritePolicyId(result.audit.applied) ?? rewritePolicyId;
      }
      content.push(
        result.content === part.text
          ? part
          : Object.freeze({ ...part, text: result.content }),
      );
      continue;
    }
    if (mediaBindings.length === 0) {
      content.push(part);
      continue;
    }
    const media = await guardOutputMedia({
      bindings: mediaBindings,
      subjects: [
        {
          part,
          origin: { kind: "step", stepIndex: options.stepIndex, partIndex },
        },
      ],
      minimumRetained: 0,
      context: options.context,
      appendAudit: options.appendAudit,
    });
    actions.push(...media.actions);
    if (media.subjects.length === 0) {
      edits.push({ kind: "remove", partIndex });
    } else {
      content.push(part);
    }
  }
  if (actions.length > 0) {
    options.transcript.push({
      t: "output.guard",
      guards: textBindings.length + mediaBindings.length,
      actions,
    });
  }
  return {
    facts: freezeStep(options.facts, content),
    edits: Object.freeze(edits),
    ...(rewritePolicyId !== undefined ? { rewritePolicyId } : {}),
  };
}

/** Fail closed when a step text rewrite breaks an otherwise valid schema. */
export function assertStructuredStepRewrite(options: {
  readonly original: ResultStepFacts;
  readonly guarded: ResultStepFacts;
  readonly schema: z.ZodType | undefined;
  readonly policyId: string | undefined;
}): void {
  if (!options.schema || !options.policyId) return;
  const originalText = repairJsonText(
    textFromAssistantContent(options.original.content),
  );
  if (originalText === null) return;

  const originalValue = JSON.parse(originalText) as unknown;
  const originalValidation = options.schema.safeParse(originalValue);
  if (!originalValidation.success) return;

  const guardedText = textFromAssistantContent(options.guarded.content);
  const repairedGuardedText = repairJsonText(guardedText) ?? guardedText;
  resyncStructuredText(
    { text: originalText, parsed: originalValidation.data },
    repairedGuardedText,
    { schema: options.schema, policyId: options.policyId },
  );
}

function freezeStep(
  facts: ResultStepFacts,
  content: readonly AssistantContentPart[],
): ResultStepFacts {
  return Object.freeze({
    ...facts,
    content: Object.freeze([...content]),
  });
}
