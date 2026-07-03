/**
 * LLM-as-a-judge factory.
 *
 * Creates reusable judge instances that score any input/output pair against
 * custom criteria using structured LLM output.
 *
 * @module
 */

import { z } from 'zod'
import type { JudgeConfig, JudgeInstance, JudgeInput, JudgeResult, JudgeScoreOptions } from './types'
import type { GenerateObjectFn } from '../compaction/types'
import { observe } from '../observability'
import { getRuntime } from '../runtime/runtime'

/** Schema for structured judge output. Reasoning comes first for chain-of-thought. */
const baseJudgeOutputSchema = z.object({
  reasoning: z.string(),
  score: z.number(),
})

/** Build the output schema, merging detailSchema if provided. */
function buildOutputSchema(config: JudgeConfig) {
  if (config.detailSchema) {
    return z.object({
      reasoning: z.string(),
      score: z.number(),
      detail: config.detailSchema,
    })
  }
  return baseJudgeOutputSchema
}

/**
 * Build the system prompt for a judge from its configuration.
 */
function buildSystemPrompt(config: JudgeConfig): string {
  const { criteria, scale, rubric, chainOfThought = true, fewShot, context: ctx } = config

  const parts: string[] = [
    'You are an expert evaluator. Your task is to score the given output against specific criteria.',
    '',
    `## Criteria`,
    criteria,
    '',
  ]

  if (ctx) {
    parts.push('## Context')
    parts.push(ctx)
    parts.push('')
  }

  parts.push(`## Scoring Scale`)
  parts.push(`Score from ${scale.min} (worst) to ${scale.max} (best).`)

  if (rubric) {
    parts.push('')
    parts.push('## Rubric')
    for (const [score, description] of Object.entries(rubric)) {
      parts.push(`- **${score}**: ${description}`)
    }
  }

  if (chainOfThought) {
    parts.push('')
    parts.push('## Instructions')
    parts.push('First explain your reasoning step by step, then provide your numeric score.')
    if (config.detailSchema) {
      parts.push(
        'Also provide structured details in the `detail` field with specific findings (e.g., issues found, patterns matched).',
      )
    }
  }

  if (fewShot?.length) {
    parts.push('')
    parts.push('## Examples')
    for (const example of fewShot) {
      parts.push('')
      parts.push(`Input: ${example.input}`)
      parts.push(`Output: ${example.output}`)
      parts.push(`Reasoning: ${example.reasoning}`)
      parts.push(`Score: ${example.score}`)
    }
  }

  return parts.join('\n')
}

/**
 * Build the user prompt for a single scoring call.
 */
function buildUserPrompt(input: JudgeInput): string {
  const parts: string[] = [`## Input`, input.input, '', `## Output to Evaluate`, input.output]

  if (input.reference) {
    parts.push('')
    parts.push('## Reference Answer')
    parts.push(input.reference)
  }

  return parts.join('\n')
}

/**
 * Create a reusable LLM judge.
 *
 * The judge evaluates input/output pairs against custom criteria using
 * structured LLM output. Supports rubrics, chain-of-thought reasoning,
 * and few-shot calibration examples.
 *
 * @param config - Judge configuration with criteria, scale, and optional rubric.
 * @returns A `JudgeInstance` with a `score()` method.
 */
