/**
 * Complete-request candidates compiled from resolved representation policy.
 *
 * @module
 */

import type { CallArgs } from "../../adapter/types";
import type { RequestAdaptation } from "../receipt/adaptations";
import type { ResolvedRepresentationPolicy } from "../representation/ladder-types";
import { applySkillProjection } from "./skill-projection";

/** One complete legal request candidate. @internal */
export interface RequestCandidate<
  TExtra extends Record<string, unknown>,
> {
  readonly request: CallArgs<TExtra>;
  readonly fidelity: readonly number[];
  readonly adaptations: readonly RequestAdaptation[];
  readonly selections: ReadonlyMap<string, number>;
}

/** Enumerate legal candidates in a deterministic contributor order. @internal */
export function requestCandidates<
  TExtra extends Record<string, unknown>,
>(
  request: CallArgs<TExtra>,
  policies: readonly ResolvedRepresentationPolicy[],
  floors: ReadonlyMap<string, number>,
): readonly RequestCandidate<TExtra>[] {
  const ordered = orderRepresentationPolicies(policies);
  const selections: number[][] = [];
  enumerateSelections(ordered, floors, 0, [], selections);
  return selections.map((selection) =>
    buildRequestCandidate(request, ordered, selection),
  );
}

/** Order policy dimensions from most to least important. @internal */
export function orderRepresentationPolicies(
  policies: readonly ResolvedRepresentationPolicy[],
): readonly ResolvedRepresentationPolicy[] {
  return [...policies].sort(
    (left, right) =>
      right.priority - left.priority ||
      left.declarationOrder - right.declarationOrder,
  );
}

/** List legal rung indices after applying monotonic epoch floors. @internal */
export function representationRungOptions(
  policies: readonly ResolvedRepresentationPolicy[],
  floors: ReadonlyMap<string, number>,
): readonly (readonly number[])[] {
  return policies.map((policy) => {
    const floor = floors.get(policy.contributor) ?? 0;
    return Object.freeze(
      policy.rungs.flatMap((rung, index) =>
        index >= floor && rung.available ? [index] : [],
      ),
    );
  });
}

function enumerateSelections(
  policies: readonly ResolvedRepresentationPolicy[],
  floors: ReadonlyMap<string, number>,
  index: number,
  current: number[],
  out: number[][],
): void {
  if (index === policies.length) {
    out.push([...current]);
    return;
  }
  const policy = policies[index]!;
  const floor = floors.get(policy.contributor) ?? 0;
  for (let rung = floor; rung < policy.rungs.length; rung++) {
    if (!policy.rungs[rung]?.available) continue;
    current.push(rung);
    enumerateSelections(policies, floors, index + 1, current, out);
    current.pop();
  }
}

/** Materialize one complete legal candidate from a fidelity vector. @internal */
export function buildRequestCandidate<
  TExtra extends Record<string, unknown>,
>(
  original: CallArgs<TExtra>,
  policies: readonly ResolvedRepresentationPolicy[],
  fidelity: readonly number[],
): RequestCandidate<TExtra> {
  let request = original;
  const adaptations: RequestAdaptation[] = [];
  const selections = new Map<string, number>();
  const omittedPolicies: ResolvedRepresentationPolicy[] = [];
  for (let index = 0; index < policies.length; index++) {
    const policy = policies[index]!;
    const selected = fidelity[index] ?? 0;
    const rung = policy.rungs[selected]!;
    selections.set(policy.contributor, selected);
    if (selected === 0 || rung.kind === "full") continue;
    if (rung.kind === "omitted") omittedPolicies.push(policy);
    request = applyRung(request, policy, rung);
    adaptations.push({
      contributor: policy.contributor,
      representation: rung.kind,
      ...(rung.supportRequestId
        ? { supportRequestId: rung.supportRequestId }
        : {}),
      ...(rung.supportRequestIds
        ? { supportRequestIds: rung.supportRequestIds }
        : {}),
    });
  }
  request = applySkillProjection(request, omittedPolicies);
  return Object.freeze({
    request,
    fidelity: Object.freeze([...fidelity]),
    adaptations: Object.freeze(adaptations),
    selections,
  });
}

/**
 * Build a conservative branch lower bound by omitting every undecided policy.
 *
 * This hypothetical request is never selectable or dispatched. It only proves
 * that a branch cannot fit when its fixed content alone exceeds the limit.
 *
 * @internal
 */
export function buildRequestBranchLowerBound<
  TExtra extends Record<string, unknown>,
