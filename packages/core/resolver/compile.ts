/**
 * Prompt compiler entrypoint — the single public boundary over `resolver/`.
 *
 * `compilePrompt()` performs definition-time validation/schema merging once,
 * binds resolver ports, then delegates each call to one prompt-resolution pass
 * with `args` and `inspect()` projections. Prompt instances and adapters reach
 * resolution only through this boundary; they never import the lower/driver
 * pass internals directly.
 *
 * @module
 */

import type { AnyPromptConfig } from '../prompt/prompt-types'
import { runPromptPass, runPromptResolvePass, validatePromptConfig } from './pass'
import { withDefaultResolverPorts } from './ports'
import { compileInputSchema } from './schema'
import type {
  CompiledPrompt,
  CompilePromptOptions,
  PromptResolution,
  PromptResolutionPass,
  ResolveCallOptions,
} from './compiler-types'

export type {
  CompiledPrompt,
  CompilePromptOptions,
  PromptResolution,
  Resolution,
  ResolveCallOptions,
} from './compiler-types'

function createResolution(pass: PromptResolutionPass): PromptResolution {
  const inspection = pass.inspection
  return Object.freeze({
    args: pass.args,
    inspect() {
      return inspection
    },
  })
}

/**
 * Compile a prompt config into the single public resolution boundary.
 *
 * Definition-time work happens once: config validation, input-schema merging,
 * conflict detection, and resolver port binding. Each call to `resolve()` or
 * `inspect()` then runs one pipeline pass and returns the requested projection.
 */
export function compilePrompt(config: AnyPromptConfig, options?: CompilePromptOptions): CompiledPrompt {
  validatePromptConfig(config)
  const inputSchema = compileInputSchema(config.use ?? [], config.input)
  const ports = withDefaultResolverPorts(options?.ports)

  return Object.freeze({
    inputSchema,
    async resolve(opts: ResolveCallOptions = {}) {
      const pass = await runPromptResolvePass(config, opts, inputSchema, ports)
      return createResolution(pass)
    },
    async inspect(opts: ResolveCallOptions = {}) {
      const pass = await runPromptPass(config, opts, inputSchema, ports, 'inspect')
      return pass.inspection
    },
  })
}
