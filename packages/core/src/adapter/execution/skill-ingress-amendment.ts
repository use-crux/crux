/**
 * Guarded post-`LoadSkill` amendments for the active model conversation.
 *
 * Re-resolution supplies fresh resolver provenance, while this execution-owned
 * state remembers only the sanitized boundary already delivered. The result is
 * either a standalone system replacement or one exact, one-shot prefix patch.
 *
 * @internal
 * @module
 */

import type { Message } from "../../generation/messages";
import { joinSystemText } from "../../resolver/adaptation";
import {
  systemIngressCarrierFor,
  type ResolvedSystemIngressCarrier,
} from "../../resolver/system-ingress-provenance";
import type { ResolvedPrompt, SystemBlock } from "../../resolver/types";
import { SafetyResultError } from "../../safety/errors";
import type { ResolvedSystemIngressDelivery } from "../../safety/input/resolved-system";
import {
  guardSafetySessionIngressCarrier,
  type Safety,
} from "../../safety/session";
import type { InitialMessageSource } from "./messages";
import {
  createSystemMessagePrefixPatch,
  type SystemMessagePrefixPatch,
} from "./system-prefix-patch";

/** Sanitized amendment returned to the tool lifecycle. */
export interface GuardedSkillIngressAmendment {
  readonly system?: string;
  readonly systemBlocks?: readonly SystemBlock[];
  readonly prefixPatch?: SystemMessagePrefixPatch;
}

/** Input to one post-skill guarded re-resolution. */
export interface GuardSkillIngressAmendmentInput {
  readonly resolved: ResolvedPrompt;
  readonly newlyLoadedSkillIds: readonly string[];
}

/** Stateful guard owned by one model execution. */
export type GuardSkillIngressAmendment = (
  input: GuardSkillIngressAmendmentInput,
) => Promise<GuardedSkillIngressAmendment>;

/**
 * Create the amendment guard after initial input Safety has established the
 * exact sanitized system boundary delivered to the first provider call.
 */
export function createSkillIngressAmendmentGuard(options: {
  readonly safety: Safety;
  readonly source: InitialMessageSource;
  readonly messages: readonly Message[];
  readonly systemIngress?: ResolvedSystemIngressDelivery;
}): GuardSkillIngressAmendment {
  if (options.systemIngress?.mode === "system") {
    return createStandaloneSystemGuard(options.safety, options.messages);
  }
  if (options.source === "resolved-messages") {
    return createResolvedMessagesGuard(options);
  }
  if (
    options.source === "explicit-history" ||
    options.source === "native-history"
  ) {
    return createExplicitHistoryGuard(options.safety, options.messages);
  }
  return createStandaloneSystemGuard(options.safety, options.messages);
}

function createStandaloneSystemGuard(
  safety: Safety,
  messages: readonly Message[],
): GuardSkillIngressAmendment {
  return async ({ resolved }) => {
    const carrier = requireCarrier(resolved, "system");
    const guarded = await guardSafetySessionIngressCarrier(safety, carrier, {
      messages,
      system: resolved.system,
    });
    const system = requireDelivery(guarded.systemIngress, "system").text;
    return {
      system,
      ...(system === resolved.system && resolved.systemBlocks
        ? { systemBlocks: resolved.systemBlocks }
        : {}),
    };
  };
}

function createResolvedMessagesGuard(options: {
  readonly safety: Safety;
  readonly messages: readonly Message[];
  readonly systemIngress?: ResolvedSystemIngressDelivery;
}): GuardSkillIngressAmendment {
  const initial =
    options.systemIngress?.mode === "messages"
      ? options.systemIngress
      : undefined;
  let expectedPrefix = initial?.prefix ?? "";
  let expectedContent = initial?.content ?? "";
  const trustedSuffix = initial?.suffix ?? "";

  return async ({ resolved }) => {
    if (!initial) {
      throw amendmentError(
        "active resolved messages do not have an exact guarded prefix boundary",
      );
    }
    const carrier = requireCarrier(resolved, "messages");
    const freshMessages = (resolved.messages ?? []) as Message[];
    const guarded = await guardSafetySessionIngressCarrier(
      options.safety,
      carrier,
      { messages: freshMessages },
    );
    const delivery = requireDelivery(guarded.systemIngress, "messages");
    const replacementPrefix =
      delivery.prefix && trustedSuffix
        ? `${delivery.prefix}\n\n`
        : delivery.prefix;
    const prefixPatch = createSystemMessagePrefixPatch({
      targetMessageIndex: initial.targetMessageIndex,
      expectedPrefix,
      ...(expectedPrefix === "" ? { expectedContent } : {}),
      replacementPrefix,
    });
    expectedPrefix = replacementPrefix;
    expectedContent = `${replacementPrefix}${trustedSuffix}`;
    return { prefixPatch };
  };
}

