import { describe, expect, it } from 'vitest'
import { sourceInterfaceHash } from '../indexer/source-interface-hash'

describe('source interface hash', () => {
  it('treats constructor bodies as implementation details while preserving constructor signatures', () => {
    const file = '/workspace/src/flow-errors.ts'
    const original = `
      export class FlowCancelledError extends Error {
        readonly _tag = 'FlowCancelledError' as const

        constructor(public readonly reason?: string) {
          super(\`Flow cancelled\${reason ? \`: \${reason}\` : ''}\`)
          this.name = 'FlowCancelledError'
        }
      }
    `
    const bodyOnlyChange = `
      export class FlowCancelledError extends Error {
        readonly _tag = 'FlowCancelledError' as const

        constructor(public readonly reason?: string) {
          super(reason ?? 'cancelled')
          this.name = 'Cancelled'
        }
      }
    `
    const signatureChange = `
      export class FlowCancelledError extends Error {
        readonly _tag = 'FlowCancelledError' as const

        constructor(public readonly reason: string) {
          super(reason)
          this.name = 'FlowCancelledError'
        }
      }
    `

    expect(sourceInterfaceHash(file, bodyOnlyChange)).toBe(sourceInterfaceHash(file, original))
    expect(sourceInterfaceHash(file, signatureChange)).not.toBe(sourceInterfaceHash(file, original))
  })
})
