/**
 * Provider-neutral amendments accepted at language preparation boundaries.
 *
 * @module
 */

import type {
  ContextEntry,
  MemoryEntry,
} from "../../prompt/context-types";
import type { AnyToolSet } from "../../types";
import type { InputBudget } from "../budget/input-budget";
import type { AnyPrompt } from "../../prompt/prompt-types";
import type { ResolvedPrompt } from "../../resolver/types";
import { prompt as definePrompt } from "../../prompt/prompt";
import { OFFLOAD_SUPPORT_TOOL_NAME } from "../offload/support-tool";
import type { HistoryProjection } from "../history/source";
import {
  applyUseAmendment,
  invalidAmendment,
} from "./contributor-selection";
import type { PreparationResources } from "./resources";
import { withPreparationResourcesInput } from "./pin-context";

/** A top-level contributor selected by object identity or an explicit unique id. */
export type ContributorSelector =
  | AmendableContextEntry
  | { readonly id: string };

/**
 * A contributor that preparation may add to a language request.
 *
 * Runtime validation rejects transcript ownership entries even when a value
 * reaches this surface through dynamic JavaScript.
 */
export type AmendableContextEntry = Exclude<
  ContextEntry,
  MemoryEntry | HistoryProjection | false | null | undefined
>;

/**
 * One boundary-local language execution delta.
 *
 * Amendments are validated and applied to one provider call. They never
 * replace canonical messages, output contracts, credentials, or raw provider
 * options.
 *
 * @example
 * ```ts
 * const amendment = {
 *   use: { add: [analysisContext] },
 *   activeTools: ['analyze'],
 *   inputBudget: { max: 32_000 },
 * } satisfies ExecutionAmendment
 * ```
 */
export interface ExecutionAmendment<TModel = unknown> {
  /** Add or remove top-level contributors for this provider call only. */
  readonly use?: {
    readonly add?: readonly AmendableContextEntry[];
    readonly remove?: readonly ContributorSelector[];
  };
  /** Exact Tool definitions contributed for this provider call only. */
  readonly tools?: AnyToolSet;
  /** Tool names exposed after the complete capability graph resolves. */
  readonly activeTools?: readonly string[];
  /** Compatible concrete model for this provider call. */
  readonly model?: TModel;
  /** Whole-request pressure settings for this provider call. */
  readonly inputBudget?: InputBudget;
}

/** Validated boundary-local execution values. @internal */
export interface ResolvedExecutionAmendment<TModel> {
  readonly resolved: ResolvedPrompt;
  readonly model: TModel;
  readonly inputBudget: InputBudget | undefined;
  readonly activeTools: readonly string[] | undefined;
}

/** Validate and resolve one non-accumulating amendment. @internal */
export async function resolveExecutionAmendment<TModel>(input: {
  readonly prompt: AnyPrompt;
  readonly resolveOptions: Parameters<AnyPrompt["resolve"]>[0];
  readonly baseline: ResolvedPrompt;
  readonly amendment: ExecutionAmendment<TModel> | undefined;
  readonly model: TModel;
  readonly inputBudget?: InputBudget;
  readonly baselineActiveTools?: readonly string[];
  readonly resources: PreparationResources;
}): Promise<ResolvedExecutionAmendment<TModel>> {
  const amendment = input.amendment;
  if (!amendment) {
    return Object.freeze({
      resolved: input.baseline,
      model: input.model,
      inputBudget: input.inputBudget,
      activeTools: input.baselineActiveTools,
    });
  }
  assertAmendmentObject(amendment);
  const entries = applyUseAmendment(input.prompt.contexts, amendment.use);
  let resolved =
    entries === input.prompt.contexts
      ? input.baseline
      : await resolveWithUse(
          input.prompt,
          input.resolveOptions,
          entries,
          input.resources,
        );
  if (amendment.tools) {
    const existing = resolved.tools ?? {};
    const names = Object.keys(amendment.tools);
    if (names.some((name) => name in existing)) {
      throw invalidAmendment(
        "Tool definitions contributed by preparation must have unique names.",
      );
    }
    resolved = {
      ...resolved,
      tools: Object.freeze({ ...existing, ...amendment.tools }),
    };
  }
  const availableTools = new Set(Object.keys(resolved.tools ?? {}));
  const activeTools = amendment.activeTools ?? input.baselineActiveTools;
  if (activeTools?.some((name) => !availableTools.has(name))) {
    throw invalidAmendment(
      "Every activeTools entry must name a Tool in the resolved boundary graph.",
    );
  }
  const retainedActiveTools =
    activeTools && availableTools.has(OFFLOAD_SUPPORT_TOOL_NAME)
      ? Object.freeze([
          ...activeTools,
          ...(activeTools.includes(OFFLOAD_SUPPORT_TOOL_NAME)
            ? []
            : [OFFLOAD_SUPPORT_TOOL_NAME]),
        ])
      : activeTools
        ? Object.freeze([...activeTools])
        : undefined;
  return Object.freeze({
    resolved,
    model: amendment.model ?? input.model,
    inputBudget: amendment.inputBudget ?? input.inputBudget,
    activeTools: retainedActiveTools,
  });
}

function assertAmendmentObject(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidAmendment("prepareStep must return an amendment object.");
  }
}

async function resolveWithUse(
  source: AnyPrompt,
  options: Parameters<AnyPrompt["resolve"]>[0],
  use: readonly ContextEntry[],
  resources: PreparationResources,
): Promise<ResolvedPrompt> {
  const amended = definePrompt({
    ...source.config,
    use,
  } as Parameters<typeof definePrompt>[0]);
  return amended.resolve(
    withPreparationResourcesInput(options, resources),
  );
}