>(
  original: CallArgs<TExtra>,
  policies: readonly ResolvedRepresentationPolicy[],
  prefix: readonly number[],
): CallArgs<TExtra> {
  let request = original;
  const omittedPolicies: ResolvedRepresentationPolicy[] = [];
  for (let index = 0; index < policies.length; index++) {
    const policy = policies[index]!;
    const selected = prefix[index];
    const rung = selected === undefined
      ? {
          kind: "omitted" as const,
          available: true,
          ...(policy.lowerBoundMessages
            ? { messages: policy.lowerBoundMessages }
            : {}),
        }
      : policy.rungs[selected]!;
    if (selected === 0 && rung.kind === "full") continue;
    if (rung.kind === "omitted") omittedPolicies.push(policy);
    request = applyRung(request, policy, rung);
  }
  return applySkillProjection(request, omittedPolicies);
}

function applyRung<
  TExtra extends Record<string, unknown>,
>(
  request: CallArgs<TExtra>,
  policy: ResolvedRepresentationPolicy,
  rung: ResolvedRepresentationPolicy["rungs"][number],
): CallArgs<TExtra> {
  const omitted = rung.kind === "omitted";
  const replacement = omitted ? "" : (rung.text ?? "");
  const systemBlocks = request.systemBlocks?.flatMap((block) => {
    const omissionEdit = omitted
      ? policy.omissionEdits.find((edit) => edit.source === block.source)
      : undefined;
    if (omissionEdit) {
      return omissionEdit.replacement
        ? [{ ...block, text: omissionEdit.replacement }]
        : [];
    }
    if (!policy.sources.includes(block.source)) return [block];
    if (omitted) return [];
    return [{ ...block, text: replacement }];
  });
  let system = systemBlocks
    ? systemBlocks.map((block) => block.text).join("\n\n")
    : (request.system ?? "");
  if (!systemBlocks) {
    policy.fullTexts.forEach((fullText, index) => {
      system = replaceJoinedPart(
        system,
        fullText,
        index === 0 ? replacement : "",
      );
    });
    if (omitted) {
      for (const edit of policy.omissionEdits) {
        system = replaceJoinedPart(
          system,
          edit.fullText,
          edit.replacement,
        );
      }
    }
  }
  const messages = rung.messages
    ? [...rung.messages]
    : !systemBlocks && !request.system
      ? replaceFoldedSystem(
          request.messages,
          policy.fullTexts,
          replacement,
          omitted ? policy.omissionEdits : [],
        )
      : request.messages;
  const tools =
    omitted && policy.ownedToolNames.length > 0
      ? request.tools?.filter(
          (tool) => !policy.ownedToolNames.includes(tool.name),
        )
      : request.tools;
  return {
    ...request,
    messages,
    ...(request.system !== undefined || systemBlocks
      ? { system }
      : {}),
    ...(systemBlocks ? { systemBlocks } : {}),
    ...(tools ? { tools } : {}),
  };
}

function replaceFoldedSystem(
  messages: CallArgs<Record<string, unknown>>["messages"],
  fullTexts: readonly string[],
  replacement: string,
  omissionEdits: ResolvedRepresentationPolicy["omissionEdits"],
): CallArgs<Record<string, unknown>>["messages"] {
  let replaced = false;
  return messages.map((message) => {
    if (
      replaced ||
      message.role !== "system" ||
      typeof message.content !== "string"
    ) {
      return message;
    }
    let content = message.content;
    for (let index = 0; index < fullTexts.length; index++) {
      const fullText = fullTexts[index]!;
      if (!content.includes(fullText)) continue;
      content = replaceJoinedPart(
        content,
        fullText,
        index === 0 ? replacement : "",
      );
      replaced = true;
    }
    for (const edit of omissionEdits) {
      content = replaceJoinedPart(
        content,
        edit.fullText,
        edit.replacement,
      );
    }
    return content === message.content ? message : { ...message, content };
  });
}

function replaceOnce(
  value: string,
  search: string,
  replacement: string,
): string {
  if (!search) return value;
  const index = value.indexOf(search);
  if (index < 0) return value;
  const before = value.slice(0, index);
  const after = value.slice(index + search.length);
  return `${before}${replacement}${after}`;
}

function replaceJoinedPart(
  value: string,
  search: string,
  replacement: string,
): string {
  if (!search) return value;
  if (replacement) return replaceOnce(value, search, replacement);
  const index = value.indexOf(search);
  if (index < 0) return value;
  const end = index + search.length;
  if (value.slice(end, end + 2) === "\n\n") {
    return `${value.slice(0, index)}${value.slice(end + 2)}`;
  }
  if (value.slice(Math.max(0, index - 2), index) === "\n\n") {
    return `${value.slice(0, index - 2)}${value.slice(end)}`;
  }
  return `${value.slice(0, index)}${value.slice(end)}`;
}
