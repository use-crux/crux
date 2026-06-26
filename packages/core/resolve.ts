/**
 * Prompt compiler entrypoint.
 *
 * `compilePrompt()` is the public boundary: it performs definition-time
 * validation/schema merging once, binds resolver ports, then delegates each
 * call to one prompt-resolution pass with `args` and `inspect()` projections.
 *
 * @module
 */

import type { AnyPromptConfig } from './types'
import { runPromptPass, runPromptResolvePass, validatePromptConfig } from './resolver/pass'
import { withDefaultResolverPorts } from './resolver/ports'
import { compileInputSchema } from './resolver/schema'
import type {
  CompiledPrompt,
  CompilePromptOptions,
  PromptResolution,
  PromptResolutionPass,
  ResolveCallOptions,
} from './resolver/compiler-types'

export type {
  CompiledPrompt,
  CompilePromptOptions,
  PromptResolution,
  Resolution,
  ResolveCallOptions,
} from './resolver/compiler-types'

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
