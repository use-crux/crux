/**
 * Swarm composition — peer-to-peer agent routing via LLM-decided tool calls.
 *
 * Enables a network of agents where each agent can "hand off" control to
 * another agent by calling a `transfer_to_<id>` tool. The swarm loop
 * continues until an agent completes without handing off or `maxHandoffs`
 * is reached.
 *
 * @module
 */

import { z } from "zod";
import type {
  Agent,
  AnyAgent,
  InferAgentInput,
  InferAgentOutput,
} from "./agent";
import type { AgentExecutor, AgentResult } from "./executor";
import { createCompositionRuntime } from "./composition-runtime";
import type { CompositionScope } from "./composition-runtime";
import type { GenerateTextFn } from "../compaction/types";
import { observe } from "../observability";
import type { CruxSpanId } from "../observability";
import type { RetryOptions } from "../generation/retry";
import {
  sumUsageWhenComplete,
  type ResultStepFacts,
} from "../adapter/result-accumulator";

// ── Types ───────────────────────────────────────────────────────────

/** Context passed to the custom history function. */
export interface SwarmHandoffContext {
  /** The original input to the swarm. */
  originalInput: unknown;
  /** Output of the agent that initiated the handoff. */
  previousOutput: unknown;
  /** Full handoff path so far (including the target). */
  handoffPath: string[];
  /** The agent that initiated the handoff. */
  fromAgent: string;
  /** The agent receiving the handoff. */
  toAgent: string;
  /** The LLM's stated reason for the handoff. */
  reason: string;
  /** Additional context from the handoff. */
  context: string;
}

/** Event emitted for each handoff via the `onHandoff` callback. */
export interface SwarmHandoffEvent {
  /** Agent that initiated the handoff. */
  fromAgent: string;
  /** Agent receiving the handoff. */
  toAgent: string;
  /** LLM's stated reason for the handoff. */
  reason: string;
  /** Additional context from the handoff. */
  context: string;
  /** 1-based hop number. */
  hopNumber: number;
}

/** Options for `swarm()`. */
export interface SwarmOptions<
  TAgents extends Record<string, AnyAgent> = Record<string, AnyAgent>,
  TStart extends Extract<keyof TAgents, string> = Extract<
    keyof TAgents,
    string
  >,
> {
  /** Named map of agents in the swarm. Keys must match agent IDs. */
  agents: TAgents;
  /** ID of the agent that starts the swarm. */
  startAgent: TStart;
  /** Input data passed to the first agent — typed from the start agent's prompt. */
  input: InferAgentInput<TAgents[TStart]>;
  /** Shared model (agent-level model takes precedence). */
  model?: unknown;
  /**
   * Maximum number of handoffs before aborting.
   * @default 10
   */
  maxHandoffs?: number;
  /**
   * Maximum tool-use steps per agent turn.
   * @default 5
   */
  maxSteps?: number;
  /**
   * Validation-feedback retry for structured output.
   * Applied to all agents unless overridden at agent level.
   */
  validationRetry?: import("../generation/validation-retry").ValidationRetryOptions;
  /**
   * How to build input for the next agent after a handoff.
   *
   * - `'transfer-only'` (default): original input + handoff context
   * - `'accumulate'`: original input + previous output + handoff path
   * - Custom function: receives full context, returns input for next agent
   */
  history?:
    | "transfer-only"
    | "accumulate"
    | ((ctx: SwarmHandoffContext) => unknown);
  /** Called for each handoff. */
  onHandoff?: (event: SwarmHandoffEvent) => void;
  /** Session ID for grouping related composition runs in devtools. */
  sessionId?: string;
  /** Execution retry/fallback applied to each agent turn. */
  retry?: RetryOptions;
  /**
   * Per-agent tool whitelist. Overrides `swarmTools` on the agent config.
   * Only listed tool names are passed to the executor. Transfer tools
   * are always included regardless.
   *
   * @example
   * ```ts
   * await swarm({
   *   activeTools: {
   *     billing: ['lookupInvoice', 'processPayment'],
   *     shipping: ['trackShipment'],
   *   },
   * })
   * ```
   */
  activeTools?: { [K in Extract<keyof TAgents, string>]?: string[] };
  /**
   * Called after each agent execution with accumulated cost/usage totals.
   * Use `abort()` to stop the swarm early.
   *
   * @example
   * ```ts
   * await swarm({
   *   onCost: ({ totalTokens, abort }) => {
   *     if (totalTokens > 10000) abort()
   *   },
   * })
   * ```
   */
  onCost?: (info: SwarmCostInfo) => void;
  /**
   * When true, return cost estimates without executing any agents.
   */
  dryRun?: boolean;
  /**
   * Summarize accumulated context between handoffs to prevent token bloat.
   * Only applies when `history` is `'accumulate'`.
   *
   * @example
   * ```ts
   * await swarm({
   *   history: 'accumulate',
   *   summarize: {
   *     generate: generateTextFn,
   *     model: gpt4mini,
   *     after: 3,
   *   },
   * })
   * ```
   */
  summarize?: {
    /** Text generation function (from your SDK adapter). */
    generate: GenerateTextFn;
    /** Model to use for summarization (typically a cheap/fast model). */
    model: unknown;
    /** Start summarizing after this many handoffs. @default 1 */
    after?: number;
    /** System prompt for the summarizer. */
    system?: string;
  };
}