export function llmJudge<TDetail = unknown>(config: JudgeConfig<TDetail>): JudgeInstance<TDetail> {
  const systemPrompt = buildSystemPrompt(config)
  const outputSchema = buildOutputSchema(config)

  async function score(input: JudgeInput, options?: JudgeScoreOptions): Promise<JudgeResult<TDetail>> {
    const generate = options?.generate ?? config.generate
    const model = options?.model ?? config.model

    if (!generate) {
      throw new Error(`Judge "${config.id}": no generate function provided. Pass it in config or score() options.`)
    }
    if (!model) {
      throw new Error(`Judge "${config.id}": no model provided. Pass it in config or score() options.`)
    }

    const userPrompt = buildUserPrompt(input)
    const span = observe.openSpan({
      name: `judge.${config.id}`,
      primitive: 'scoring.judge',
      attributes: {
        metricId: config.id,
        scaleMin: config.scale.min,
        scaleMax: config.scale.max,
        hasRubric: config.rubric !== undefined,
        hasFewShot: (config.fewShot?.length ?? 0) > 0,
        hasReference: input.reference !== undefined,
        hasDetailSchema: config.detailSchema !== undefined,
        chainOfThought: config.chainOfThought ?? true,
        model: modelLabel(model),
        ...(options?.evalId ? { evalId: options.evalId } : {}),
      },
    })

    try {
      const { object } = await span.withContext(() =>
        (generate as GenerateObjectFn)({
          model,
          system: systemPrompt,
          prompt: userPrompt,
          schema: outputSchema,
        }),
      )

      const rawScore = object.score
      const clampedScore = Math.max(config.scale.min, Math.min(config.scale.max, rawScore))
      const hasDetail = config.detailSchema !== undefined && 'detail' in object
      const result = {
        score: clampedScore,
        reasoning: object.reasoning,
        metricId: config.id,
        ...(hasDetail ? { detail: object.detail as TDetail } : {}),
      } satisfies JudgeResult<TDetail>

      span.withContext(() => {
        emitJudgeArtifact(span.spanId, {
          metricId: config.id,
          score: clampedScore,
          rawScore,
          reasoning: object.reasoning,
          scaleMin: config.scale.min,
          scaleMax: config.scale.max,
          hasDetail,
          evalId: options?.evalId,
        })
      })


      span.end({
        attributes: {
          metricId: config.id,
          score: clampedScore,
          rawScore,
          clamped: clampedScore !== rawScore,
          scaleMin: config.scale.min,
          scaleMax: config.scale.max,
          hasReasoning: object.reasoning.length > 0,
          hasDetail,
          ...(options?.evalId ? { evalId: options.evalId } : {}),
        },
      })
      return result
    } catch (error) {
      span.error(error, {
        metricId: config.id,
        scaleMin: config.scale.min,
        scaleMax: config.scale.max,
        ...(options?.evalId ? { evalId: options.evalId } : {}),
      })
      throw error
    }
  }

  return { id: config.id, score }
}

function emitJudgeArtifact(
  spanId: ReturnType<typeof observe.openSpan>['spanId'],
  result: {
    metricId: string
    score: number
    rawScore: number
    reasoning: string
    scaleMin: number
    scaleMax: number
    hasDetail: boolean
    evalId?: string
  },
): void {
  const artifactId = observe.artifact({
    kind: 'score.report',
    contentType: 'application/json',
    encoding: 'json',
    preview: {
      kind: 'score.report',
      verdict: result.score >= result.scaleMin ? 'pass' : 'fail',
      metricId: result.metricId,
      score: result.score,
      rawScore: result.rawScore,
      scaleMin: result.scaleMin,
      scaleMax: result.scaleMax,
      reasoningPreview: truncate(result.reasoning, 500),
      judges: [
        {
          name: result.metricId,
          score: result.score,
          threshold: result.scaleMin,
          status: result.score >= result.scaleMin ? 'passed' : 'failed',
          rationale: truncate(result.reasoning, 500),
        },
      ],
      hasDetail: result.hasDetail,
      evalId: result.evalId,
    },
    attributes: {
      primitive: 'scoring.judge',
      metricId: result.metricId,
      score: result.score,
      rawScore: result.rawScore,
      scaleMin: result.scaleMin,
      scaleMax: result.scaleMax,
      hasReasoning: result.reasoning.length > 0,
      hasDetail: result.hasDetail,
      ...(result.evalId ? { evalId: result.evalId } : {}),
    },
  })
  if (!artifactId) return
  observe.edge({
    edgeType: 'produced',
    from: { kind: 'span', id: spanId },
    to: { kind: 'artifact', id: artifactId },
    attributes: { primitive: 'scoring.judge', metricId: result.metricId },
  })
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value
}

function modelLabel(model: unknown): string {
  if (typeof model === 'string') return model
  if (model && typeof model === 'object') {
    const record = model as Record<string, unknown>
    if (typeof record.modelId === 'string') return record.modelId
    if (typeof record.id === 'string') return record.id
    if (typeof record.model === 'string') return record.model
  }
  return String(model)
}
