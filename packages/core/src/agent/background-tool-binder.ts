/**
 * Bind backgroundable child Agents into provider Tools.
 *
 * @internal
 * @module
 */

import { z } from "zod";
import type { AnyModel, AnyToolSet } from "../types";
import type { ToolExecutionOptions } from "../types/tool";
import type { InternalWorkOwnerPort } from "../work/internal/owner-retained-work";
import { isBackgroundableAgent } from "./backgroundable";
import type { AgentExecutor } from "./executor";

interface BindBackgroundAgentToolsOptions {
  readonly executor: AgentExecutor;
  readonly model: AnyModel;
  readonly work: InternalWorkOwnerPort;
}

/** Bind marked Agents without changing ordinary Tool entries. */
export function bindBackgroundAgentTools(
  tools: AnyToolSet,
  options: BindBackgroundAgentToolsOptions,
): AnyToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, value]) => {
      if (!isBackgroundableAgent(value)) return [name, value];

      const agent = value.agent;
      const description = agent.description ?? agent.prompt.description;
      if (!description) {
        throw new TypeError(
          `Backgroundable Agent tool "${name}" requires an Agent or Prompt description.`,
        );
      }
      const inputSchema = agent.prompt.inputSchema ?? agent.prompt.config.input;
      if (!(inputSchema instanceof z.ZodObject)) {
        return [name, value];
      }

      return [
        name,
        Object.freeze({
          description,
          parameters: inputSchema.extend({ run_in_background: z.boolean().optional() }),
          async execute(toolInput: unknown, execution: ToolExecutionOptions) {
            const input = toolInput as Record<string, unknown>;
            const { run_in_background: _background, ...businessInput } = input;
            const reference = await options.work.spawnAndRetain({
              run({ signal }: { readonly signal: AbortSignal }) {
                return options.executor(agent, {
                  input: businessInput,
                  model: options.model,
                  signal,
                }).then((result) => result.output);
              },
            }, execution.abortSignal
              ? {
                  kind: "cancellation-only",
                  signal: execution.abortSignal,
                  effectParent: "independent",
                }
              : { kind: "cancellation-only", effectParent: "independent" });
            return Object.freeze({
              kind: "work.ref" as const,
              id: reference.id,
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
