import { createTool as convexCreateTool } from '@convex-dev/agent'
import type { AnyToolSet } from '@use-crux/core'
import type { z } from 'zod'
import {
  getConvexCruxRuntime,
  runWithConvexCruxRuntime,
  type ConvexCruxRuntime,
  type ConvexRuntimeTarget,
} from '../runtime'
import { augmentCruxContext } from '../server'
import { isRecord, stringValue } from './lifecycle-utils'
import { markObservedToolCall, observeConvexToolExecution } from './sdk-tool-observability'

const CRUX_WRAPPED_TOOL = Symbol.for('@use-crux/convex.wrappedTool')
const CRUX_TOOL_NAME = Symbol.for('@use-crux/convex.toolName')

interface CruxToolDef {
  description?: string
  parameters: z.ZodType
  execute: (args: Record<string, unknown>) => Promise<unknown> | unknown
}

/** User-authored Convex Agent tool map accepted by Crux wrappers. */
export type ToolRecord = Record<string, unknown>

/** Tool object returned by Convex Agent's `createTool()`. */
export type ConvexAgentTool = ReturnType<typeof convexCreateTool>

/** Invocation metadata Convex Agent passes to tool handlers. */
export type ConvexAgentToolOptions = { toolCallId?: string }

/**
 * Wrap every tool in a Convex Agent tool map with Crux span propagation.
 *
 * The object keys become readable trace labels while Convex Agent's original
 * tool objects and call signatures remain intact.
 */
export function wrapToolRecord<TTools extends ToolRecord | undefined>(tools: TTools): TTools {
  if (!tools) return tools
  const wrapped: ToolRecord = {}
  for (const [name, tool] of Object.entries(tools)) {
    wrapped[name] = wrapConvexTool(tool, { name })
  }
  return wrapped as TTools
}

/**
 * Convert prompt-resolved tools to Convex Agent `createTool()` objects.
 *
 * Normal Crux `ToolDef` objects are adapted. Existing Convex Agent tools are
 * accepted as an interop path and wrapped for the same canonical tool spans.
 */
export function convexTools(tools: AnyToolSet | undefined): Record<string, ConvexAgentTool> {
  const result: Record<string, ConvexAgentTool> = {}
  if (!tools) return result

  for (const [name, tool] of Object.entries(tools)) {
    if (isCruxToolDef(tool)) {
      result[name] = createConvexToolFromCruxTool(name, tool)
      continue
    }
    if (isConvexAgentTool(tool)) {
      result[name] = wrapConvexTool(tool, { name })
      continue
    }

    throw new Error(
      `Cannot convert tool "${name}" to a Convex Agent tool: expected a Crux ToolDef or Convex Agent tool.`,
    )
  }

  return result
}

/**
 * Create a Convex Agent tool with Crux observability installed.
 *
 * This mirrors `@convex-dev/agent`'s `createTool()` API. The returned tool keeps
 * the upstream call signature while recording a canonical `tool.call` span when
 * Convex Agent invokes it with a `toolCallId`.
 */
export const createTool: typeof convexCreateTool = ((definition: Parameters<typeof convexCreateTool>[0]) => {
  const name = typeof definition.title === 'string' && definition.title.trim() ? definition.title : undefined
  return wrapConvexTool(convexCreateTool(definition), { name })
}) as typeof convexCreateTool

/**
 * Wrap a `createTool()`-produced Convex Agent tool with span
 * propagation. Use this when a tool is authored directly against
 * `@convex-dev/agent` (not via {@link convexTools}) but you still
 * want nested boundaries (`delegate`, `flow`, etc.) inside its
 * handler to nest under the tool's span in the trace tree.
 *
 * The wrapped tool's `execute` reads `options.toolCallId` supplied by Convex
 * Agent at invocation time and pushes the matching canonical `tool.call` span
 * for the duration of the user handler.
 */
