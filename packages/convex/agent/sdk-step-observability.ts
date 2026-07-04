import { observe, type OpenObservedSpan } from '@use-crux/core/observability'
import { stringValue } from './lifecycle-utils'
import { emitStepOutputArtifacts } from './sdk-observability-artifacts'
import {
  modelSpanAttributes,
  normalizeUsageWithCost,
  numericValue,
} from './sdk-observability-values'
import {
  emitStreamStepEvent,
  emitUnexecutedToolCallSpans,
} from './sdk-tool-observability'

type AgentStepMode = 'generate' | 'stream'

export type ActiveConvexAgentStepSpan = {
  readonly span: OpenObservedSpan
  readonly key: string | undefined
}

/** Observe a Convex Agent generation step and close the matching step span. */
export async function observeConvexAgentStep<T>(
  agentName: string,
  step: unknown,
  mode: AgentStepMode,
  model: unknown,
  userCallback: () => Promise<T>,
  activeStep?: ActiveConvexAgentStepSpan,
): Promise<T> {
  const stepNumber = numericValue(
    (step as Record<string, unknown> | undefined)?.stepNumber,
  )
  const finishReason =
    step && typeof step === 'object'
      ? stringValue((step as Record<string, unknown>).finishReason)
      : undefined
  const stepRecord =
    step && typeof step === 'object'
      ? (step as Record<string, unknown>)
      : undefined
  const usage = stepRecord
    ? normalizeUsageWithCost(stepRecord.usage, stepRecord)
    : undefined
  const stepSpan =
    activeStep?.span ??
    openConvexAgentStepSpan(agentName, step, mode, model).span
  try {
    return await stepSpan.withContext(async () => {
      emitStepOutputArtifacts(step)
      await emitUnexecutedToolCallSpans(step)
      emitStreamStepEvent(step)
      return await userCallback()
    })
  } catch (error) {
    stepSpan.error(error, {
      ...(typeof stepNumber === 'number' ? { stepNumber } : {}),
      ...(finishReason ? { finishReason } : {}),
    })
    throw error
  } finally {
    stepSpan.end({
      status: finishReason === 'error' ? 'error' : 'ok',
      ...(usage ? { metrics: usage } : {}),
      attributes: {
        ...(typeof stepNumber === 'number' ? { stepNumber } : {}),
        ...(finishReason ? { finishReason } : {}),
      },
    })
  }
}

export function openConvexAgentStepSpan(
  agentName: string,
  step: unknown,
  mode: AgentStepMode,
  model: unknown,
): ActiveConvexAgentStepSpan {
  const stepNumber = numericValue(
    (step as Record<string, unknown> | undefined)?.stepNumber,
  )
  const finishReason =
    step && typeof step === 'object'
      ? stringValue((step as Record<string, unknown>).finishReason)
      : undefined
  const span = observe.openSpan({
    name:
      typeof stepNumber === 'number'
        ? `step ${stepNumber + 1}`
        : `${mode} step`,
    primitive: 'generation.call',
    attributes: {
      agentName,
      stepMode: mode,
      output: 'text',
      source: 'convex.agent.step',
      ...modelSpanAttributes(model),
      ...(typeof stepNumber === 'number' ? { stepNumber } : {}),
      ...(finishReason ? { finishReason } : {}),
    },
    implicitRun: false,
  })
  return {
    span,
    key: stepKey(step),
  }
}

export function takeActiveAgentStepSpan(
  activeStepSpans: ActiveConvexAgentStepSpan[],
  step: unknown,
): ActiveConvexAgentStepSpan | undefined {
  if (activeStepSpans.length === 0) return undefined
  const key = stepKey(step)
  const index = key
    ? activeStepSpans.findIndex((entry) => entry.key === key)
    : 0
  if (index < 0) return activeStepSpans.shift()
  const [entry] = activeStepSpans.splice(index, 1)
  return entry
}

export function removeActiveAgentStepSpan(
  activeStepSpans: ActiveConvexAgentStepSpan[],
  step: ActiveConvexAgentStepSpan,
): void {
  const index = activeStepSpans.indexOf(step)
  if (index >= 0) activeStepSpans.splice(index, 1)
}

export function endRemainingAgentStepSpans(
  activeStepSpans: ActiveConvexAgentStepSpan[],
  attributes: Record<string, unknown> | undefined,
): void {
  while (activeStepSpans.length > 0) {
    const activeStep = activeStepSpans.shift()
    activeStep?.span.end({
      status: 'ok',
      attributes: {
        source: 'convex.agent.step',
        ...(attributes ?? {}),
      },
    })
  }
}

export function errorRemainingAgentStepSpans(
  activeStepSpans: ActiveConvexAgentStepSpan[],
  error: unknown,
): void {
  while (activeStepSpans.length > 0) {
    const activeStep = activeStepSpans.shift()
    activeStep?.span.error(error)
  }
}

function stepKey(step: unknown): string | undefined {
  const stepNumber = numericValue(
    (step as Record<string, unknown> | undefined)?.stepNumber,
  )
  return typeof stepNumber === 'number' ? String(stepNumber) : undefined
}
