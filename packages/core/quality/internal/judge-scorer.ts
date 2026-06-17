/**
 * Judge-backed scorer implementations — `scorers.judge` and the `rag.*`
 * family — built on `scoring/llmJudge` and bridged to the adapter
 * `GenerateFn` supplied by the evaluation runtime.
 *
 * The bridge constructs a minimal structured prompt per judge call and runs
 * it through the adapter generate, so judge calls travel the same
 * executor boundary as task calls (and therefore record/replay through the
 * same cassette).
 *
 * @internal
 * @module
 */

import { z } from 'zod'
import { llmJudge } from '../../scoring'
import type { JudgeInput, JudgeResult } from '../../scoring'
import { createGenerateObjectFnFromGenerate, type GenerateObjectFn } from '../../compaction'
import { canonicalJson } from './json'
import { resolveModelRef, type ScorerRunContext } from './scorer-runtime'
import { MissingQualityModelBindingError } from './errors'
import type { GenerateFn } from '../target'
import type { Score, ScorerArgs } from '../scorers'

/** Render any value as judge-readable text (strings pass through). */
export function asJudgeText(value: unknown): string {
  return typeof value === 'string' ? value : canonicalJson(value)
}

/**
 * Bridge the quality adapter `GenerateFn` to the `GenerateObjectFn` shape
 * `llmJudge` consumes. Kept as a quality-local wrapper so existing scorer
 * internals share the public compaction bridge while retaining the trace id
 * used by judge scorer cassettes.
 */
export function bridgeGenerateForJudge(generate: GenerateFn): GenerateObjectFn {
  return createGenerateObjectFnFromGenerate(generate, { promptId: 'crux.quality.judge' })
}

/** Explicit scorer runtime bindings for judge-backed model calls. */
export interface JudgeRuntimeBinding {
  generate?: GenerateFn
  model?: unknown
}

/** Resolve the judge runtime: explicit scorer options first, then runner context. */
export function resolveJudgeModel(
  explicit: JudgeRuntimeBinding,
  context: ScorerRunContext | undefined,
  what: string,
): { generate: GenerateFn; model: unknown } {
  const generate = explicit.generate ?? context?.generate
  if (typeof generate !== 'function') {
    throw new MissingQualityModelBindingError(
      `${what} needs an adapter generate fn — pass an explicit judge generate binding from the eval or an eval-local helper.`,
    )
  }
  const model = resolveModelRef(explicit.model ?? context?.judgeModel ?? context?.model, context)
  if (model === undefined) {
    throw new MissingQualityModelBindingError(`${what} needs a judge model — pass \`model\` from the eval or an eval-local helper.`)
  }
  return { generate, model }
}

/** Options the runtime judge implementation receives (post type-level validation). */
export interface JudgeRuntimeOptions {
  name: string
  rubric?: string
  choiceScores?: Record<string, number>
  generate?: GenerateFn
  model?: unknown
  useCoT?: boolean
  select?: (output: never) => string
}

/** Select the text a judge grades from the cell output. */
function selectOutputText(opts: JudgeRuntimeOptions, output: unknown): string {
  if (opts.select !== undefined) {
    const selected = opts.select(output as never)
    if (typeof selected !== 'string') {
      throw new TypeError(`scorers.judge('${opts.name}'): \`select\` must return a string.`)
    }
    return selected
  }
  if (typeof output === 'string') return output
  throw new TypeError(
    `scorers.judge('${opts.name}'): structured outputs need a \`select\` mapping the output to the judged text.`,
  )
}

const choiceDetail = (choices: readonly string[]) => z.object({ choice: z.enum(choices as [string, ...string[]]) })

/**
 * The contextual run implementation behind `scorers.judge()`. Rubric mode
 * grades free-form 0–1; `choiceScores` mode classifies into one of the
 * declared choices and maps it to its score (`label` carries the choice).
 * Chain-of-thought reasoning is on by default and lands in
 * `metadata.rationale`.
 */
export function runJudgeScorer(
  opts: JudgeRuntimeOptions,
  args: ScorerArgs<unknown, unknown, unknown>,
  context: ScorerRunContext | undefined,
): Promise<Score> {
  const outputText = selectOutputText(opts, args.output)
  const { generate, model } = resolveJudgeModel(
    { generate: opts.generate, model: opts.model },
    context,
    `scorers.judge('${opts.name}')`,
  )
  const judgeInput: JudgeInput = {
    input: asJudgeText(args.input),
    output: outputText,
    ...(args.expected !== undefined ? { reference: asJudgeText(args.expected) } : {}),
  }
  const scoreOptions = { generate: bridgeGenerateForJudge(generate), model }

  if (opts.choiceScores !== undefined) {
    const choices = Object.keys(opts.choiceScores)
    const judge = llmJudge({
      id: opts.name,
      criteria: [
        `Classify the output into exactly one of these categories: ${choices.join(', ')}.`,
        'Report the chosen category in the `detail.choice` field.',
        'The numeric score field is informational only; the category is what matters.',
      ].join('\n'),
      scale: { min: 0, max: 1 },
      chainOfThought: opts.useCoT ?? true,
      detailSchema: choiceDetail(choices),
    })
    return judge.score(judgeInput, scoreOptions).then((result) => {
      const choice = result.detail?.choice
      const mapped = choice !== undefined ? opts.choiceScores![choice] : undefined
      if (mapped === undefined) {
        throw new Error(`scorers.judge('${opts.name}'): judge returned unknown choice '${String(choice)}'.`)
      }
      return {
        name: opts.name,
        score: mapped,
        label: choice,
        metadata: { rationale: result.reasoning },
      }
    })
  }

  const judge = llmJudge({
    id: opts.name,
    criteria: opts.rubric!,
    scale: { min: 0, max: 1 },
    chainOfThought: opts.useCoT ?? true,
  })
  return judge.score(judgeInput, scoreOptions).then((result: JudgeResult) => ({
    name: opts.name,
    score: result.score,
    metadata: { rationale: result.reasoning },
  }))
}
