/**
 * Bind backgroundable child Agents into provider Tools.
 *
 * @internal
 * @module
 */

import type { AnyModel, AnyToolSet } from "../types";
import type { ToolExecutionOptions } from "../types/tool";
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
      if (!isBackgroundableAgent(value)) return [name, value];

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
            const { input: businessInput, runInBackground } = input.bind(toolInput);
            if (!runInBackground) {
              const handle = await options.foregroundWork.spawn(
                (signal: AbortSignal) =>
                  options.executor(agent, {
                    input: businessInput,
                    model: options.model,
                    signal,
                  }),
                execution.abortSignal
                  ? { kind: "cancellation-only", signal: execution.abortSignal }
                  : { kind: "cancellation-only" },
              );
              return (await handle.result()).output;
            }
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
