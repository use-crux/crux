/**
 * Type-level contract checks for the prompt compiler boundary.
 */

import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { compilePrompt, createResolverFakes, prompt } from '@use-crux/core'
import type {
  CompiledPrompt,
  InspectResult,
  PromptResolution,
  PromptResolutionPipeline,
  ResolveCallOptions,
  ResolvedPrompt,
} from '@use-crux/core'

const answer = prompt({
  id: 'typed-compiler-boundary',
  input: z.object({ question: z.string() }),
  system: 'Answer directly.',
  prompt: ({ input }) => input.question,
})

const compiled = compilePrompt(answer.config, { ports: createResolverFakes().ports })

// `PromptResolutionPipeline` is the canonical name; `CompiledPrompt` is its alias.
expectTypeOf(compiled).toEqualTypeOf<PromptResolutionPipeline>()
expectTypeOf(compiled).toEqualTypeOf<CompiledPrompt>()
expectTypeOf(compiled.inputSchema).toEqualTypeOf<z.ZodType | undefined>()

const resolveOptions = {
  input: { question: 'What is Crux?' },
  provider: 'openai',
  modelId: 'gpt-4.1',
  tokenBudget: 8_000,
  temperature: 0.2,
} satisfies ResolveCallOptions

const resolution = await compiled.resolve(resolveOptions)
expectTypeOf(resolution).toEqualTypeOf<PromptResolution>()
expectTypeOf(resolution.args).toEqualTypeOf<ResolvedPrompt>()
expectTypeOf(resolution.inspect()).toEqualTypeOf<InspectResult>()
