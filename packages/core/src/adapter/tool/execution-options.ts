/**
 * Tool execution option helpers shared by SDK-regime tool maps.
 *
 * Core-regime loops call tools directly from `session.ts`. SDK-regime loops
 * hand a tool map to a provider SDK, so the map needs a thin wrapper that
 * injects Crux-owned `context` and `runtimeContext` before user code runs.
 *
 * @module
 */

import { createToolRegistry } from '../../tools/tool-registry'

/** Canonical options passed to one tool execution. */
export interface ToolLifecycleExecutionOptions {
  readonly toolCallId: string
  readonly messages?: readonly unknown[]
  readonly context?: unknown
  readonly runtimeContext: unknown
  readonly abortSignal?: AbortSignal
}

/** Partial options accepted from SDK-owned tool-loop callbacks. */
export type PartialToolLifecycleExecutionOptions = Partial<ToolLifecycleExecutionOptions>

type ExecutionOptionsResolver = (
  toolName: string,
  rawOptions: PartialToolLifecycleExecutionOptions | undefined,
) => ToolLifecycleExecutionOptions

interface ToolWithExecute {
  readonly execute?: (
    input: unknown,
    options: ToolLifecycleExecutionOptions,
  ) => unknown
}

/**
 * Wrap SDK-regime tools so provider-owned loops receive the same execution
 * options that core-owned loops construct inside `executeRound()`.
 */
export function withToolLifecycleExecutionOptions(
  tools: Record<string, unknown>,
  resolveOptions: ExecutionOptionsResolver,
): Record<string, unknown> {
  const contextual = createToolRegistry<unknown>()
  for (const [toolName, tool] of Object.entries(tools)) {
    if (!tool || typeof tool !== 'object') {
      contextual[toolName] = tool
      continue
    }

    const shape = tool as ToolWithExecute
    if (typeof shape.execute !== 'function') {
      contextual[toolName] = tool
      continue
    }

    const execute = shape.execute as (
      this: unknown,
      input: unknown,
      options: ToolLifecycleExecutionOptions,
    ) => unknown
    contextual[toolName] = {
      ...tool,
      execute(this: unknown, input: unknown, rawOptions?: PartialToolLifecycleExecutionOptions) {
        return execute.call(this, input, resolveOptions(toolName, rawOptions))
      },
    }
  }
  return contextual
}