function createExplicitHistoryGuard(
  safety: Safety,
  messages: readonly Message[],
): GuardSkillIngressAmendment {
  const targetMessageIndex = messages.findIndex(
    (message) => message.role === "system",
  );
  const target =
    targetMessageIndex >= 0 ? messages[targetMessageIndex] : undefined;
  const trustedSuffix =
    target && typeof target.content === "string" ? target.content : "";
  let ownedText = "";
  let expectedPrefix: string | undefined =
    targetMessageIndex >= 0 ? "" : undefined;
  let expectedContent = trustedSuffix;

  return async ({ resolved, newlyLoadedSkillIds }) => {
    if (target && typeof target.content !== "string") {
      throw amendmentError(
        "explicit history has a non-text system message that cannot be amended exactly",
      );
    }
    const freshCarrier = requireCarrier(resolved, "messages");
    const expectedIds = new Set(
      newlyLoadedSkillIds.map((id) => `__crux_skill_loaded:${id}`),
    );
    const blocks = freshCarrier.blocks.filter(
      (block) =>
        block.family === "skill" &&
        block.contextId !== undefined &&
        expectedIds.has(block.contextId),
    );
    if (blocks.length !== expectedIds.size) {
      throw amendmentError(
        "fresh skill resolution did not contain every newly loaded skill block",
      );
    }
    const carrier: ResolvedSystemIngressCarrier = {
      mode: "system",
      blocks,
    };
    const rawText = joinSystemText(blocks.map((block) => block.text));
    const guarded = await guardSafetySessionIngressCarrier(safety, carrier, {
      messages,
      system: rawText,
    });
    const loadedText = requireDelivery(guarded.systemIngress, "system").text;
    ownedText = joinSystemText([ownedText, loadedText]);
    const replacementPrefix =
      ownedText && trustedSuffix ? `${ownedText}\n\n` : ownedText;
    if (expectedPrefix === undefined && replacementPrefix === "") return {};
    const prefixPatch = createSystemMessagePrefixPatch({
      targetMessageIndex: targetMessageIndex >= 0 ? targetMessageIndex : 0,
      expectedPrefix,
      ...(expectedPrefix === "" ? { expectedContent } : {}),
      replacementPrefix,
    });
    expectedPrefix = replacementPrefix;
    expectedContent = `${replacementPrefix}${trustedSuffix}`;
    return { prefixPatch };
  };
}

function requireCarrier<TMode extends ResolvedSystemIngressCarrier["mode"]>(
  resolved: ResolvedPrompt,
  mode: TMode,
): Extract<ResolvedSystemIngressCarrier, { readonly mode: TMode }> {
  const carrier = systemIngressCarrierFor(resolved);
  if (carrier?.mode !== mode) {
    throw amendmentError(
      `fresh skill resolution did not retain ${mode} ingress provenance`,
    );
  }
  return carrier as Extract<
    ResolvedSystemIngressCarrier,
    { readonly mode: TMode }
  >;
}

function requireDelivery<TMode extends ResolvedSystemIngressDelivery["mode"]>(
  delivery: ResolvedSystemIngressDelivery | undefined,
  mode: TMode,
): Extract<ResolvedSystemIngressDelivery, { readonly mode: TMode }> {
  if (delivery?.mode !== mode) {
    throw amendmentError(
      `guarded skill resolution did not produce a ${mode} ingress boundary`,
    );
  }
  return delivery as Extract<
    ResolvedSystemIngressDelivery,
    { readonly mode: TMode }
  >;
}

function amendmentError(problem: string): SafetyResultError {
  return new SafetyResultError({
    message: problem,
    policyId: "model-ingress",
    boundary: "model.instructions",
    problem,
  });
}
