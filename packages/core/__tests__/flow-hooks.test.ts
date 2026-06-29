import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resetRuntime, updateRuntime } from '../runtime/runtime'
import { flow as makeFlow } from '../flow/scope'

describe('flow instrumentation hooks', () => {
  beforeEach(() => {
    resetRuntime()
  })

  it('flow emits onFlowStart and onFlowEnd', async () => {
    const onFlowStart = vi.fn()
    const onFlowEnd = vi.fn()
    updateRuntime({
      instrumentationHooks: { onFlowStart, onFlowEnd },
    })

    await makeFlow('test-pipeline', async (flow) => {
      return 'done'
    }).run()

    expect(onFlowStart).toHaveBeenCalledOnce()
    expect(onFlowStart.mock.calls[0][0]).toMatchObject({
      name: 'test-pipeline',
    })
    expect(onFlowStart.mock.calls[0][0].flowId).toBeDefined()

    expect(onFlowEnd).toHaveBeenCalledOnce()
    expect(onFlowEnd.mock.calls[0][0]).toMatchObject({
      status: 'success',
    })
    expect(onFlowEnd.mock.calls[0][0].durationMs).toBeGreaterThanOrEqual(0)
  })

  it('flow.step() emits onStepStart and onStepEnd', async () => {
    const onStepStart = vi.fn()
    const onStepEnd = vi.fn()
    updateRuntime({
      instrumentationHooks: { onStepStart, onStepEnd },
    })

    await makeFlow('pipeline', async (flow) => {
      await flow.step('research', async () => 'data')
      await flow.step('write', async () => 'content')
    }).run()

    expect(onStepStart).toHaveBeenCalledTimes(2)
    expect(onStepStart.mock.calls[0][0].label).toBe('research')
    expect(onStepStart.mock.calls[1][0].label).toBe('write')

    expect(onStepEnd).toHaveBeenCalledTimes(2)
    expect(onStepEnd.mock.calls[0][0].status).toBe('success')
    expect(onStepEnd.mock.calls[1][0].status).toBe('success')
  })

  it('onFlowEnd reports error status when flow throws', async () => {
    const onFlowEnd = vi.fn()
    updateRuntime({
      instrumentationHooks: { onFlowEnd },
    })

    await expect(
      makeFlow('failing', async () => {
        throw new Error('boom')
      }).run(),
    ).rejects.toThrow('boom')

    expect(onFlowEnd).toHaveBeenCalledOnce()
    expect(onFlowEnd.mock.calls[0][0].status).toBe('error')
    expect(onFlowEnd.mock.calls[0][0].error).toBe('boom')
  })
})
