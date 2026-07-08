/**
 * Shared helpers for public adapter codecs.
 *
 * Public adapter packages expose `toParams()`/`fromResponse()` for users who
 * want to own the wire call. This module keeps the provider-neutral prompt
 * shaping identical to the managed core-step path without running tool
 * lifecycle policy.
 *
 * @module
 */

import type { Message } from "../generation/messages";
import type { GenerationSettings } from "../generation/types";
import type { ResolvedPrompt } from "../resolver/types";
import type { CallArgs } from "./types";

/** Options required to turn a resolved prompt into provider call args. */
export interface ResolvedPromptCodecOptions<
  TExtra extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Provider model id for this wire call. */
  readonly model: string;
  /** Provider-native settings produced by the adapter's settings mapper. */
  readonly settings?: Record<string, unknown>;
  /** Canonical unsupported-content policy kept out of provider-native settings. */
  readonly unsupportedContent?: NonNullable<GenerationSettings["unsupportedContent"]>;
  /** Provider-specific options that belong in the adapter's `extra` escape hatch. */
  readonly extra?: TExtra;
  /** Conversation history override, matching managed `generate({ messages })`. */
  readonly messages?: readonly Message[];
  /**
   * Prebuilt provider-call tool descriptors.
   *
   * Codecs are translation-only: they do not run middleware, approval, typed
   * context, or execution policy. Use managed/handle mode when Crux should own
   * the tool lifecycle.
   */
  readonly tools?: CallArgs<TExtra>["tools"];
  /** Provider-native structured-output params, when the adapter supports them. */
  readonly schemaParams?: Record<string, unknown>;
}

/** Build canonical provider call args from a resolved prompt. */
export function callArgsFromResolvedPrompt<
  TExtra extends Record<string, unknown> = Record<string, unknown>,
>(
  resolved: ResolvedPrompt,
  options: ResolvedPromptCodecOptions<TExtra>,
): CallArgs<TExtra> {
  return {
    model: options.model,
    system: resolved.system,
    systemBlocks: resolved.systemBlocks,
    messages: initialMessages(resolved, options.messages),
    unsupportedContent:
      options.unsupportedContent ?? resolved.settings.unsupportedContent,
    settings: options.settings ?? {},
    schema: resolved.schema,
    schemaParams: options.schemaParams,
    tools: options.tools ? [...options.tools] : undefined,
    extra: options.extra ?? ({} as TExtra),
  };
}

function initialMessages(
  resolved: Pick<ResolvedPrompt, "prompt" | "messages">,
  messages?: readonly Message[],
): Message[] {
  const history: Message[] = [...(messages ?? [])];
  if (history.length === 0 && resolved.prompt) {
    history.push({ role: "user", content: resolved.prompt });
  } else if (history.length === 0 && resolved.messages) {
    history.push(...(resolved.messages as Message[]));
  }
  return history;
}
