/** Construct the Agent executor exposed by a loop-owned adapter runtime. */

import type { AnyPrompt } from "../../prompt/prompt-types";
import { agentRoutingContext } from "../../agent/routing-context";
import type { AgentExecutor } from "../../agent/executor";
import { getExecutionContext } from "../../runtime/execution-context";
import { mergeInputBudget } from "../../request/budget/input-budget";
import {
  managedGenerationCheckpoint,
  managedGenerationStepBoundary,
} from "../../generation-model/execution-checkpoint";
import type {
  ExecutorGenerateOptions,
  ExecutorGenerateResult,
} from "../executor-contracts";

/** Build the provider-neutral Agent bridge over the adapter's generate call. */
export function createLoopAgentExecutor<TModel, TRawResponse>(
  generate: (
    prompt: AnyPrompt,
    options: ExecutorGenerateOptions<TModel>,
  ) => Promise<ExecutorGenerateResult<TRawResponse>>,
): AgentExecutor {
  return async (agent, options) => {
    const model = (agent.model ?? options.model) as TModel;
    const start = Date.now();
    const mergedTools = { ...(agent.tools ?? {}), ...(options.tools ?? {}) };
    const generateOptions = {
      model,
      input: options.input as Record<string, unknown>,
      routing: agentRoutingContext(agent, getExecutionContext()),
      maxSteps: options.maxSteps,
      validationRetry: options.validationRetry,
      inputBudget: mergeInputBudget(agent.inputBudget, options.inputBudget),
      prepareStep: options.prepareStep ?? agent.prepareStep,
      activeTools: options.activeTools,
      signal: options.signal,
      projectStepMessages: options.projectStepMessages,
      [managedGenerationCheckpoint]: options[managedGenerationCheckpoint],
      [managedGenerationStepBoundary]: options[managedGenerationStepBoundary],
      ...(Object.keys(mergedTools).length > 0 ? { tools: mergedTools } : {}),
    } as unknown as ExecutorGenerateOptions<TModel>;
    const result = await generate(agent.prompt, generateOptions);

    return {
      agentId: agent.id,
      output: result.object ?? result.text,
      durationMs: Date.now() - start,
      usage: result._meta.usage,
      requests: Object.freeze(
        result.steps.flatMap((step) => (step.request ? [step.request] : [])),
      ),
      ...(result.threadCommit ? { threadCommit: result.threadCommit } : {}),
    };
  };
}
