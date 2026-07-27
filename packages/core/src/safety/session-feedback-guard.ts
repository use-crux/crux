/** Private model-ingress guard for corrective retry writeback. @internal */

import type { Message } from "../generation/messages";
import type { AssistantContentPart, ContentPart } from "../types/content";
import { SafetyResultError } from "./errors";
import { createGuardrailPipeline } from "./guardrail/pipeline";
import type { GuardrailAudit, GuardrailContext } from "./guardrail/types";
import type { ModelInputOrigin } from "./input-origin";
import { inputBindingsFor } from "./input/source";
import type { GuardrailBinding } from "./registry";

type FeedbackOrigin = Extract<
  ModelInputOrigin,
  { readonly source: "feedback" }
>;

/** A single corrective text occurrence before provider writeback. */
export interface FeedbackIngress {
  readonly kind: FeedbackOrigin["kind"];
  readonly text: string;
  /** One-based retry attempt shared with its corrective exchange. */
  readonly attempt: number;
}

/** Private per-session capability for one corrective text occurrence. */
export interface FeedbackIngressGuard {
  (input: FeedbackIngress): Promise<string>;
}

/** Retry-owned writeback facts supplied only after retry eligibility is known. */
export interface CorrectiveWriteback {
  readonly kind: Exclude<FeedbackOrigin["kind"], "rejected-output">;
  readonly attempt: number;
  readonly rejectedOutput: string;
}

/** Internal regeneration callback carrying the exact rejected-output writeback. */
export interface SafetyRegenerate {
  (
    corrective: readonly Message[],
    writeback: CorrectiveWriteback,
  ): Promise<import("./session-contract").SafetyOutput>;
}

interface GuardSessionFeedbackOptions {
  readonly bindings: readonly GuardrailBinding[];
  readonly input: FeedbackIngress;
  readonly context: GuardrailContext;
  readonly appendAudit: (audit: GuardrailAudit) => void;
}

/** Guard one rejected-output or corrective-feedback occurrence. */
export async function guardSessionFeedback(
  options: GuardSessionFeedbackOptions,
): Promise<string> {
  assertCorrectiveAttempt(options.input.attempt);
  const feedbackBindings = new Set(
    inputBindingsFor(options.bindings, "model.input.text", "feedback"),
  );
  const bindings = options.bindings.filter(
    (binding) =>
      feedbackBindings.has(binding) ||
      (options.input.kind === "validation-feedback" &&
        binding.boundary.id === "validation.feedback"),
  );
  if (bindings.length === 0) return options.input.text;

  const origin: FeedbackOrigin = {
    source: "feedback",
    kind: options.input.kind,
    attempt: options.input.attempt,
  };
  const result = await createGuardrailPipeline(bindings).runInput(
    options.input.text,
    { ...options.context, origin },
  );
  options.appendAudit(result.audit);
  return result.content;
}

interface GuardCorrectiveMessagesOptions {
  readonly messages: readonly Message[];
  readonly kind: Exclude<FeedbackOrigin["kind"], "rejected-output">;
  readonly attempt: number;
  readonly guard: FeedbackIngressGuard;
}

/** Guard both semantic halves of one eligible corrective retry. */
export async function guardCorrectiveWriteback(
  input: CorrectiveWriteback & {
    readonly corrective: readonly Message[];
    readonly guard: FeedbackIngressGuard;
  },
): Promise<{
  readonly rejectedOutput: string;
  readonly corrective: readonly Message[];
}>;
/** Guard an eligible retry whose route may not replay rejected output. */
export async function guardCorrectiveWriteback(
  input: Omit<CorrectiveWriteback, "rejectedOutput"> & {
    readonly rejectedOutput: string | undefined;
    readonly corrective: readonly Message[];
    readonly guard: FeedbackIngressGuard;
  },
): Promise<{
  readonly rejectedOutput: string | undefined;
  readonly corrective: readonly Message[];
}>;
export async function guardCorrectiveWriteback(
  input: Omit<CorrectiveWriteback, "rejectedOutput"> & {
    readonly rejectedOutput: string | undefined;
    readonly corrective: readonly Message[];
    readonly guard: FeedbackIngressGuard;
  },
): Promise<{
  readonly rejectedOutput: string | undefined;
  readonly corrective: readonly Message[];
}> {
  const rejectedOutput =
    input.rejectedOutput === undefined
      ? undefined
      : await input.guard({
          kind: "rejected-output",
          text: input.rejectedOutput,
          attempt: input.attempt,
        });
  const corrective = await guardCorrectiveMessages({
    messages: input.corrective,
    kind: input.kind,
    attempt: input.attempt,
    guard: input.guard,
  });
  return { rejectedOutput, corrective };
}

