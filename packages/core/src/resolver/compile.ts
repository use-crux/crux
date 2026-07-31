/**
 * Prompt compiler entrypoint — the single public boundary over `resolver/`.
 *
 * `compilePrompt()` validates the config and binds resolver ports once, then
 * hands a {@link PromptResolverPlan} the per-call work. `resolve()` and
 * `inspect()` are thin projections over that one plan, so prompt instances and
 * adapters reach resolution only through this boundary — they never import the
 * plan, pass, lower, or driver internals directly.
 *
 * @module
 */

import type { AnyPromptConfig } from '../prompt/prompt-types'
import {
  assertValidRepresentationLadders,
  assertUniqueStaticEntryIds,
  emitStaticContextDefinitionWarnings,
} from './definition-analysis'
import { validatePromptConfig } from './pass'
import { createPromptResolverPlan } from './plan'
import { withDefaultResolverPorts } from './ports'
import type { CompilePromptOptions, PromptResolutionPipeline, ResolveCallOptions } from './compiler-types'

export type {
  CompiledPrompt,
  CompilePromptOptions,
  PromptResolution,
  PromptResolutionPipeline,
  Resolution,
  ResolveCallOptions,
} from './compiler-types'

/**
 * Compile a prompt config into the single public resolution boundary.
 *
 * Definition-time work happens once: config validation, input-schema merging,
 * conflict detection, and resolver port binding. Each call to `resolve()` or
 * `inspect()` then runs one ordered pass and returns the requested projection
 * over the same pass result.
 */
export function compilePrompt(config: AnyPromptConfig, options?: CompilePromptOptions): PromptResolutionPipeline {
  validatePromptConfig(config)
  assertValidRepresentationLadders(config.use ?? [])
  assertUniqueStaticEntryIds(config.use ?? [], config.id)

  const ports = withDefaultResolverPorts(options?.ports)
  emitStaticContextDefinitionWarnings(config.use ?? [], ports.diagnostics)
  const plan = createPromptResolverPlan(config, ports)

  return Object.freeze({
    inputSchema: plan.inputSchema,

    async resolve(opts: ResolveCallOptions = {}) {
      const pass = await plan.run(opts, 'resolve')
      return Object.freeze({
        args: pass.args,
        inspect: () => pass.inspection,
      })
    },

    async inspect(opts: ResolveCallOptions = {}) {
      return (await plan.run(opts, 'inspect')).inspection
    },
  })
}
