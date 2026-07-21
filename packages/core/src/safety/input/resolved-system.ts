/** Semantic guarding and exact writeback for resolver-owned system content. */

import type { Message } from "../../generation/messages";
import type { ResolvedSystemIngressCarrier } from "../../resolver/system-ingress-provenance";
import { joinSystemText } from "../../resolver/adaptation";
import type {
  GuardrailAudit,
  GuardrailAuditEntry,
  GuardrailContext,
} from "../guardrail/types";
import { createGuardrailPipeline } from "../guardrail/pipeline";
import type { GuardrailBinding } from "../registry";
import { guardModelIngress } from "./model-ingress";
import { guardModelTextInput, type ModelTextInputResult } from "./model-text";
import { inputBindingsFor } from "./source";
import {
  resolveSystemIngressTarget,
  systemIngressRetrieverId,
} from "./resolved-system-target";

interface GuardResolvedSystemOptions {
  readonly bindings: readonly GuardrailBinding[];
  readonly carrier: ResolvedSystemIngressCarrier;
  readonly messages: readonly Message[];
  readonly system?: string;
  readonly scope?: "full" | "carrier";
  readonly context: (
    messages: readonly Message[],
    origin?: import("../input-origin").ModelInputOrigin,
  ) => GuardrailContext;
}

/** Exact sanitized delivery facts retained only by managed execution. */
export type ResolvedSystemIngressDelivery =
  | {
      readonly mode: "system";
      readonly text: string;
    }
  | {
      readonly mode: "messages";
      readonly targetMessageIndex: number;
      readonly prefix: string;
      readonly suffix: string;
      readonly content: string;
    };

/** Internal result with the sanitized carrier boundary used by amendments. */
export interface ResolvedSystemInputResult extends ModelTextInputResult {
  readonly systemIngress: ResolvedSystemIngressDelivery;
}

