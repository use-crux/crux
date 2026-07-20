import { afterEach, describe, expect, it } from 'vitest'
import { config, resetHooks } from '../../src'
import type { CruxDeploymentIdentity } from '../../src/project-index'
import {
  CRUX_OBSERVABILITY_SCHEMA_VERSION,
  CruxGraphRecordSchema,
  configureObservability,
  observe,
  observabilityDiagnostics,
  resetObservabilityRuntime,
  subscribeObservability,
  type CruxGraphRecord,
} from '../../src/observability'

const manifestId = `pim_${'a'.repeat(64)}` as const
const identity = {
  projectId: 'checkout',
  manifestId,
  deploymentId: 'production-42',
} satisfies CruxDeploymentIdentity

const persistedV2RunStart = {
  schemaVersion: 2,
  recordId: 'rec_1111111111111111_1',
  type: 'run:start',
  runId: 'run_111111111111111111111111',
  segmentId: 'seg_111111111111111111111111',
  segmentSeq: 1,
  traceId: '11111111111111111111111111111111',
  name: 'persisted run',
  rootPrimitive: 'run',
  startedAt: '2026-07-14T12:00:00.000Z',
  status: 'running',
} as const

describe('observability deployment identity', () => {
  afterEach(() => {
    resetHooks()
    resetObservabilityRuntime()
  })

  it('fails closed when a redaction hook rewrites deployment identity', async () => {
    const records: CruxGraphRecord[] = []
    subscribeObservability((record) => records.push(record))
    const crux = config({
      observability: {
        identity,
        redactRecord: (record) => ({
          ...record,
          deployment: { projectId: 'different-project' },
        }),
      },
    })

    await observe.run(
      { name: 'redacted', rootPrimitive: 'custom.operation' },
      async () => undefined,
    )

    expect(records).toEqual([])
    expect(observabilityDiagnostics().redactedRecords).toBeGreaterThan(0)
    await crux.dispose()
  })

  it('writes schema v4 and rejects records without operation identity', () => {
    expect(CRUX_OBSERVABILITY_SCHEMA_VERSION).toBe(4)
    expect(CruxGraphRecordSchema.safeParse(persistedV2RunStart).success).toBe(
      false,
    )
    const current = {
      ...persistedV2RunStart,
      schemaVersion: 4,
      operationId: persistedV2RunStart.runId,
      deployment: identity,
    }
    expect(CruxGraphRecordSchema.safeParse(current).success).toBe(true)
  })

  it('rejects malformed configured identity before changing the active layer', async () => {
    const records: CruxGraphRecord[] = []
    subscribeObservability((record) => records.push(record))
    const restore = configureObservability({ identity })

    expect(() =>
      configureObservability({
        identity: { ...identity, manifestId: 'pim_not-a-digest' },
      }),
    ).toThrow()

    await observe.run(
      { name: 'still-valid', rootPrimitive: 'custom.operation' },
      async () => undefined,
    )
    restore()

    expect(records).not.toHaveLength(0)
    expect(records.every((record) => record.deployment !== identity)).toBe(true)
    expect(
      records.every(
        (record) =>
          JSON.stringify(record.deployment) === JSON.stringify(identity),
      ),
    ).toBe(true)
  })

  it('restores layered identity and keeps an open run on its captured identity', () => {
    const records: CruxGraphRecord[] = []
    subscribeObservability((record) => records.push(record))
    const outerIdentity = identity
    const innerIdentity = {
      projectId: 'checkout',
      deploymentId: 'preview-7',
    } satisfies CruxDeploymentIdentity
    const restoreOuter = configureObservability({ identity: outerIdentity })
    const openRun = observe.openRun({
      name: 'outer-open',
      rootPrimitive: 'custom.operation',
    })
    const restoreInner = configureObservability({ identity: innerIdentity })

    openRun.withContext(() => {
      observe.span(
        { name: 'captured-child', primitive: 'custom.operation' },
        () => undefined,
      )
    })
    openRun.end()
    observe.run(
      { name: 'inner-run', rootPrimitive: 'custom.operation' },
      () => undefined,
    )
    restoreInner()
    observe.run(
      { name: 'restored-run', rootPrimitive: 'custom.operation' },
      () => undefined,
    )
    restoreOuter()

    const byRun = Map.groupBy(records, (record) => record.runId)
    expect(
      byRun
        .get(openRun.runId)
        ?.every(
          (record) =>
            record.deployment?.deploymentId === outerIdentity.deploymentId,
        ),
    ).toBe(true)
    const starts = records.filter((record) => record.type === 'run:start')
    expect(starts.map((record) => record.deployment)).toEqual([
      outerIdentity,
      innerIdentity,
      outerIdentity,
    ])
  })
})
