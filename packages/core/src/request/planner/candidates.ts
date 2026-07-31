/**
 * Complete-request candidates compiled from resolved representation policy.
 *
 * @module
 */

import type { CallArgs } from "../../adapter/types";
import type { RequestAdaptation } from "../receipt/adaptations";
import type { ResolvedRepresentationPolicy } from "../representation/ladder-types";
import { applySkillProjection } from "./skill-projection";
import { applyRepresentationRung } from "./apply-representation";

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
  const selectedRungs: ResolvedRepresentationPolicy["rungs"][number][] = [];
  for (let index = 0; index < policies.length; index++) {
    const policy = policies[index]!;
    const selected = fidelity[index] ?? 0;
    const rung = policy.rungs[selected]!;
    selectedRungs.push(rung);
    selections.set(policy.contributor, selected);
    if (rung.kind === "full") continue;
    if (rung.kind === "omitted") omittedPolicies.push(policy);
    request = applyRepresentationRung(request, policy, rung);
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
  request = applySupportToolProjection(request, policies, selectedRungs);
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
  const selectedRungs: ResolvedRepresentationPolicy["rungs"][number][] = [];
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
    if (rung.kind === "full") continue;
    selectedRungs.push(rung);
    if (rung.kind === "omitted") omittedPolicies.push(policy);
    request = applyRepresentationRung(request, policy, rung);
  }
  request = applySkillProjection(request, omittedPolicies);
  return applySupportToolProjection(request, policies, selectedRungs);
}

function applySupportToolProjection<
  TExtra extends Record<string, unknown>,
>(
  request: CallArgs<TExtra>,
  policies: readonly ResolvedRepresentationPolicy[],
  selectedRungs: readonly ResolvedRepresentationPolicy["rungs"][number][],
): CallArgs<TExtra> {
  const supportNames = new Set(
    policies.flatMap((policy) => policy.supportToolNames ?? []),
  );
  if (supportNames.size === 0) return request;
  const retain = selectedRungs.some((rung) => rung.kind === "offload");
  return {
    ...request,
    tools: retain
      ? request.tools
      : request.tools?.filter((tool) => !supportNames.has(tool.name)),
  };
}
