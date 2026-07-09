import type {
  Evaluation,
  Experiment,
  ExperimentCell,
  QualitySourceFrameResolver,
  ReplayMode,
  RunOverrides,
} from '../../quality'
import { createQualityRunner, type QualityRunnerEnv, type QualityRunnerEvent } from '../../quality/internal/runner'

interface CellEvents {
  onCellStart?: (cell: { caseId: string; caseName?: string; variantName: string; trial: number }) => void
  onCellDone?: (cell: ExperimentCell<unknown, unknown>) => void
}

export interface QualityRunnerHarnessOptions {
  evaluationId?: string
  qualityId?: string
  dir?: string
  persist?: boolean
  redact?: readonly string[]
  setup?: QualityRunnerEnv['setup']
  rootDir?: string
  defaults?: { trials?: number; concurrency?: number; timeoutMs?: number; replay?: ReplayMode }
  cacheDir?: string
  sourceFrameResolver?: QualitySourceFrameResolver
  sourceFrameRadius?: number
  forceFilteredRun?: boolean
  events?: CellEvents
}

export class QualityRunnerHarnessError extends Error {
  readonly code?: string
  readonly events: readonly QualityRunnerEvent[]

  constructor(message: string, options: { code?: string; events: readonly QualityRunnerEvent[] }) {
    super(message)
    this.name = 'QualityRunnerHarnessError'
    this.code = options.code
    this.events = options.events
  }
}

/** Run an evaluation through the internal runner facade without touching the repo. */
export async function runEvaluationWithRunner(
  evaluation: Evaluation<never, never, string, string>,
  overrides?: RunOverrides<string>,
  options: QualityRunnerHarnessOptions = {},
): Promise<Experiment<unknown, unknown, string, string>> {
  const events: QualityRunnerEvent[] = []
  const runner = createQualityRunner({
    qualityId: options.qualityId ?? 'test',
    persist: options.persist ?? false,
    ...(options.dir !== undefined ? { dir: options.dir } : {}),
    ...(options.redact !== undefined ? { redact: options.redact } : {}),
    ...(options.setup !== undefined ? { setup: options.setup } : {}),
    ...(options.rootDir !== undefined ? { rootDir: options.rootDir } : {}),
    ...(options.defaults !== undefined ? { defaults: options.defaults } : {}),
    ...(options.cacheDir !== undefined ? { cacheDir: options.cacheDir } : {}),
    ...(options.sourceFrameResolver !== undefined
      ? { sourceFrames: { resolver: options.sourceFrameResolver, radius: options.sourceFrameRadius } }
      : {}),
    events: (event) => {
      events.push(event)
      if (event.type === 'cell:start') {
        options.events?.onCellStart?.({
          caseId: event.caseId,
          ...(event.caseName !== undefined ? { caseName: event.caseName } : {}),
          variantName: event.variantName,
          trial: event.trial,
        })
      }
      if (event.type === 'cell:done') options.events?.onCellDone?.(event.cell)
    },
  })
  const collected = await runner.collect({
    modules: [
      {
        file: evaluation.id === undefined ? fileForEvaluationId(options.evaluationId) : '',
        exports: { default: evaluation },
      },
    ],
  })
  const collectError = collected.errors[0]
  if (collectError !== undefined) {
    throw new QualityRunnerHarnessError(collectError.message, { code: collectError.code, events })
  }

  const result = await runner.run({
    evaluations: collected.evaluations,
    ...(overrides?.cases !== undefined ? { cases: overrides.cases } : {}),
    ...(overrides?.sample !== undefined ? { sample: overrides.sample } : {}),
    ...(overrides?.maxCostUsd !== undefined ? { maxCostUsd: overrides.maxCostUsd } : {}),
    ...(overrides?.cells !== undefined ? { cells: overrides.cells } : {}),
    ...(overrides?.variants !== undefined ? { variants: overrides.variants } : {}),
    ...(overrides?.replayMode !== undefined ? { replayMode: overrides.replayMode } : {}),
    ...(overrides?.reuseOutputs === true ? { reuseOutputs: true } : {}),
    ...(overrides?.trials !== undefined ? { trials: overrides.trials } : {}),
    ...(overrides?.concurrency !== undefined ? { concurrency: overrides.concurrency } : {}),
    ...(overrides?.signal !== undefined ? { signal: overrides.signal } : {}),
    ...(options.forceFilteredRun === true ? { forceFilteredRun: true } : {}),
  })
  const experiment = result.experiments[0]
  if (experiment !== undefined) return experiment

  const error = events.find((event) => event.type === 'error')
  throw new QualityRunnerHarnessError(error?.message ?? 'Quality runner did not produce an experiment.', {
    code: error?.type === 'error' ? error.code : undefined,
    events,
  })
}

function fileForEvaluationId(evaluationId: string | undefined): string {
  if (evaluationId === undefined || evaluationId === '') return ''
  return `${evaluationId.replaceAll('.', '/')}.eval.ts`
}
