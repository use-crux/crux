import { messageText } from "../../content";
import type { Message } from "../../generation/messages";
import type { MessageContent } from "../../types/content";
import { SafetyResultError } from "../errors";
import { createGuardrailPipeline } from "../guardrail/pipeline";
import type {
  GuardrailAudit,
  GuardrailAuditEntry,
  GuardrailContext,
} from "../guardrail/types";
import type { GuardrailBinding } from "../registry";
import { applyProjectedRewrite } from "./projected-text";

interface GuardModelTextInputOptions {
  readonly bindings: readonly GuardrailBinding[];
  readonly messages: readonly Message[];
  readonly system?: string;
  readonly context: (messages: readonly Message[]) => GuardrailContext;
}

export interface ModelTextInputResult {
  readonly messages: readonly Message[];
  readonly system?: string;
  readonly audit?: GuardrailAudit;
  readonly actions: readonly string[];
  readonly ran: boolean;
}

/** Guard flat and message-form model instructions independently from user text. */
export async function guardModelTextInput(
  options: GuardModelTextInputOptions,
): Promise<ModelTextInputResult> {
  if (options.bindings.length === 0)
    return {
      messages: options.messages,
      system: options.system,
      actions: [],
      ran: false,
    };

  const pipeline = createGuardrailPipeline(options.bindings);
  const applied: GuardrailAuditEntry[] = [];
  const actions: string[] = [];
  let messages = options.messages;
  let system = options.system;
  let ran = false;

  if (system !== undefined) {
    const result = await pipeline.runInput(system, options.context(messages));
    applied.push(...result.audit.applied);
    actions.push(...result.audit.applied.map((entry) => entry.action));
    system = result.content;
    ran = true;
  }

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (!message || message.role !== "system") continue;

    ran = true;
    const originalContent = messageText(message);
    const result = await pipeline.runInput(
      originalContent,
      options.context(messages),
    );
    applied.push(...result.audit.applied);
    actions.push(...result.audit.applied.map((entry) => entry.action));
    if (result.content === originalContent) continue;

    const content = applyProjectedRewrite(
      message.content as MessageContent,
      originalContent,
      result.content,
    );
    if (content === null) {
      const policyId = latestRewritePolicyId(result.audit.applied) ?? "unknown";
      throw new SafetyResultError({
        policyId,
        boundary: "model.input",
        problem:
          "rewrite could not be faithfully applied to multimodal system message content",
        message:
          `Safety policy "${policyId}" rewrote a multimodal system projection that no longer aligns with its media placeholders. ` +
          "Media placeholders must be preserved verbatim by rewrites.",
      });
    }
    messages = messages.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, content } : entry,
    );
  }

  return {
    messages,
    system,
    ...(ran ? { audit: { applied, blocked: false } } : {}),
    actions,
    ran,
  };
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
    )
      return entry.guard;
  }
  return undefined;
}
