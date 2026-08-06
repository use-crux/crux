/** Provider-neutral resolution of Session input claimed at a model boundary. */

import type { Message } from "../../generation/messages";
import type {
  ManagedGenerationStepBoundary,
  ManagedGenerationStepBoundaryInput,
} from "../../generation-model/execution-checkpoint";
import type { AnyPrompt } from "../../prompt/prompt-types";
import type { ExecutionResolveOpts } from "./types";
import { authoredMessages } from "./authored-messages";

const stepIngressMessage: unique symbol = Symbol("crux.step-ingress-message");

type StepIngressMessage = Message & { readonly [stepIngressMessage]: true };

/** Resolve each claimed Agent input independently into ordered canonical messages. */
export async function resolveStepIngress(options: {
  readonly boundary: ManagedGenerationStepBoundary | undefined;
  readonly input: ManagedGenerationStepBoundaryInput;
  readonly prompt: AnyPrompt;
  readonly resolveOptions: ExecutionResolveOpts;
}): Promise<readonly Message[]> {
  if (!options.boundary) return [];
  const claimed = await options.boundary(options.input);
  const messages: Message[] = [];
  for (const ingress of claimed.inputs) {
    const resolved = await options.prompt.resolve({
      ...options.resolveOptions,
      input: ingress.input,
    } as unknown as ExecutionResolveOpts);
    messages.push(...authoredMessages(resolved).map(markStepIngressMessage));
  }
  return Object.freeze(messages);
}

/** Identify canonical messages authored by independently delivered Session input. */
export function isStepIngressMessage(
  message: Message,
): message is StepIngressMessage {
  return stepIngressMessage in message && message[stepIngressMessage] === true;
}

/** Remove the private in-process marker before durable Thread publication. */
export function canonicalStepIngressMessage(
  message: StepIngressMessage,
): Message {
  return message.role === "assistant"
    ? {
        role: message.role,
        content: message.content,
        ...(message.metadata ? { metadata: message.metadata } : {}),
      }
    : {
        role: message.role,
        content: message.content,
        ...(message.metadata ? { metadata: message.metadata } : {}),
      };
}

function markStepIngressMessage(message: Message): StepIngressMessage {
  const marked: StepIngressMessage = {
    ...message,
    [stepIngressMessage]: true,
  };
  return Object.freeze(marked);
}
