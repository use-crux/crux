import type { Message } from "../../generation/messages";
import type { GuardrailAudit, GuardrailContext } from "../guardrail/types";
import type { GuardrailBinding } from "../registry";
import type { SafetyProtocolEvent } from "../session";
import type { ModelInputOrigin } from "../input-origin";
import { guardInputMedia } from "./media";
import { guardModelTextInput } from "./model-text";
import { guardProjectedTextInput } from "./projected-text";
import { inputBindingsFor } from "./source";

interface GuardInputOptions {
  readonly bindings: readonly GuardrailBinding[];
  readonly input: {
    readonly messages: readonly Message[];
    readonly prompt?: string;
    readonly system?: string;
  };
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
}> {
  const mediaBindings = inputBindingsFor(options.bindings, "model.input.media", "user");
  const userBindings = inputBindingsFor(options.bindings, "model.input.text", "user");
  const modelBindings = options.bindings.filter(
    (binding) => binding.boundary.id === "model.instructions",
  );

  const media = await guardInputMedia({
    bindings: mediaBindings,
    messages: options.input.messages,
    context: options.context,
    appendAudit: options.appendAudit,
  });

  const text = await guardProjectedTextInput({
    bindings: userBindings,
    input: { messages: media.messages, prompt: options.input.prompt },
    context: options.context,
  });
  if (text.audit) options.appendAudit(text.audit);

  const model = await guardModelTextInput({
    bindings: modelBindings,
    messages: text.messages,
    system: options.input.system,
    context: options.context,
  });
  if (model.audit) options.appendAudit(model.audit);

  if (media.ran || text.ran || model.ran) {
    options.transcript.push({
      t: "input.guard",
      guards: mediaBindings.length + userBindings.length + modelBindings.length,
      actions: [...media.actions, ...text.actions, ...model.actions],
    });
  }

  return {
    messages: model.messages,
    prompt: text.prompt,
    system: model.system,
  };
}