/**
 * Guard canonical corrective messages by provider-visible textual occurrence.
 *
 * String content, text parts, and assistant reasoning parts are visited in
 * message order. Opaque metadata, provider options, media, and tool inputs are
 * retained by identity and are never inspected.
 */
export async function guardCorrectiveMessages(
  options: GuardCorrectiveMessagesOptions,
): Promise<readonly Message[]> {
  let changed = false;
  const messages: Message[] = [];
  for (const message of options.messages) {
    const guarded = await guardMessage(message, options);
    messages.push(guarded);
    changed = changed || guarded !== message;
  }
  return changed ? messages : options.messages;
}

async function guardMessage(
  message: Message,
  options: GuardCorrectiveMessagesOptions,
): Promise<Message> {
  if (isAssistantPartsMessage(message)) {
    return guardAssistantParts(message, options);
  }
  if (isInputPartsMessage(message)) {
    return guardInputParts(message, options);
  }
  if (typeof message.content === "string") {
    const content = await options.guard({
      kind: options.kind,
      text: message.content,
      attempt: options.attempt,
    });
    return content === message.content ? message : { ...message, content };
  }
  return message;
}

type AssistantPartsMessage = Omit<
  Extract<Message, { readonly role: "assistant" }>,
  "content"
> & {
  readonly content: readonly AssistantContentPart[];
};

type InputPartsMessage = Omit<
  Exclude<Message, { readonly role: "assistant" }>,
  "content"
> & {
  readonly content: readonly ContentPart[];
};

function isAssistantPartsMessage(
  message: Message,
): message is AssistantPartsMessage {
  return message.role === "assistant" && Array.isArray(message.content);
}

function isInputPartsMessage(message: Message): message is InputPartsMessage {
  return message.role !== "assistant" && Array.isArray(message.content);
}

async function guardAssistantParts(
  message: AssistantPartsMessage,
  options: GuardCorrectiveMessagesOptions,
): Promise<Message> {
  let changed = false;
  const content = [];
  for (const part of message.content) {
    if (part.type !== "text" && part.type !== "reasoning") {
      content.push(part);
      continue;
    }
    const text = await options.guard({
      kind: options.kind,
      text: part.text,
      attempt: options.attempt,
    });
    if (text === part.text) {
      content.push(part);
    } else {
      changed = true;
      content.push({ ...part, text });
    }
  }
  return changed ? { ...message, content } : message;
}

async function guardInputParts(
  message: InputPartsMessage,
  options: GuardCorrectiveMessagesOptions,
): Promise<Message> {
  let changed = false;
  const content = [];
  for (const part of message.content) {
    if (part.type !== "text") {
      content.push(part);
      continue;
    }
    const text = await options.guard({
      kind: options.kind,
      text: part.text,
      attempt: options.attempt,
    });
    if (text === part.text) {
      content.push(part);
    } else {
      changed = true;
      content.push({ ...part, text });
    }
  }
  return changed ? { ...message, content } : message;
}

function assertCorrectiveAttempt(attempt: number): void {
  if (Number.isSafeInteger(attempt) && attempt > 0) return;
  throw new SafetyResultError({
    policyId: "feedback-ingress",
    boundary: "model.input.text",
    problem: "corrective attempt must be a positive safe integer",
    message:
      "Safety could not guard corrective model ingress without a valid one-based retry attempt.",
  });
}
