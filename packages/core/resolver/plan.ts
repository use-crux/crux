/**
 * The prompt resolver plan — the single private pass primitive.
 *
 * `createPromptResolverPlan()` binds a validated prompt config to its merged
 * input schema and resolver ports once, then runs one ordered pass per call.
 * `run(opts, mode)` is the only door to resolution: the public `resolve()` and
 * `inspect()` on `compilePrompt()` are thin projections over it. Centralizing
 * the bind-once / run-per-call split here keeps the `compile.ts` boundary to a
 * handful of lines and gives both projections one identical pass to share, so
 * resolve and inspect can never drift across ordering, gating, skills, budget,
 * or settings.
 *
 * @module
 */

import type { z } from 'zod'
import type { AnyPromptConfig } from '../prompt/prompt-types'
import { runPromptPass } from './pass'
import type { ResolverPorts } from './ports'
import { compileInputSchema } from './schema'
import type { ProjectionMode, PromptResolutionPass, ResolveCallOptions } from './compiler-types'

/**
 * A prompt config bound to its schema and ports, ready to run resolution passes.
 *
 * `inputSchema` is the merged own + context schema, computed once at bind time
 * (so `compilePrompt().inputSchema` is free). `run()` executes one ordered pass
 * and returns both the SDK-ready args and the inspect projection; the public
 * compiler surfaces whichever the caller asked for.
 */
export interface PromptResolverPlan {
  /** Merged input schema (own + context contributions), or undefined when no fields exist. */
  readonly inputSchema: z.ZodType | undefined
  /** Run one ordered pass in the given projection mode. */
  run(opts: ResolveCallOptions | undefined, mode: ProjectionMode): Promise<PromptResolutionPass>
}

/**
 * Bind a validated prompt config to its ports and merged input schema.
 *
 * Definition-time work (schema merge) happens once here; per-call work happens
 * in `run()`. `'resolve'` wraps the pass in the prompt-resolution observability
 * scope; `'inspect'` runs the identical pass quietly so debug inspection never
 * emits resolve spans or artifacts.
 *
 * The config must already be validated (see `validatePromptConfig`) — the
 * public `compilePrompt()` boundary validates before binding.
 */
export function createPromptResolverPlan(config: AnyPromptConfig, ports: ResolverPorts): PromptResolverPlan {
  const inputSchema = compileInputSchema(config.use ?? [], config.input)

  return {
    inputSchema,
    run(opts, mode) {
      const call = opts ?? {}
      if (mode === 'inspect') {
        return runPromptPass(config, call, inputSchema, ports, 'inspect')
      }
      return ports.observability.scope(
        {
          name: config.id ?? 'prompt.resolve',
          family: 'prompt',
          primitive: 'prompt.resolve',
          attributes: {
            promptId: config.id,
            contextEntryCount: (config.use ?? []).length,
            hasMessages: !!config.messages,
            hasOutput: !!config.output,
          },
        },
        () => runPromptPass(config, call, inputSchema, ports, 'resolve'),
      )
    },
  }
}
