/**
 * Bind backgroundable child Agents into provider Tools.
 *
 * @internal
 * @module
 */

import type { AnyModel, AnyToolSet } from "../types";
import type { ToolExecutionOptions } from "../types/tool";
import type { ProcessLocalAgentWorkController } from "../work/internal/agent-work-controller";
import { resolveAgentToolTurnId } from "../work/internal/agent-occurrence";
import type { InternalWorkOwnerPort } from "../work/internal/owner-retained-work";
import { isBackgroundableAgent } from "./backgroundable";
import { bindBackgroundToolInput } from "./background-tool-input";
import type { AgentExecutor } from "./executor";

interface BindBackgroundAgentToolsOptions {
  readonly executor: AgentExecutor;
  readonly model: AnyModel;
  readonly work: InternalWorkOwnerPort;
  /** Shared Agent Work controller for occurrence identity and steering. */
  readonly agentWork: ProcessLocalAgentWorkController;
  /** Per-parent-execution owner identity for occurrence partitioning. */
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
              turnId: resolveAgentToolTurnId(execution),
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
