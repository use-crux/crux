import { afterEach, describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  CruxGraphRecordSchema,
  createInMemoryObservabilityTransport,
  observe,
  observabilityDiagnostics,
  resetObservabilityRuntime,
  setObservabilityTransport,
  type CruxAttributes,
  type CruxMetrics,
} from '../../observability'

interface GeneratedObservabilityCase {
  readonly name: string
  readonly attributes: CruxAttributes
  readonly metrics: CruxMetrics
  readonly errorMessage?: string
}

const attributeValueArbitrary = fc.oneof(
  fc.string({ maxLength: 40 }),
  fc.integer(),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined),
)

const attributesArbitrary: fc.Arbitrary<CruxAttributes> = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 16 }),
  attributeValueArbitrary,
  { maxKeys: 6 },
)

const metricsArbitrary: fc.Arbitrary<CruxMetrics> = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 16 }),
  fc.oneof(
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.constant(Number.NaN),
    fc.constant(Number.POSITIVE_INFINITY),
    fc.constant(Number.NEGATIVE_INFINITY),
    fc.constant(undefined),
  ),
  { maxKeys: 6 },
)

const observabilityCaseArbitrary: fc.Arbitrary<GeneratedObservabilityCase> = fc.record({
  name: fc.oneof(fc.constant(''), fc.string({ minLength: 1, maxLength: 40 })),
  attributes: attributesArbitrary,
  metrics: metricsArbitrary,
  errorMessage: fc.option(fc.string({ maxLength: 40 }), { nil: undefined }),
})

describe('observability property invariants', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('never throws instrumentation failures for arbitrary public observe inputs', async () => {
    await fc.assert(
      fc.asyncProperty(observabilityCaseArbitrary, async (input) => {
        resetObservabilityRuntime()
        const transport = createInMemoryObservabilityTransport()
        setObservabilityTransport(transport)
        const userError = input.errorMessage === undefined ? undefined : new Error(input.errorMessage)

        if (userError) {
          let caught: unknown
          try {
            await observe.run(
              { name: input.name, rootPrimitive: 'custom.operation', attributes: input.attributes },
              async () => {
                await observe.span(
                  { name: input.name, family: 'custom', primitive: 'custom.operation', attributes: input.attributes },
                  async () => {
                    observe.event({ name: input.name, attributes: input.attributes })
                    observe.artifact({
                      kind: 'output',
                      contentType: 'application/json',
                      encoding: 'json',
                      preview: input.attributes,
                      attributes: input.attributes,
                    })
                    throw userError
                  },
                )
              },
            )
          } catch (error) {
            caught = error
          }
          expect(caught).toBe(userError)
        } else {
          await expect(
            observe.run(
              { name: input.name, rootPrimitive: 'custom.operation', attributes: input.attributes },
              async () => {
                await observe.span(
                  { name: input.name, family: 'custom', primitive: 'custom.operation', attributes: input.attributes },
                  async () => {
                    observe.event({ name: input.name, attributes: input.attributes })
                    observe.artifact({
                      kind: 'output',
                      contentType: 'application/json',
                      encoding: 'json',
                      preview: input.attributes,
                      attributes: input.attributes,
                    })
                  },
                )
              },
            ),
          ).resolves.toBeUndefined()

          const run = observe.openRun({
            name: input.name,
            rootPrimitive: 'custom.operation',
            attributes: input.attributes,
          })
          run.withContext(() => {
            const span = observe.openSpan({
              name: input.name,
              family: 'custom',
              primitive: 'custom.operation',
              attributes: input.attributes,
            })
            span.end({ attributes: input.attributes, metrics: input.metrics })
          })
          run.end({ attributes: input.attributes, metrics: input.metrics })
        }

        await observe.flush()

        for (const record of transport.records) {
          expect(CruxGraphRecordSchema.safeParse(record).success).toBe(true)
        }
        expect(observabilityDiagnostics().invalidRecords).toBeGreaterThanOrEqual(0)
      }),
      { numRuns: 200 },
    )
  })
})
