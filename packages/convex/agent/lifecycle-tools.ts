import type { z } from 'zod'
import {
  getConvexCruxRuntime,
  runWithConvexCruxRuntime,
  type ConvexCruxRuntime,
  type ConvexRuntimeTarget,
} from '../runtime'
import type { ConvexAgentDriver, ConvexAgentToolOptions } from './driver'
import { isRecord, stringValue } from './lifecycle-utils'

interface CruxToolDef {
  readonly description?: string
  readonly parameters: z.ZodType
  execute(args: Record<string, unknown>): Promise<unknown> | unknown
}

/** Convert prompt-resolved and prepare-supplied tools through the active driver. */
export function toDriverToolRecord(
  driver: ConvexAgentDriver,
  tools: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  if (!tools) return result

  for (const [name, tool] of Object.entries(tools)) {
    result[name] = isCruxToolDef(tool)
      ? createDriverToolFromCruxTool(driver, name, tool)
      : driver.wrapTool(tool, { name })
  }

  return result
}

function createDriverToolFromCruxTool(driver: ConvexAgentDriver, name: string, tool: CruxToolDef): unknown {
  const capturedRuntime = getConvexCruxRuntime()
  return driver.createTool({
    name,
    description: tool.description,
    inputSchema: tool.parameters,
    execute: (_toolCtx, args, options) => executeCruxToolWithRuntime(tool, args, capturedRuntime, options),
  })
}

function executeCruxToolWithRuntime(
  tool: CruxToolDef,
  args: Record<string, unknown>,
  capturedRuntime: ConvexCruxRuntime<unknown, ConvexRuntimeTarget> | undefined,
  options?: ConvexAgentToolOptions,
): Promise<unknown> | unknown {
  const runtime = getConvexCruxRuntime() ?? capturedRuntime
  const toolCallId = stringValue(options?.toolCallId)
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
