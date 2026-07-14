import { afterEach, describe, expect, it } from 'vitest'
import { config, resetHooks } from '@use-crux/core'
import type { CruxDeploymentIdentity } from '@use-crux/core/project-index'
import { observe, resetObservabilityRuntime } from '@use-crux/core/observability'
import { trace } from '@opentelemetry/api'
import { Resource } from '@opentelemetry/resources'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base'
import {
  createCruxResourceAttributes,
  withTelemetry,
  type CruxOtelResourceAttributes,
} from '../src'
import type { TraceSpan } from '../src'

const identity = {
  projectId: 'checkout',
  manifestId: `pim_${'c'.repeat(64)}`,
  deploymentId: 'production-42',
} satisfies CruxDeploymentIdentity

describe('Crux OTel Resource attributes', () => {
  afterEach(() => {
    resetHooks()
    resetObservabilityRuntime()
    trace.disable()
  })

  it('returns exactly the validated semantic keys and omits absent optionals', () => {
    const attributes: CruxOtelResourceAttributes =
      createCruxResourceAttributes(identity)

    expect(attributes).toEqual({
      'crux.project.id': 'checkout',
      'crux.manifest.id': identity.manifestId,
      'crux.deployment.id': 'production-42',
    })
    expect(createCruxResourceAttributes({ projectId: 'checkout' })).toEqual({
      'crux.project.id': 'checkout',
    })
    expect(() =>
      createCruxResourceAttributes({ projectId: ' checkout ' }),
    ).toThrow()
  })

  it('keeps standard-path identity on the application-owned Resource only', async () => {
    const exporter = new InMemorySpanExporter()
    const sdk = new NodeSDK({
      resource: new Resource({ ...createCruxResourceAttributes(identity) }),
      traceExporter: exporter,
    })
    sdk.start()
    const crux = config({
      observability: { identity },
      plugins: [withTelemetry({ serviceName: 'resource-fixture' })],
    })

    await observe.span(
      { name: 'resource span', primitive: 'tool.call' },
      async () => undefined,
    )
    await observe.flush()

    const span = exporter.getFinishedSpans().find(
      (candidate) => candidate.name === 'execute_tool resource span',
    )
    expect(span?.resource.attributes).toMatchObject(
      createCruxResourceAttributes(identity),
    )
    expect(span?.attributes).not.toHaveProperty('crux.project.id')
    expect(span?.attributes).not.toHaveProperty('crux.manifest.id')
    expect(span?.attributes).not.toHaveProperty('crux.deployment.id')

    await crux.dispose()
    await sdk.shutdown()
  })

  it('adds the same identity to every lightweight root and child span', async () => {
    const spans: TraceSpan[] = []
    const crux = config({
      observability: { identity },
      plugins: [
        withTelemetry({
          exporter: (batch) => {
            spans.push(...batch)
          },
        }),
      ],
    })

    await observe.span(
      { name: 'lightweight child', primitive: 'tool.call' },
      async () => undefined,
    )
    await observe.flush()

    expect(spans).toHaveLength(2)
    for (const span of spans) {
      expect(span.attributes).toMatchObject(
        createCruxResourceAttributes(identity),
      )
    }
    await crux.dispose()
  })

  it('keeps lightweight deployment identity authoritative over custom attributes', async () => {
    const spans: TraceSpan[] = []
    const crux = config({
      observability: { identity },
      plugins: [
        withTelemetry({
          attributes: {
            'crux.project.id': 'spoofed-project',
            'crux.manifest.id': `pim_${'0'.repeat(64)}`,
            'crux.deployment.id': 'spoofed-deployment',
          },
          exporter: (batch) => {
            spans.push(...batch)
          },
        }),
      ],
    })

    await observe.span(
      {
        name: 'authoritative identity',
        primitive: 'tool.call',
        attributes: {
          'crux.project.id': 'record-spoofed-project',
          'crux.manifest.id': `pim_${'1'.repeat(64)}`,
          'crux.deployment.id': 'record-spoofed-deployment',
        },
      },
      async () => undefined,
    )
    await observe.flush()

    expect(spans).toHaveLength(2)
    for (const span of spans) {
      expect(span.attributes).toMatchObject(
        createCruxResourceAttributes(identity),
      )
    }
    await crux.dispose()
  })
})
