/**
 * Bind direct child Agents into the ordinary provider Tool path.
 *
 * @internal
 * @module
 */

import type { AnyModel, AnyToolSet } from "../types";
import type { ToolExecutionOptions } from "../types/tool";
import { z } from "zod";
import { currentInternalWorkAttachment } from "../work/internal/attached-context";
import type { ProcessLocalWorkKernel } from "../work/internal/process-local-kernel";
import { isAgent } from "./agent";
import type { AgentExecutor } from "./executor";
import { observeForegroundAgentRun } from "./foreground-agent-observability";

/** Join handle for one accepted foreground child Work. @internal */
export interface ForegroundChildWork<TOutput> {
  /** Await and return the exact child execution result. */
  result(): Promise<TOutput>;
}

/** Narrow adapter-neutral port used to accept foreground child Work. @internal */
export interface ForegroundChildWorkPort {
  /** Accept one child execution linked to the caller's cancellation ancestry. */
  spawn<TOutput>(
    run: (signal: AbortSignal) => Promise<TOutput>,
    options: ForegroundChildWorkSpawnOptions,
  ): Promise<ForegroundChildWork<TOutput>>;
}

/** Linkage for an Agent tool's foreground child Work. @internal */
export interface ForegroundChildWorkSpawnOptions {
  readonly kind: "cancellation-only";
  readonly signal?: AbortSignal;
}

/** Bind foreground child acceptance to one adapter-local Work kernel. @internal */
export function createForegroundChildWorkPort(
  workKernel: ProcessLocalWorkKernel,
): ForegroundChildWorkPort {
  return Object.freeze({
    async spawn<TOutput>(
      run: (signal: AbortSignal) => Promise<TOutput>,
      options: ForegroundChildWorkSpawnOptions,
    ): Promise<ForegroundChildWork<TOutput>> {
      const ambient = currentInternalWorkAttachment();
      return workKernel.spawn<TOutput>(
        { run: ({ signal }: { readonly signal: AbortSignal }) => run(signal) },
        ambient ? { kind: "attached", attachment: ambient } : options,
      );
    },
  });
}

interface BindForegroundAgentToolsOptions {
  readonly executor: AgentExecutor;
  readonly model: AnyModel;
  readonly work: ForegroundChildWorkPort;
}

interface ForegroundToolInputBinding {
  readonly parameters: z.ZodType;
  toPromptInput(input: unknown): unknown;
}

/** Keep provider Tool arguments object-shaped without changing object prompts. */
function foregroundToolInputBinding(
  effectiveInputSchema: z.ZodType | undefined,
  authoredInputSchema: z.ZodType | undefined,
): ForegroundToolInputBinding {
  const inputSchema = effectiveInputSchema ?? authoredInputSchema;
  if (!inputSchema) {
    return Object.freeze({
      parameters: z.object({}),
      toPromptInput: (_input: unknown) => ({}),
    });
  }
  if (inputSchema instanceof z.ZodObject) {
    return Object.freeze({
      parameters: inputSchema,
      toPromptInput: (input: unknown) => input,
    });
  }
  return Object.freeze({
    parameters: z.object({ input: inputSchema }),
    toPromptInput: (input: unknown) => {
      if (typeof input !== "object" || input === null || !("input" in input)) {
        throw new TypeError("Foreground Agent tool wrapper input must contain \"input\".");
      }
      return input.input;
    },
  });
}

/** Replace direct Agent values with ordinary Tools without changing other entries. */
export function bindForegroundAgentTools(
  tools: AnyToolSet,
  options: BindForegroundAgentToolsOptions,
): AnyToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, value]) => {
      if (!isAgent(value)) return [name, value];

      const description = value.description ?? value.prompt.description;
      if (!description) {
        throw new TypeError(
          `Foreground Agent tool "${name}" requires an Agent or Prompt description.`,
        );
      }
      const inputBinding = foregroundToolInputBinding(
        value.prompt.inputSchema,
        value.prompt.config.input,
      );

      return [
        name,
        Object.freeze({
          description,
          parameters: inputBinding.parameters,
          async execute(toolInput: unknown, execution: ToolExecutionOptions) {
            const work = await options.work.spawn(
              (signal) =>
                observeForegroundAgentRun(value, () =>
                  options.executor(value, {
                    input: inputBinding.toPromptInput(toolInput),
                    model: options.model,
                    signal,
                  }),
                ),
              execution.abortSignal
                ? { kind: "cancellation-only", signal: execution.abortSignal }
                : { kind: "cancellation-only" },
            );
            return (await work.result()).output;
          },
        }),
      ];
    }),
  );
}