/** Result of a swarm run. */
export interface SwarmResult<
  TAgents extends Record<string, AnyAgent> = Record<string, AnyAgent>,
> {
  /** The final agent's output — union of every possible agent output. */
  output: InferAgentOutput<TAgents[Extract<keyof TAgents, string>]>;
  /** ID of the agent that produced the final output. */
  finalAgentId: Extract<keyof TAgents, string>;
  /** Full handoff path in execution order. */
  handoffPath: Extract<keyof TAgents, string>[];
  /** Number of handoffs that occurred. */
  handoffCount: number;
  /** Total duration in milliseconds. */
  durationMs: number;
  /** Per-agent results in execution order. */
  agentResults: AgentResult[];
  /** Dry run: number of agents in the swarm. */
  agentCount?: number;
  /** Dry run: maximum possible handoffs. */
  maxPossibleHops?: number;
}

/** Cost info passed to the `onCost` callback. */
export interface SwarmCostInfo {
  /** Accumulated input tokens across all agents so far. */
  inputTokens: number;
  /** Accumulated output tokens across all agents so far. */
  outputTokens: number;
  /** Accumulated total tokens across all agents so far. */
  totalTokens: number;
  /** Stop the swarm after this agent. */
  abort: () => void;
}

/** Error thrown when maxHandoffs is exceeded. */
export class SwarmError extends Error {
  constructor(
    message: string,
    public readonly handoffPath: string[],
    public readonly maxHandoffs: number,
  ) {
    super(message);
    this.name = "SwarmError";
  }
}

/** A transfer tool injected into swarm agents for handoff routing. */
export interface TransferTool {
  description: string;
  parameters: z.ZodObject<{ reason: z.ZodString; context: z.ZodString }>;
  execute: (args: { reason: string; context: string }) => Promise<string>;
}

/** Build transfer tools for an agent's declared handoff targets. */
export function buildTransferTools(
  agent: AnyAgent,
  agentsMap: Record<string, AnyAgent>,
  onTransfer: (target: string, reason: string, context: string) => void,
): Record<string, TransferTool> {
  const tools: Record<string, TransferTool> = {};

  for (const handoff of agent.handoffs) {
    const targetId = handoff.id;
    if (targetId === agent.id) continue; // skip self
    const target = agentsMap[targetId];
    if (!target) continue; // validated separately

    // Build description: base + optional 'when' condition
    let description = target.description
      ? `Hand off to ${targetId}: ${target.description}`
      : `Hand off to the ${targetId} agent.`;
    if (handoff.when) {
      description += ` Use when: ${handoff.when}`;
    }

    tools[`transfer_to_${targetId}`] = {
      description,
      parameters: z.object({
        reason: z.string().describe("Why this handoff is happening"),
        context: z.string().describe("What the next agent needs to know"),
      }),
      execute: async (args: { reason: string; context: string }) => {
        onTransfer(targetId, args.reason, args.context);
        return `Handoff initiated to ${targetId}.`;
      },
    };
  }

  return tools;
}

