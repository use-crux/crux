import type { z } from 'zod'
import type { AnyToolSet } from '../types'
import type { ContextEntry } from './context-types'
import type { Prompt, PromptConfig, PrepareHookArgs } from './prompt-types'
import type { ResolveOptions, ResolvedPrompt } from '../resolver/types'
import { compilePrompt, type ResolveCallOptions } from '../resolver/compile'
import { captureSource } from '../project-index/source'

/** Module-scoped map: frozen prompt → definition-site source location. */
const definitionSourceMap = new WeakMap<object, { file: string; line: number; column?: number }>()

/** Retrieve the definition-site source location for a prompt instance. */
export function getPromptDefinitionSource(prompt: object): { file: string; line: number; column?: number } | undefined {
  return definitionSourceMap.get(prompt)
}

/**
 * Define a typed, composable, SDK-agnostic prompt.
 *
 * This is the primary API for creating prompts. It returns a frozen `Prompt`
 * instance with `.resolve()`. Execution and observational preview are handled
 * by adapter functions (`generate()`, `stream()`) from adapter subpaths.
 *
 * **Key behaviors:**
 * - `use` merges context input schemas into the prompt's input type
 * - `output` presence determines structured vs text mode for adapters
 * - Input schemas are merged and conflicts detected at definition time
 * - `system + prompt` and `messages` are mutually exclusive (runtime error if both)
 *
 * @example
 * ```ts
 * import { prompt, context } from '@use-crux/core'
 * import { generate } from '@use-crux/ai'
 *
 * const editDraft = prompt({
 *   id: 'draft-edit',
 *   use: [proseMirror, brand],
 *   input: z.object({ instruction: z.string() }),
 *   output: EditSchema,
 *   system: 'You are an expert editor.',
 *   prompt: ({ input }) => input.instruction,
 * })
 *
 * // Execute with any adapter:
 * const result = await generate(editDraft, { model, input: { ... } })
 *
 * // Or resolve manually for any SDK:
 * const resolved = editDraft.resolve({ input: { ... }, provider: 'openai' })
 * ```
 */
export function prompt<
  TOwnInput extends z.ZodType = z.ZodType<{}>,
  TOutput extends z.ZodType | undefined = undefined,
  const TContexts extends readonly ContextEntry[] = readonly [],
  const TTools extends AnyToolSet | undefined = undefined,
>(config: PromptConfig<TOwnInput, TOutput, TContexts, TTools>): Prompt<TOwnInput, TOutput, TContexts, TTools> {
  // Capture call-site for devtools source map resolution (one stack trace per prompt, at module load)
  const defSource = captureSource()

  const contexts = (config.use ?? []) as TContexts

  const compiled = compilePrompt(config)

  const prompt: Prompt<TOwnInput, TOutput, TContexts, TTools> = Object.freeze({
    _tag: 'Prompt' as const,
    id: config.id,
    description: config.description,
    tags: Object.freeze(config.tags ?? []) as readonly string[],
    contexts,
    inputSchema: compiled.inputSchema,
    outputSchema: config.output as TOutput,
    hasOutput: (config.output !== undefined) as TOutput extends z.ZodType ? true : false,
    config: config as PromptConfig<TOwnInput, TOutput, TContexts, TTools>,

    async resolve(opts: ResolveOptions<TOwnInput, TContexts>): Promise<ResolvedPrompt> {
      const pass = await compiled.resolve(opts as ResolveCallOptions)

      // Fire onPrepare hook
      if (config.hooks?.onPrepare) {
        const readInspection = pass.inspect
        const inspection = readInspection()
        const hookArgs: PrepareHookArgs = {
          promptId: config.id,
          system: pass.args.system,
          prompt: pass.args.prompt,
          systemTokens: inspection.system.totalTokens,
          droppedContexts: inspection.droppedContexts,
        }
        config.hooks.onPrepare(hookArgs)
      }

      return pass.args
    },
  })

  // Store definition-site source in WeakMap (frozen objects can't have properties added)
  if (defSource) definitionSourceMap.set(prompt, defSource)

  return prompt
}
