/**
 * Colocated prompt-test lowering — Quality rung 0.
 *
 * `prompt({ tests: [{ name?, input, expected? }] })` lowers into an
 * Evaluation with id `prompt:<promptId>`: task = the bare prompt, no
 * scorers/gates (default policy), `source: 'prompt-tests'` in the manifest.
 * Cases are data-only (direction doc §18.5): the lowered evaluation-level
 * `expect` validates each output against the prompt's output schema and
 * `expected` is reported, never matched implicitly. The Phase 3 collector
 * calls this for every cataloged prompt that declares `tests`.
 *
 * @internal Not exported from `@use-crux/core/quality` — engine plumbing only.
 * @module
 */

import type { z } from 'zod'
import type { AnyPrompt } from '../../prompt/prompt-types'
import type { Evaluation } from '../evaluate'
import { createEvaluationInternal } from '../evaluate'
import type { CaseContext } from '../expect'
import type { Capability } from '../target'
import type { RawCase } from './definition'

/** Whether a prompt declares lowerable colocated tests. @internal */
export function hasPromptTests(candidate: AnyPrompt): boolean {
  return Array.isArray(candidate.config?.tests) && candidate.config.tests.length > 0
}

/**
 * Lower a prompt's colocated `tests` into a runnable Evaluation.
 *
 * @throws TypeError when the prompt has no id or declares no tests — both
 *   are collect-time definition errors.
 *
 * @internal
 */
export function lowerPromptTests(candidate: AnyPrompt): Evaluation {
  const tests = candidate.config?.tests
  if (!Array.isArray(tests) || tests.length === 0) {
    throw new TypeError('lowerPromptTests(): the prompt declares no `tests`.')
  }
  if (typeof candidate.id !== 'string' || candidate.id.trim() === '') {
    throw new TypeError('lowerPromptTests(): colocated tests need a prompt with an explicit `id`.')
  }

  const cases: RawCase[] = tests.map((test) => ({
    ...(typeof test.name === 'string' ? { name: test.name } : {}),
    input: test.input,
    ...(test.expected !== undefined ? { expected: test.expected } : {}),
  }))

  const outputSchema = candidate.outputSchema as z.ZodType | undefined

  // Default rung-0 policy: the output must satisfy the prompt's output
  // schema (text-mode prompts validate that the output is a string).
  const validateOutput = (ctx: CaseContext<unknown, unknown, unknown, Capability>): void => {
    if (outputSchema !== undefined) {
      ctx
        .expect(ctx.output)
        .toSatisfy(
          (output) => outputSchema.safeParse(output).success,
          'output does not satisfy the prompt output schema',
        )
    } else {
      ctx.expect(ctx.output).toBeTypeOf('string')
    }
  }

  return createEvaluationInternal({
    id: `prompt:${candidate.id}`,
    source: 'prompt-tests',
    options: {
      task: candidate,
      data: cases,
      expect: validateOutput,
    },
  })
}
