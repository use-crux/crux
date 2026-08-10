/**
 * Bind backgroundable child Agents into provider Tools.
 *
 * @internal
 * @module
 */

import type { AnyModel, AnyToolSet } from "../types";
import type { ToolExecutionOptions } from "../types/tool";
import type { ProcessLocalAgentWorkController } from "../work/internal/agent-work-controller";
import type { InternalWorkOwnerPort } from "../work/internal/owner-retained-work";
import { isBackgroundableAgent } from "./backgroundable";
import { bindBackgroundToolInput } from "./background-tool-input";
import type { AgentExecutor } from "./executor";
import type { ForegroundChildWorkPort } from "./foreground-tool-binder";

interface BindBackgroundAgentToolsOptions {
  readonly executor: AgentExecutor;
  readonly model: AnyModel;
  readonly work: InternalWorkOwnerPort;
  /** Runs a child Tool invocation within its parent's Work. */
  readonly foregroundWork: ForegroundChildWorkPort;
  /** Shared Agent Work controller for occurrence identity and steering. */
  readonly agentWork: ProcessLocalAgentWorkController;
  /** Parent Agent identity used as the owner partition for occurrences. */
  readonly ownerId: string;
}

/**
 * Bind marked Agents without changing ordinary Tool entries.
 *
 * @throws {TypeError} If a backgroundable Agent input uses a reserved field.
 */
export function bindBackgroundAgentTools(
  tools: AnyToolSet,
  options: BindBackgroundAgentToolsOptions,
): AnyToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, value]) => {
      if (!isBackgroundableAgent(value)) {
        return [name, value];
      }

      const agent = value.agent;
      const description = agent.description ?? agent.prompt.description;
      if (!description) {
        throw new TypeError(
          `Backgroundable Agent tool "${name}" requires an Agent or Prompt description.`,
        );
      }
      const inputSchema = agent.prompt.inputSchema ?? agent.prompt.config.input;
      const input = bindBackgroundToolInput(inputSchema, name);

      return [
        name,
        Object.freeze({
          description,
          parameters: input.schema,
          async execute(toolInput: unknown, execution: ToolExecutionOptions) {
            const { input: businessInput, runInBackground } = input.bind(
              toolInput,
            );
            const occurrence = Object.freeze({
              ownerId: options.ownerId,
              turnId: "",
              toolCallId: execution.toolCallId,
              bindingKey: name,
            });

            const agentHandle = await options.agentWork.spawnAgent(
              agent,
              businessInput,
              {
                executor: options.executor,
                model: options.model,
                occurrence,
                targetLabel: name,
                spawn: execution.abortSignal
                  ? {
                      kind: "cancellation-only",
                      signal: execution.abortSignal,
                      effectParent: "independent",
                    }
                  : {
                      kind: "cancellation-only",
                      effectParent: "independent",
                    },
              },
            );

            if (!runInBackground) {
              return await agentHandle.result();
            }

            const internal = options.agentWork.getInternal(agentHandle.id);
            if (internal && !options.work.lookup(agentHandle.id)) {
              options.work.retainExisting(internal, {
                targetId: agent.id,
                targetLabel: name,
              });
            }

            return Object.freeze({
              kind: "work.ref" as const,
              id: agentHandle.id,
              targetId: agent.id,
              guarantees: Object.freeze({
                execution: "process-local" as const,
                rejoin: "process-local" as const,
              }),
            });
          },
        }),
      ];
    }),
  );
}