const DEFAULT_SUMMARIZE_SYSTEM =
  "Summarize the following agent output concisely, preserving key facts and decisions. The summary will be passed to the next agent as context.";

/** Build input for the next agent based on history mode. */
async function buildNextInput(
  history: SwarmOptions["history"],
  ctx: SwarmHandoffContext,
  summarizeConfig?: SwarmOptions["summarize"],
  handoffCount?: number,
): Promise<unknown> {
  if (typeof history === "function") {
    return history(ctx);
  }

  if (history === "accumulate") {
    let previousOutput = ctx.previousOutput;

    // Summarize if configured and past threshold
    if (summarizeConfig && handoffCount != null) {
      const threshold = summarizeConfig.after ?? 1;
      if (handoffCount >= threshold) {
        const result = await summarizeConfig.generate({
          model: summarizeConfig.model,
          system: summarizeConfig.system ?? DEFAULT_SUMMARIZE_SYSTEM,
          prompt:
            typeof previousOutput === "string"
              ? previousOutput
              : JSON.stringify(previousOutput, null, 2),
        });
        previousOutput = result.text;
      }
    }

    const base =
      typeof ctx.originalInput === "object" && ctx.originalInput !== null
        ? { ...(ctx.originalInput as Record<string, unknown>) }
        : { _originalInput: ctx.originalInput };
    return {
      ...base,
      _previousOutput: previousOutput,
      _handoffPath: ctx.handoffPath,
      _handoff: {
        fromAgent: ctx.fromAgent,
        toAgent: ctx.toAgent,
        reason: ctx.reason,
        context: ctx.context,
      },
    };
  }

  // Default: transfer-only
  const base =
    typeof ctx.originalInput === "object" && ctx.originalInput !== null
      ? { ...(ctx.originalInput as Record<string, unknown>) }
      : { _originalInput: ctx.originalInput };
  return {
    ...base,
    _handoff: {
      fromAgent: ctx.fromAgent,
      toAgent: ctx.toAgent,
      reason: ctx.reason,
      context: ctx.context,
    },
  };
}

// ── Validation ──────────────────────────────────────────────────────

function validateSwarmConfig(options: SwarmOptions): void {
  const { agents, startAgent } = options;

  if (!agents[startAgent]) {
    throw new Error(
      `swarm: startAgent "${startAgent}" not found in agents map. ` +
        `Available agents: ${Object.keys(agents).join(", ")}`,
    );
  }

  for (const [id, agent] of Object.entries(agents)) {
    for (const handoff of agent.handoffs) {
      const targetId = handoff.id;
      if (!agents[targetId]) {
        throw new Error(
          `swarm: agent "${id}" declares handoff to "${targetId}", ` +
            `but "${targetId}" is not in the agents map. ` +
            `Available agents: ${Object.keys(agents).join(", ")}`,
        );
      }
    }
  }
}

// ── Factory ─────────────────────────────────────────────────────────

/**
 * Create a `swarm()` function bound to an executor.
 *
 * @param executor - SDK-specific agent executor.
 * @returns A `swarm()` function.
 *
 * @example
 * ```ts
 * import { createSwarm } from '@use-crux/core/agent'
 *
 * const swarm = createSwarm(executor)
 * const result = await swarm({
 *   agents: { triage: triageAgent, billing: billingAgent },
 *   startAgent: 'triage',
 *   input: { message: 'I was charged twice' },
 *   model,
 * })
 * ```
 */
