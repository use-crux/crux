/**
 * Model-instruction safety for selected authored representations.
 *
 * @internal
 * @module
 */

import type { Safety } from "../../safety/session-contract";
import { selectSafetySessionRepresentationPolicies } from "../../safety/session-bridge";
import type { CallArgs } from "../types";
import { readSkillActivationSession } from "../tool/resolved";
import type { ResolvedRepresentationPolicy } from "../../request/representation/ladder-types";
import type { ResolvedPrompt } from "../../resolver/types";
import { selectSkillAvailability } from "../../skill/session-contract";
import type { ToolMiddleware } from "../../tools/types";

const canonicalMiddleware = new WeakMap<
  ResolvedPrompt,
  readonly ToolMiddleware[]
>();

/** Select owned safety policies for a represented request candidate. */
export function selectRepresentationCapabilities(
  safety: Safety,
  policies: readonly ResolvedRepresentationPolicy[],
  selections?: ReadonlyMap<string, number>,
): void {
  const disabled = policies.flatMap((policy) => {
    const omitted = policy.rungs.findIndex(
      (rung) => rung.kind === "omitted" && rung.available,
    );
    if (omitted < 0) return [];
    const selected = selections?.get(policy.contributor);
    return selected === undefined || selected === omitted
      ? policy.ownedPolicyIds
      : [];
  });
  selectSafetySessionRepresentationPolicies(safety, disabled);
}

/** Select skills retained by a represented request candidate. */
export function selectRepresentationSkills(
  resolved: ResolvedPrompt,
  policies: readonly ResolvedRepresentationPolicy[],
  selections?: ReadonlyMap<string, number>,
): void {
  const session = readSkillActivationSession(resolved);
  if (!session) return;
  const disabled = policies.flatMap((policy) => {
    const omitted = policy.rungs.findIndex(
      (rung) => rung.kind === "omitted" && rung.available,
    );
    if (omitted < 0) return [];
    const selected = selections?.get(policy.contributor);
    return selected === undefined || selected === omitted
      ? policy.ownedSkillIds
      : [];
  });
  selectSkillAvailability(session, disabled);
}

/** Select prompt middleware retained by a represented request candidate. */
export function selectRepresentationMiddleware(
  resolved: ResolvedPrompt,
  policies: readonly ResolvedRepresentationPolicy[],
  selections?: ReadonlyMap<string, number>,
): void {
  let canonical = canonicalMiddleware.get(resolved);
  if (!canonical) {
    canonical = normalizeMiddleware(resolved.toolMiddleware);
    canonicalMiddleware.set(resolved, canonical);
  }
  const disabled = new Set(
    policies.flatMap((policy) => {
      const omitted = policy.rungs.findIndex(
        (rung) => rung.kind === "omitted" && rung.available,
      );
      if (omitted < 0) return [];
      const selected = selections?.get(policy.contributor);
      return selected === undefined || selected === omitted
        ? policy.ownedToolMiddleware
        : [];
    }),
  );
  const retained = canonical.filter((middleware) => !disabled.has(middleware));
  if (retained.length > 0) resolved.toolMiddleware = retained;
  else delete resolved.toolMiddleware;
}

function normalizeMiddleware(
  middleware: ToolMiddleware | readonly ToolMiddleware[] | undefined,
): readonly ToolMiddleware[] {
  return isMiddlewareArray(middleware)
    ? middleware
    : middleware
      ? [middleware]
      : [];
}

function isMiddlewareArray(
  middleware: ToolMiddleware | readonly ToolMiddleware[] | undefined,
): middleware is readonly ToolMiddleware[] {
  return Array.isArray(middleware);
}

/** Guard a selected alternative before its final measurement and sealing. */
export async function guardRepresentedRequest<
  TExtra extends Record<string, unknown>,
>(
  safety: Safety,
  request: CallArgs<TExtra>,
): Promise<CallArgs<TExtra>> {
  if (request.system !== undefined) {
    const guarded = await safety.guardInput({
      messages: request.messages,
      system: request.system,
    });
    if (
      guarded.system === request.system &&
      guarded.messages === request.messages
    ) {
      return request;
    }
    return {
      ...request,
      messages: [...guarded.messages],
      system: guarded.system,
      ...(guarded.system !== request.system
        ? { systemBlocks: undefined }
        : {}),
    };
  }
  const index = request.messages.findIndex(
    (message) =>
      message.role === "system" && typeof message.content === "string",
  );
  const message = request.messages[index];
  if (
    index < 0 ||
    !message ||
    typeof message.content !== "string"
  ) {
    const guarded = await safety.guardInput({
      messages: request.messages,
    });
    return guarded.messages === request.messages
      ? request
      : { ...request, messages: [...guarded.messages] };
  }
  const guarded = await safety.guardInput({
    messages: request.messages,
    system: message.content,
  });
  const messages = [...guarded.messages];
  messages[index] = {
    ...messages[index]!,
    content: guarded.system ?? "",
  };
  return { ...request, messages };
}
