import type { Message } from "../../generation/messages";
import type { GuardrailAudit, GuardrailContext } from "../guardrail/types";
import type { GuardrailBinding } from "../registry";
import type { SafetyProtocolEvent } from "../session";
import type { ModelInputOrigin } from "../input-origin";
import { guardInputMedia } from "./media";
import { guardModelTextInput } from "./model-text";
import { guardProjectedTextInput } from "./projected-text";
import { inputBindingsFor } from "./source";
import type { ResolvedSystemIngressCarrier } from "../../resolver/system-ingress-provenance";
import { guardResolvedSystemInput } from "./resolved-system";
import type {
  ResolvedSystemIngressDelivery,
  ResolvedSystemInputResult,
} from "./resolved-system";

interface GuardInputOptions {
  readonly bindings: readonly GuardrailBinding[];
  readonly input: {
    readonly messages: readonly Message[];
    readonly prompt?: string;
    readonly system?: string;
  };
  readonly systemIngress?: ResolvedSystemIngressCarrier;
  readonly systemIngressScope?: "full" | "carrier";
  readonly context: (
    messages: readonly Message[],
    origin?: ModelInputOrigin,
  ) => GuardrailContext;
  readonly appendAudit: (audit: GuardrailAudit) => void;
  readonly transcript: SafetyProtocolEvent[];
}

/** Run canonical media boundaries before the projected-text input pass. */
export async function guardInput(options: GuardInputOptions): Promise<{
  readonly messages: readonly Message[];
  readonly prompt?: string;
  readonly system?: string;
  readonly systemIngress?: ResolvedSystemIngressDelivery;
}> {
  const carrierOnly = options.systemIngressScope === "carrier";
  const mediaBindings = inputBindingsFor(options.bindings, "model.input.media", "user");
  const userBindings = inputBindingsFor(options.bindings, "model.input.text", "user");
  const retrievalBindings = inputBindingsFor(
    options.bindings,
    "model.input.text",
    "retrieval",
  );
  const modelBindings = options.bindings.filter(
    (binding) => binding.boundary.id === "model.instructions",
  );

  const media = carrierOnly
    ? { messages: options.input.messages, actions: [], ran: false }
    : await guardInputMedia({
        bindings: mediaBindings,
        messages: options.input.messages,
        context: options.context,
        appendAudit: options.appendAudit,
      });

  const text = carrierOnly
    ? {
        messages: media.messages,
        prompt: options.input.prompt,
        actions: [],
        ran: false,
      }
    : await guardProjectedTextInput({
        bindings: userBindings,
        input: { messages: media.messages, prompt: options.input.prompt },
        context: options.context,
      });
  if (text.audit) options.appendAudit(text.audit);

  const model = options.systemIngress
    ? await guardResolvedSystemInput({
        bindings: options.bindings,
        carrier: options.systemIngress,
        messages: text.messages,
        system: options.input.system,
        scope: options.systemIngressScope,
        context: options.context,
      })
    : await guardModelTextInput({
        bindings: modelBindings,
        messages: text.messages,
        system: options.input.system,
        context: options.context,
      });
  if (model.audit) options.appendAudit(model.audit);

  if (media.ran || text.ran || model.ran) {
    options.transcript.push({
      t: "input.guard",
      guards:
        mediaBindings.length +
        userBindings.length +
        modelBindings.length +
        (options.systemIngress?.blocks.some(
          (block) => block.family === "retriever",
        )
          ? retrievalBindings.length
          : 0),
      actions: [...media.actions, ...text.actions, ...model.actions],
    });
  }

  return {
    messages: model.messages,
    prompt: text.prompt,
    system: model.system,
    ...(options.systemIngress
      ? { systemIngress: (model as ResolvedSystemInputResult).systemIngress }
      : {}),
  };
}