export function wrapConvexTool<T>(tool: T, wrapOptions: { name?: string } = {}): T {
  const target = tool as unknown as { execute?: ToolOuterExecute }
  const meta = target as { [CRUX_WRAPPED_TOOL]?: boolean; [CRUX_TOOL_NAME]?: string }
  if (wrapOptions.name) {
    meta[CRUX_TOOL_NAME] = wrapOptions.name
  }
  if (meta[CRUX_WRAPPED_TOOL]) return tool
  const innerExecute = target.execute
  if (typeof innerExecute !== 'function') return tool
  target.execute = function (this: unknown, input: unknown, options) {
    const toolCallId = options?.toolCallId
    const toolName = meta[CRUX_TOOL_NAME] ?? readToolName(this) ?? readToolName(tool) ?? toolCallId
    const toolThis = withCruxToolContext(this)
    if (!toolCallId) {
      return innerExecute.call(toolThis, input, options)
    }
    markObservedToolCall(toolCallId)
    return observeConvexToolExecution(toolName, toolCallId, input, () => innerExecute.call(toolThis, input, options))
  }
  meta[CRUX_WRAPPED_TOOL] = true
  return tool
}

function createConvexToolFromCruxTool(name: string, tool: CruxToolDef): ConvexAgentTool {
  const capturedRuntime = getConvexCruxRuntime()
  const convexTool = convexCreateTool({
    description: tool.description,
    inputSchema: tool.parameters,
    execute: async (toolCtx, args, options?: ConvexAgentToolOptions): Promise<unknown> => {
      const toolCallId =
        stringValue(options?.toolCallId) ?? stringValue((toolCtx as { toolCallId?: unknown })?.toolCallId)
      if (!toolCallId) {
        return executeCruxToolWithRuntime(tool, args as Record<string, unknown>, capturedRuntime)
      }
      markObservedToolCall(toolCallId)
      return await observeConvexToolExecution(name, toolCallId, args, async () => {
        return await executeCruxToolWithRuntime(tool, args as Record<string, unknown>, capturedRuntime, toolCallId)
      })
    },
  })
  const meta = convexTool as unknown as { [CRUX_WRAPPED_TOOL]?: boolean; [CRUX_TOOL_NAME]?: string }
  meta[CRUX_WRAPPED_TOOL] = true
  meta[CRUX_TOOL_NAME] = name
  return convexTool
}

function executeCruxToolWithRuntime(
  tool: CruxToolDef,
  args: Record<string, unknown>,
  capturedRuntime: ConvexCruxRuntime<unknown, ConvexRuntimeTarget> | undefined,
  toolCallId?: string,
): Promise<unknown> | unknown {
  const runtime = getConvexCruxRuntime() ?? capturedRuntime
  if (!runtime) return tool.execute(args)
  return runWithConvexCruxRuntime(
    {
      ...runtime,
      ...(toolCallId
        ? {
            target: {
              ...(runtime.target ?? {}),
              toolCallId,
            },
          }
        : {}),
    },
    () => tool.execute(args),
  )
}

function isCruxToolDef(value: unknown): value is CruxToolDef {
  return isRecord(value) && 'parameters' in value && 'execute' in value && typeof value.execute === 'function'
}

function isConvexAgentTool(value: unknown): value is ConvexAgentTool {
  return isRecord(value) && 'inputSchema' in value && 'execute' in value && typeof value.execute === 'function'
}

// The Convex Agent createTool() wraps the user's execute in an outer function
// whose AI SDK signature is (input, options) with `this` bound to the tool
// object. Preserve both the signature and `this` binding when wrapping.
type ToolOuterExecute = (this: unknown, input: unknown, options: { toolCallId?: string } | undefined) => unknown
type ConvexToolThis = { ctx?: object }

function withCruxToolContext(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  const toolThis = value as ConvexToolThis
  if (!toolThis.ctx || typeof toolThis.ctx !== 'object') return value
  return {
    ...toolThis,
    ctx: augmentCruxContext(toolThis.ctx as never),
  }
}

function readToolName(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  for (const key of ['name', 'toolName', 'id']) {
    const candidate = record[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate
  }
  return undefined
}
