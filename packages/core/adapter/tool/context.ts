/**
 * Runtime validation for typed tool context.
 *
 * Tool context is declared per tool with `contextSchema` and supplied per run
 * through `toolsContext`. The lifecycle validates every declared dependency
 * before a provider step can execute tools, then stores the parsed values for
 * middleware and execute hooks.
 *
 * @module
 */

import type { z } from 'zod'

export type ResolvedToolsContext = Readonly<Record<string, unknown>>

interface ToolWithContextSchema {
  readonly contextSchema?: z.ZodType
}

function toolContextSchema(tool: unknown): z.ZodType | undefined {
  if (!tool || typeof tool !== 'object') return undefined
  const schema = (tool as ToolWithContextSchema).contextSchema
  return schema && typeof schema.safeParse === 'function' ? schema : undefined
}

/** Validate and parse `toolsContext` for the currently merged tool set. */
export function resolveToolsContext(
  tools: Record<string, unknown>,
  toolsContext: Readonly<Record<string, unknown>> | undefined,
): ResolvedToolsContext {
  const parsed: Record<string, unknown> = {}

  for (const key of Object.keys(toolsContext ?? {})) {
    const tool = tools[key]
    if (tool === undefined && !(key in tools)) {
      throw new Error(`toolsContext.${key} was provided, but no resolved tool named "${key}" exists.`)
    }
    if (!toolContextSchema(tool)) {
      throw new Error(`toolsContext.${key} was provided, but tool "${key}" does not declare contextSchema.`)
    }
  }

  for (const [toolName, tool] of Object.entries(tools)) {
    const schema = toolContextSchema(tool)
    if (!schema) continue

    if (!toolsContext || !(toolName in toolsContext)) {
      throw new Error(`Tool "${toolName}" requires toolsContext.${toolName} because it declares contextSchema.`)
    }

    const result = schema.safeParse(toolsContext[toolName])
    if (!result.success) {
      throw new Error(
        `Tool "${toolName}" toolsContext.${toolName} validation failed: ${JSON.stringify(result.error.issues)}`,
      )
    }
    parsed[toolName] = result.data
  }

  return parsed
}
