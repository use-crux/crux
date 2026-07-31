/**
 * Composition-boundary preparation for managed child invocations.
 *
 * @module
 */

import type { AnyAgent } from "../../agent/agent";
import type { ExecuteOptions } from "../../agent/executor";
import { prompt as definePrompt } from "../../prompt/prompt";
import type { AnyModel, AnyToolSet } from "../../types";
import {
  applyUseAmendment,
  invalidAmendment,
} from "./contributor-selection";
import type { ExecutionAmendment } from "./amendment";
import {
  createPreparationResources,
  ResourceReadError,
  type PreparationResources,
} from "./resources";
import { withPreparationResourcesInput } from "./pin-context";
import {
  assertApplicableContributorFacets,
  classifyLanguageContributors,
} from "../facets/applicability";
import {
  PreparationError,
} from "./step";
import type {
  InvocationContext,
  InvocationContextSeed,
  InvocationPreparationStats,
  InvocationTarget,
  PrepareInvocation,
} from "./invocation-context";

const PREPARATION_TIMEOUT_MS = 30_000;

export type {
  ConsensusInvocationContext,
  InvocationContext,
  InvocationPreparationStats,
  InvocationTarget,
  ParallelInvocationContext,
  PipelineInvocationContext,
  PrepareInvocation,
  SwarmInvocationContext,
} from "./invocation-context";

/** Mutable execution-local statistics behind invocation snapshots. @internal */
export interface PrepareInvocationState {
  cursor: number;
  succeeded: number;
  usageReports: number;
  inputTokens: number;
  outputTokens: number;
}

/** Create empty state for one composition activation. @internal */
export function createPrepareInvocationState(): PrepareInvocationState {
  return {
    cursor: 0,
    succeeded: 0,
    usageReports: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
}

/** Record one completed child outcome for later invocation snapshots. @internal */
export function recordPrepareInvocationOutcome(
  state: PrepareInvocationState,
  usage: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
  } | undefined,
): void {
  state.succeeded += 1;
  if (!usage) return;
  state.usageReports += 1;
  state.inputTokens += usage.inputTokens ?? 0;
  state.outputTokens += usage.outputTokens ?? 0;
}

/** Prepare one Agent and its executor options before child I/O. @internal */
export async function prepareInvocation<TOutput>(input: {
  readonly callback?: PrepareInvocation;
  readonly state: PrepareInvocationState;
  readonly seed: InvocationContextSeed;
  readonly agent: AnyAgent;
  readonly options: ExecuteOptions;
}): Promise<{ readonly agent: AnyAgent; readonly options: ExecuteOptions }> {
  if (!input.callback) return { agent: input.agent, options: input.options };
  assertApplicableContributorFacets(
    classifyLanguageContributors(input.agent.prompt.contexts),
  );
  const resources = createPreparationResources({
    entries: input.agent.prompt.contexts,
    requestInput: requestInput(input.options.input),
    promptId: input.agent.prompt.id,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PREPARATION_TIMEOUT_MS);
  const context = createInvocationContext({
    seed: input.seed,
    target: { id: input.agent.id, operation: "language" },
    stats: snapshotStats(input.state),
    resources,
    signal: controller.signal,
  });
  try {
    const amendment = await Promise.race([
      Promise.resolve()
        .then(() => input.callback!(context))
        .catch((error: unknown) => {
          if (
            error instanceof PreparationError ||
            error instanceof ResourceReadError
          ) {
            throw error;
          }
          throw new PreparationError("callback");
        }),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => reject(new PreparationError("timeout")),
          { once: true },
        );
      }),
    ]);
    const prepared = applyInvocationAmendment(
      input.agent,
      input.options,
      amendment,
    );
    const pinned = withPreparationResourcesInput(
      { input: prepared.options.input },
      resources,
    );
    return {
      agent: prepared.agent,
      options: Object.freeze({
        ...prepared.options,
        input: pinned.input,
      }),
    };
  } finally {
    clearTimeout(timer);
  }
}

