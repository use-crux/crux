/**
 * CruxEntity — universal interface for objects that inject themselves
 * into LLM conversations via context and/or tools.
 *
 * @module
 */

import type { z } from 'zod'
import type { Context } from './types'
import type { ToolDef } from './types/tool'

/**
 * Any entity that can inject itself into an LLM conversation
 * via context (system message) and/or tools.
 */
export interface CruxEntity {
  readonly id: string
  asContext(options?: { priority?: number }): Context<z.ZodType<{}>>
  asTools(): Record<string, ToolDef>
}

/**
 * Entity with query-driven context (episodic/semantic memory).
 */
export interface QueryableCruxEntity extends CruxEntity {
  asContext(options?: {
    priority?: number
    query?: string | ((input: Record<string, unknown>) => string)
  }): Context<z.ZodType<{}>>
}

/**
 * Merge tool definitions from multiple entities into a single tool set.
 * Throws if tool names collide.
 */
export function composeTools(...sources: Array<CruxEntity | Record<string, ToolDef>>): Record<string, ToolDef> {
  const merged: Record<string, ToolDef> = {}
  for (const source of sources) {
    const tools =
      'asTools' in source && typeof source.asTools === 'function'
        ? source.asTools()
        : (source as Record<string, ToolDef>)
    for (const [name, tool] of Object.entries(tools)) {
      if (merged[name]) {
        throw new Error(`Tool name collision: "${name}" is defined by multiple entities`)
      }
      merged[name] = tool
    }
  }
  return merged
}