/** Guard exact resolver contributions and rebuild their provider delivery. */
export async function guardResolvedSystemInput(
  options: GuardResolvedSystemOptions,
): Promise<ResolvedSystemInputResult> {
  const fullInput = options.scope !== "carrier";
  const retrievalBindings = inputBindingsFor(
    options.bindings,
    "model.input.text",
    "retrieval",
  );
  const instructionBindings = options.bindings.filter(
    (binding) => binding.boundary.id === "model.instructions",
  );
  const targetApplicable =
    options.scope === "carrier" ||
    options.carrier.blocks.some((block) =>
      block.family === "retriever"
        ? retrievalBindings.length > 0
        : instructionBindings.length > 0,
    ) ||
    (fullInput &&
      options.carrier.mode === "messages" &&
      options.carrier.hasTrustedSuffix &&
      instructionBindings.length > 0);
  const mismatchBinding =
    retrievalBindings.length > 0 &&
    options.carrier.blocks.some((block) => block.family === "retriever")
      ? retrievalBindings[0]!
      : instructionBindings[0];
  const target = targetApplicable
    ? resolveSystemIngressTarget(options, mismatchBinding)
    : undefined;
  const applied: GuardrailAuditEntry[] = [];
  const actions: string[] = [];
  let ran = false;

  const guardedBlocks: string[] = [];
  for (
    let blockIndex = 0;
    blockIndex < options.carrier.blocks.length;
    blockIndex++
  ) {
    const block = options.carrier.blocks[blockIndex]!;
    if (block.family === "retriever") {
      if (retrievalBindings.length === 0) {
        guardedBlocks.push(block.text);
        continue;
      }
      ran = true;
      let audit: GuardrailAudit | undefined;
      const guarded = await guardModelIngress({
        bindings: options.bindings,
        input: {
          kind: "text",
          value: block.text,
          origin: {
            source: "retrieval",
            kind: "retrieval-context",
            retrieverId: systemIngressRetrieverId(block),
            blockIndex,
          },
        },
        context: options.context(options.messages),
        appendAudit: (value) => {
          audit = value;
        },
      });
      if (guarded.kind !== "text") {
        throw new Error("Retrieval model ingress returned a non-text patch.");
      }
      appendAudit(applied, actions, audit);
      guardedBlocks.push(guarded.value);
      continue;
    }

    if (instructionBindings.length === 0) {
      guardedBlocks.push(block.text);
      continue;
    }
    ran = true;
    const result = await createGuardrailPipeline(instructionBindings).runInput(
      block.text,
      options.context(options.messages),
    );
    appendAudit(applied, actions, result.audit);
    guardedBlocks.push(result.content);
  }

  let messages = options.messages;
  let system = options.system;
  let systemIngress: ResolvedSystemIngressDelivery | undefined;
  if (options.carrier.mode === "system" && target) {
    const rebuilt = joinSystemText(guardedBlocks);
    if (rebuilt !== target.prefix) system = rebuilt;
    systemIngress = { mode: "system", text: system ?? "" };
  } else if (options.carrier.mode === "messages" && target) {
    const targetMessageIndex = options.carrier.targetMessageIndex;
    let suffix = target.suffix;
    if (fullInput && suffix && instructionBindings.length > 0) {
      ran = true;
      const result = await createGuardrailPipeline(
        instructionBindings,
      ).runInput(suffix, options.context(messages));
      appendAudit(applied, actions, result.audit);
      suffix = result.content;
    }
    const blockText = joinSystemText(guardedBlocks);
    const rebuilt = fullInput ? joinSystemText([blockText, suffix]) : blockText;
    if (fullInput && rebuilt !== target.content) {
      messages = messages.map((message, index) =>
        index === targetMessageIndex
          ? { ...message, content: rebuilt }
          : message,
      );
    }
    systemIngress = {
      mode: "messages",
      targetMessageIndex,
      prefix: fullInput && blockText && suffix ? `${blockText}\n\n` : blockText,
      suffix: fullInput ? suffix : "",
      content: rebuilt,
    };
  }

  systemIngress ??= unchangedDelivery(options, guardedBlocks);
  const otherInstructions = fullInput
    ? await guardModelTextInput({
        bindings: instructionBindings,
        messages,
        ...(options.carrier.mode === "messages"
          ? { skipMessageIndex: options.carrier.targetMessageIndex }
          : {}),
        context: (current) => options.context(current),
      })
    : {
        messages,
        system,
        actions: [],
        ran: false,
      };
  appendAudit(applied, actions, otherInstructions.audit);
  ran = ran || otherInstructions.ran;

  return {
    messages: otherInstructions.messages,
    system,
    ...(ran ? { audit: { applied, blocked: false } } : {}),
    actions,
    ran,
    systemIngress,
  };
}

function unchangedDelivery(
  options: GuardResolvedSystemOptions,
  guardedBlocks: readonly string[],
): ResolvedSystemIngressDelivery {
  const blockText = joinSystemText(guardedBlocks);
  if (options.carrier.mode === "system") {
    return {
      mode: "system",
      text: options.scope === "carrier" ? blockText : (options.system ?? ""),
    };
  }
  if (options.scope === "carrier") {
    return {
      mode: "messages",
      targetMessageIndex: options.carrier.targetMessageIndex,
      prefix: blockText,
      suffix: "",
      content: blockText,
    };
  }
  const message = options.messages[options.carrier.targetMessageIndex];
  const content =
    message?.role === "system" && typeof message.content === "string"
      ? message.content
      : "";
  const matches = content.startsWith(options.carrier.foldedPrefix);
  return {
    mode: "messages",
    targetMessageIndex: options.carrier.targetMessageIndex,
    prefix: matches ? options.carrier.foldedPrefix : "",
    suffix: matches ? content.slice(options.carrier.prefixLength) : content,
    content,
  };
}

function appendAudit(
  applied: GuardrailAuditEntry[],
  actions: string[],
  audit: GuardrailAudit | undefined,
): void {
  if (!audit) return;
  applied.push(...audit.applied);
  actions.push(...audit.applied.map((entry) => entry.action));
}