export function createSwarm(executor: AgentExecutor) {
  /**
   * Run a swarm of agents with peer-to-peer routing via tool calls.
   *
   * Each agent receives `transfer_to_<id>` tools for its declared handoff
   * targets. The LLM decides when to hand off by calling these tools. The
   * loop continues until an agent completes without handing off or
   * `maxHandoffs` is reached.
   *
   * @param options - Swarm execution options.
   * @returns The final agent's result with full handoff metadata.
   *
   * @example
   * ```ts
   * const result = await swarm({
   *   agents: {
   *     triage: agent({ id: 'triage', prompt: triagePrompt, handoffs: ['billing'] }),
   *     billing: agent({ id: 'billing', prompt: billingPrompt, handoffs: ['triage'] }),
   *   },
   *   startAgent: 'triage',
   *   input: { message: 'I need help with my bill' },
   *   model: openai('gpt-4o'),
   * })
   * // result.handoffPath: ['triage', 'billing']
   * // result.output: 'Your billing issue has been resolved.'
   * ```
   */
  return async function swarm<
    const TAgents extends Record<string, AnyAgent>,
    TStart extends Extract<keyof TAgents, string>,
  >(options: SwarmOptions<TAgents, TStart>): Promise<SwarmResult<TAgents>> {
    const {
      agents,
      startAgent,
      input: originalInput,
      model,
      maxHandoffs = 10,
      maxSteps = 5,
      history = "transfer-only",
      onHandoff,
      sessionId,
      retry,
      summarize,
      onCost,
      dryRun,
      validationRetry,
    } = options;

    // Validate
    validateSwarmConfig(options);

    type SwarmAgentKey = Extract<keyof TAgents, string>;
    type SwarmOutput = InferAgentOutput<TAgents[SwarmAgentKey]>;

    // Dry run: return estimates without executing
    if (dryRun) {
      return {
        output: null as SwarmOutput,
        finalAgentId: startAgent,
        handoffPath: [startAgent],
        handoffCount: 0,
        durationMs: 0,
        agentResults: [],
        agentCount: Object.keys(agents).length,
        maxPossibleHops: maxHandoffs,
      };
    }

    const start = Date.now();
    const agentIds = Object.keys(agents);
    const runtime = createCompositionRuntime({
      kind: "swarm",
      agentIds,
      sessionId,
      attributes: { startAgent, maxHandoffs },
    });
    const handoffPath: SwarmAgentKey[] = [startAgent];
    const agentResults: AgentResult[] = [];
    const meteredAgentFacts: ResultStepFacts[] = [];
    let aborted = false;
    let currentAgentId: SwarmAgentKey = startAgent;
    let currentInput: unknown = originalInput;
    let handoffCount = 0;
    let agentIndex = 0;
    let previousAgentId: string | undefined;
    let previousHandoffReason: string | undefined;
    let previousHandoffSpanId: CruxSpanId | undefined;

    return runtime.run(async (scope) => {
      // Main loop
      while (true) {
        const agent = agents[currentAgentId];

        // Build transfer tools from agent's handoffs
        let pendingHandoff: {
          target: string;
          reason: string;
          context: string;
        } | null = null;
        const transferTools = buildTransferTools(
          agent,
          agents,
          (target, reason, context) => {
            pendingHandoff = { target, reason, context };
          },
        );

        // Build merged tools: filtered agent tools + transfer tools
        const allowedToolNames =
          options.activeTools?.[currentAgentId] ??
          (agent.swarmTools as readonly string[] | undefined);
        const agentTools = (agent.tools ?? {}) as Record<string, unknown>;
        let mergedTools: Record<string, unknown>;
        if (allowedToolNames) {
          // Filter: only include allowed agent tools
          const filteredAgentTools: Record<string, unknown> = {};
          for (const name of allowedToolNames) {
            if (agentTools[name]) {
              filteredAgentTools[name] = agentTools[name];
            }
          }
          mergedTools = { ...filteredAgentTools, ...transferTools };
        } else {
          // No filtering: include all agent tools + transfer tools
          mergedTools = { ...agentTools, ...transferTools };
        }

        let result: AgentResult;
        const attributes = {
          ...(previousAgentId ? { handoffFrom: previousAgentId } : {}),
          ...(previousHandoffReason
            ? { handoffReason: previousHandoffReason }
            : {}),
          ...(handoffCount > 0 ? { hopNumber: handoffCount } : {}),
        };
        try {
          result = await scope.executeAgent({
            agent,
            executor,
            label: currentAgentId,
            index: agentIndex,
            input: currentInput,
            model,
            tools: mergedTools,
            maxSteps,
            retry,
            validationRetry,
            attributes,
            stepId: `${runtime.compositionId}-${currentAgentId}-${agentIndex}`,
            ...(previousHandoffSpanId
              ? {
                  triggeredBy: {
                    spanId: previousHandoffSpanId,
                    attributes: {
                      fromAgent: previousAgentId ?? "",
                      toAgent: currentAgentId,
                    },
                  },
                }
              : {}),
          });
          previousHandoffSpanId = undefined;
        } catch (err) {
          throw err;
        }
        agentResults.push(result);

        // Accumulate metered agent usage and call onCost.
        if (result.usage) {
          meteredAgentFacts.push({
            content: [],
            usage: result.usage,
            finishReason: undefined,
            responseId: undefined,
            modelId: undefined,
          });
        }
        if (onCost) {
          const accumulatedUsage = sumUsageWhenComplete(meteredAgentFacts) ?? {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            inputTokenDetails: {},
            outputTokenDetails: {},
          };
          onCost({
            inputTokens: accumulatedUsage.inputTokens,
            outputTokens: accumulatedUsage.outputTokens,
            totalTokens: accumulatedUsage.totalTokens,
            abort: () => {
              aborted = true;
            },
          });
        }

        agentIndex++;

        // Check if aborted via onCost
        if (aborted) {
          const durationMs = Date.now() - start;
          reportSwarmComposition(scope, {
            compositionId: runtime.compositionId,
            durationMs,
            handoffPath: [...handoffPath],
            handoffCount,
            finalAgentId: currentAgentId,
            agentResults,
            agentIds,
          });
          return {
            output: result.output as SwarmOutput,
            finalAgentId: currentAgentId as SwarmAgentKey,
            handoffPath,
            handoffCount,
            durationMs,
            agentResults,
          };
        }

        // Check if a handoff occurred
        // (pendingHandoff is set by the transfer tool's execute closure — TypeScript
        // can't narrow closure-captured let variables, so we use a non-null assertion)
        if (pendingHandoff !== null) {
          const handoff = pendingHandoff as {
            target: string;
            reason: string;
            context: string;
          };
          handoffCount++;

          // Check maxHandoffs
          const handoffTarget = handoff.target as SwarmAgentKey;
          if (handoffCount >= maxHandoffs) {
            handoffPath.push(handoffTarget);

            throw new SwarmError(
              `swarm: maxHandoffs (${maxHandoffs}) reached. ` +
                `Path: ${handoffPath.join(" → ")}`,
              handoffPath,
              maxHandoffs,
            );
          }

          // Emit onHandoff callback
          onHandoff?.({
            fromAgent: currentAgentId,
            toAgent: handoffTarget,
            reason: handoff.reason,
            context: handoff.context,
            hopNumber: handoffCount,
          });
          await observe.span(
            {
              name: `${currentAgentId} -> ${handoffTarget}`,
              primitive: "handoff.prepare",
              attributes: {
                compositionId: runtime.compositionId,
                fromAgent: currentAgentId,
                toAgent: handoffTarget,
                reason: handoff.reason,
                hopNumber: handoffCount,
              },
            },
            async () => {
              const handoffInput = {
                fromAgent: currentAgentId,
                toAgent: handoffTarget,
                reason: handoff.reason,
                context: handoff.context,
                hopNumber: handoffCount,
              };
              const inputArtifactId = observe.artifact({
                kind: "input",
                contentType: "application/json",
                encoding: "json",
                preview: handoffInput,
                attributes: {
                  compositionId: runtime.compositionId,
                  hopNumber: handoffCount,
                  role: "handoff.input",
                },
              });
              const artifactId = observe.artifact({
                kind: "handoff.payload",
                contentType: "application/json",
                encoding: "json",
                preview: {
                  kind: "handoff.payload",
                  ...handoffInput,
                  hop: handoffCount,
                  beforeSize: jsonSize(result.output),
                  afterSize: jsonSize(handoffInput),
                },
                attributes: {
                  compositionId: runtime.compositionId,
                  hopNumber: handoffCount,
                },
              });
              const observedContext = observe.captureContext();
              if (observedContext?.currentSpanId) {
                previousHandoffSpanId = observedContext.currentSpanId;
                if (inputArtifactId) {
                  observe.edge({
                    edgeType: "consumed",
                    from: { kind: "artifact", id: inputArtifactId },
                    to: { kind: "span", id: observedContext.currentSpanId },
                    attributes: {
                      fromAgent: currentAgentId,
                      toAgent: handoffTarget,
                    },
                  });
                }
                if (artifactId) {
                  observe.edge({
                    edgeType: "handoff.payload",
                    from: { kind: "span", id: observedContext.currentSpanId },
                    to: { kind: "artifact", id: artifactId },
                    attributes: {
                      fromAgent: currentAgentId,
                      toAgent: handoffTarget,
                    },
                  });
                }
              }
            },
          );

          // Build input for next agent
          handoffPath.push(handoffTarget);
          previousAgentId = currentAgentId;
          previousHandoffReason = handoff.reason;
          currentInput = await buildNextInput(
            history,
            {
              originalInput,
              previousOutput: result.output,
              handoffPath: [...handoffPath],
              fromAgent: currentAgentId,
              toAgent: handoffTarget,
              reason: handoff.reason,
              context: handoff.context,
            },
            summarize,
            handoffCount,
          );
          currentAgentId = handoffTarget;
          continue;
        }

        // No handoff — we're done
        const durationMs = Date.now() - start;

        reportSwarmComposition(scope, {
          compositionId: runtime.compositionId,
          durationMs,
          handoffPath: [...handoffPath],
          handoffCount,
          finalAgentId: currentAgentId,
          agentResults,
          agentIds,
        });

        return {
          output: result.output as SwarmOutput,
          finalAgentId: currentAgentId as SwarmAgentKey,
          handoffPath,
          handoffCount,
          durationMs,
          agentResults,
        };
      }
    });
  };
}

function jsonSize(value: unknown): number {
  return JSON.stringify(value)?.length ?? 0;
}

function reportSwarmComposition(
  scope: CompositionScope,
  args: {
    compositionId: string;
    durationMs: number;
    handoffPath: readonly string[];
    handoffCount: number;
    finalAgentId: string;
    agentResults: readonly AgentResult[];
    agentIds: readonly string[];
  },
): void {
  scope.report({
    preview: {
      kind: "composition.report",
      compositionType: "swarm",
      compositionId: args.compositionId,
      status: "success",
      handoffPath: args.handoffPath,
      handoffCount: args.handoffCount,
      finalAgentId: args.finalAgentId,
      wallTimeMs: args.durationMs,
      roster: args.agentIds.map((id) => ({
        id,
        turns: args.agentResults.filter((result) => result.agentId === id)
          .length,
        durationMs: args.agentResults
          .filter((result) => result.agentId === id)
          .reduce((total, result) => total + result.durationMs, 0),
      })),
    },
    attributes: {
      primitive: "composition.swarm",
      compositionId: args.compositionId,
      handoffCount: args.handoffCount,
      finalAgentId: args.finalAgentId,
    },
  });
}
