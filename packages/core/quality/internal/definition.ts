/**
 * The normalized evaluation definition — what `evaluate()` produces
 * internally and what the manifest builder and (later) the execution engine
 * consume.
 *
 * @internal Not exported from `@use-crux/core/quality` — engine plumbing only.
 * @module
 */

import type { TaskLike, AnyTarget, Capability } from '../target'
import type { ProjectDefinitionKind } from '../../project-index'
import { PROMPT_CAPABILITIES, FLOW_CAPABILITIES, AGENT_CAPABILITIES, RETRIEVER_CAPABILITIES } from '../target'
import type { Turn } from '../case'
import type { Dataset } from '../dataset'
import type { Gates } from '../gates'
import type { Cassette, ReplayMode } from '../replay'
import type { Score, ScorerArgs } from '../scorers'

/** Project Index definition id that an evaluation is intended to cover. */
export type EvaluationCoverageTargetId<TKind extends ProjectDefinitionKind = ProjectDefinitionKind> =
  `${TKind}:${string}`

/** A case as authored, erased to runtime shape. @internal */
export interface RawCase {
  name?: string
  input?: unknown
  turns?: readonly Turn[]
  expected?: unknown
  expect?: (ctx: never) => void | Promise<void>
  afterScores?: (ctx: never) => void | Promise<void>
  trials?: number
  tags?: readonly string[]
  metadata?: Record<string, unknown>
  only?: boolean
  skip?: boolean | string
}

/** A scorer as stored on the definition (factories already invoked). @internal */
export type RawScorer = ((args: ScorerArgs<unknown, unknown, unknown>) => Score | Promise<Score>) & {
  scorerName?: string
  costClass?: 'code' | 'model'
}

/** Erased dataset reference. @internal */
export type RawDataset = Dataset<unknown, unknown>

/** The normalized, runtime-erased definition behind every Evaluation. @internal */
export interface EvaluationDefinition {
  readonly id: string | undefined
  readonly description: string | undefined
  readonly tags: readonly string[]
  readonly covers: readonly EvaluationCoverageTargetId[]
  readonly task: TaskLike
  readonly cases: readonly RawCase[]
  readonly datasets: readonly RawDataset[]
  readonly expect: ((ctx: never) => void | Promise<void>) | undefined
  readonly afterScores: ((ctx: never) => void | Promise<void>) | undefined
  readonly scorers: readonly RawScorer[]
  readonly params: Readonly<Record<string, unknown>> | undefined
  readonly variants: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  readonly baseline: string | undefined
  readonly trials: number | undefined
  readonly gates: Gates<string> | undefined
  readonly replay: { mode: ReplayMode; cassette?: string | Cassette } | undefined
  readonly concurrency: number | undefined
  readonly timeoutMs: number | undefined
  readonly flags: { readonly only: boolean; readonly skip: boolean }
  /** Manifest `source` — `'prompt-tests'` for lowered colocated prompt tests. */
  readonly source: 'file' | 'prompt-tests'
}

/** Structural facts about a task, derived without executing it. @internal */
export interface DetectedTask {
  kind: 'prompt' | 'flow' | 'agent' | 'retriever' | 'fn'
  /** Source-catalog reference when the task wraps a known primitive. */
  ref?: string
  capabilities: readonly Capability[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

/**
 * Classify a task value by its runtime discriminant and derive its
 * capability set. Flow handles carry no `_tag` (a `FlowHandle` is a plain
 * frozen object), so they are detected structurally by their
 * `run`/`signal`/`name` surface — checked LAST among object kinds.
 *
 * @internal
 */
export function detectTask(task: unknown): DetectedTask {
  if (typeof task === 'function') {
    return { kind: 'fn', capabilities: [] }
  }
  if (isRecord(task)) {
    const tag = task._tag
    if (tag === 'QualityTarget') {
      const t = task as unknown as AnyTarget
      const primitiveRef = t.id
      return {
        kind: t.kind,
        ...(primitiveRef !== undefined ? { ref: primitiveRef } : {}),
        capabilities: t.capabilities,
      }
    }
    if (tag === 'Prompt') {
      const id = task.id
      return {
        kind: 'prompt',
        ...(typeof id === 'string' ? { ref: id } : {}),
        capabilities: PROMPT_CAPABILITIES,
      }
    }
    if (tag === 'Agent') {
      const id = task.id
      return {
        kind: 'agent',
        ...(typeof id === 'string' ? { ref: id } : {}),
        capabilities: AGENT_CAPABILITIES,
      }
    }
    if (tag === 'Retriever' || tag === 'RetrievalRecipe') {
      const id = task.id
      return {
        kind: 'retriever',
        ...(typeof id === 'string' ? { ref: id } : {}),
        capabilities: RETRIEVER_CAPABILITIES,
      }
    }
    if (typeof task.run === 'function' && typeof task.signal === 'function' && typeof task.name === 'string') {
      return { kind: 'flow', ref: task.name, capabilities: FLOW_CAPABILITIES }
    }
  }
  throw new TypeError(
    'evaluate(): `task` must be a Crux prompt, flow, agent, retriever, retrieval recipe, a target built with target.*, or a plain function.',
  )
}
