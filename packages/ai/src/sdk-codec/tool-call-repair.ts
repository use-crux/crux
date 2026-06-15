import { InvalidToolInputError, NoSuchToolError } from 'ai'
import { z } from 'zod'
import type { LoopArgs } from './request-args'

/**
 * Internal reporter tool that turns tool-call resolution failures into the
 * same error-json tool result that core-driven adapters feed back to the
 * model. Never advertised to the provider.
 *
 * @internal
 */
export const TOOL_ERROR_REPORTER = '__crux_tool_error__'

const toolErrorReporter = {
  description: 'Internal Crux reporter for tool-call resolution errors. Never call this tool directly.',
  inputSchema: z.object({ error: z.string() }),
  execute: async ({ error }: { error: string }) => ({ error }),
  toModelOutput: ({ output }: { output: { error: string } }) => ({
    type: 'error-json' as const,
    value: { error: output.error },
  }),
}

/**
 * Wire AI SDK-native tool-call repair for hallucinated tool names and invalid
 * inputs. The model receives the same error-json tool result that core-driven
 * adapters use, giving it a chance to self-correct without leaking SDK error
 * classes through the public adapter surface.
 *
 * @internal
 */
export function withToolCallRepair(args: LoopArgs): void {
  const tools = args.tools as Record<string, unknown> | undefined
  if (!tools || Object.keys(tools).length === 0) return

  const callerToolNames = Object.keys(tools)
  args.tools = { ...tools, [TOOL_ERROR_REPORTER]: toolErrorReporter }
  // Keep the reporter invisible to the model: when the caller did not
  // restrict activeTools, restrict to their tools (same provider payload).
  if (args.activeTools === undefined) args.activeTools = callerToolNames

  args.experimental_repairToolCall = async ({
    toolCall,
    error,
  }: {
    toolCall: { toolCallId: string; toolName: string }
    error: unknown
  }) => {
    const message = NoSuchToolError.isInstance(error)
      ? `Tool "${error.toolName}" not found`
      : InvalidToolInputError.isInstance(error)
        ? error.message
        : undefined
    if (message === undefined) return null
    return {
      type: 'tool-call' as const,
      toolCallId: toolCall.toolCallId,
      toolName: TOOL_ERROR_REPORTER,
      input: JSON.stringify({ error: message }),
    }
  }
}