function applyInvocationAmendment(
  agent: AnyAgent,
  options: ExecuteOptions,
  amendment: ExecutionAmendment<AnyModel, "language"> | undefined,
): { readonly agent: AnyAgent; readonly options: ExecuteOptions } {
  if (!amendment) return { agent, options };
  if (typeof amendment !== "object" || Array.isArray(amendment)) {
    throw invalidAmendment(
      "Preparation callbacks must return an amendment object.",
    );
  }
  const contexts = applyUseAmendment(agent.prompt.contexts, amendment.use);
  const tools = mergeTools(agent.tools, options.tools, amendment.tools);
  const availableTools = new Set([
    ...Object.keys(tools ?? {}),
    ...Object.keys(options.tools ?? {}),
  ]);
  if (
    amendment.activeTools?.some((name) => !availableTools.has(name))
  ) {
    throw invalidAmendment(
      "Every activeTools entry must name a Tool in the resolved boundary graph.",
    );
  }
  const preparedAgent = Object.freeze({
    ...agent,
    prompt:
      contexts === agent.prompt.contexts
        ? agent.prompt
        : definePrompt({
            ...agent.prompt.config,
            use: contexts,
          } as Parameters<typeof definePrompt>[0]),
    model: amendment.model ?? agent.model,
    tools,
    inputBudget: amendment.inputBudget ?? agent.inputBudget,
  }) as AnyAgent;
  return {
    agent: preparedAgent,
    options: Object.freeze({
      ...options,
      ...(amendment.activeTools
        ? { activeTools: Object.freeze([...amendment.activeTools]) }
        : {}),
    }),
  };
}

function mergeTools(
  agentTools: AnyToolSet | undefined,
  invocationTools: AnyToolSet | undefined,
  amendmentTools: AnyToolSet | undefined,
): AnyToolSet | undefined {
  const existing = { ...(agentTools ?? {}), ...(invocationTools ?? {}) };
  if (!amendmentTools) return agentTools;
  if (Object.keys(amendmentTools).some((name) => name in existing)) {
    throw invalidAmendment(
      "Tool definitions contributed by preparation must have unique names.",
    );
  }
  return Object.freeze({ ...(agentTools ?? {}), ...amendmentTools });
}

function createInvocationContext(input: {
  readonly seed: InvocationContextSeed;
  readonly target: InvocationTarget<"language">;
  readonly stats: InvocationPreparationStats;
  readonly resources: PreparationResources;
  readonly signal: AbortSignal;
}): InvocationContext {
  return freezePlain({
    ...input.seed,
    operation: "language",
    target: input.target,
    stats: input.stats,
    resources: input.resources,
    signal: input.signal,
  }) as InvocationContext;
}

function snapshotStats(
  state: PrepareInvocationState,
): InvocationPreparationStats {
  const cursor = state.cursor++;
  const coverage =
    state.succeeded === 0 || state.usageReports === 0
      ? "none"
      : state.succeeded === state.usageReports
        ? "complete"
        : "partial";
  const scope = Object.freeze({
    usage: Object.freeze({
      ...(coverage === "none"
        ? {}
        : {
            inputTokens: state.inputTokens,
            outputTokens: state.outputTokens,
            totalTokens: state.inputTokens + state.outputTokens,
          }),
      coverage: Object.freeze({ tokens: coverage, cost: "none" as const }),
    }),
    modelCalls: Object.freeze({
      started: cursor,
      succeeded: state.succeeded,
      failed: 0,
      cancelled: 0,
      transportRetries: 0,
    }),
  });
  return freezePlain({ at: new Date(), cursor, run: scope, root: scope });
}

function requestInput(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : Object.freeze({ _input: value });
}

function freezePlain<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => freezePlain(entry))) as T;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, freezePlain(entry)]),
    ),
  ) as T;
}
