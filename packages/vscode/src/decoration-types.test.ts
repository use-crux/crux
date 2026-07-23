import { describe, expect, it } from 'vitest'
import {
  DecorationTypeRegistry,
  handleDecorationConfigurationChange,
  normalizeDecorationOpacity,
} from './decoration-types.js'
import type { DecorationSeverity } from './decoration-policy.js'

describe('DecorationTypeRegistry', () => {
  it('rebuilds every severity at the new opacity and disposes old types', () => {
    const created: number[] = []
    const disposed: string[] = []
    const registry = new DecorationTypeRegistry((opacity) => {
      created.push(opacity)
      return types((severity) => ({
        id: `${severity}@${opacity}`,
        dispose: () => disposed.push(`${severity}@${opacity}`),
      }))
    }, 0.65)

    registry.rebuild(0.4)

    expect(created).toEqual([0.65, 0.4])
    expect(disposed).toEqual([
      'error@0.65',
      'warning@0.65',
      'information@0.65',
      'hint@0.65',
    ])
    expect(registry.current.information.id).toBe('information@0.4')
  })

  it('clamps configured opacity and falls back for non-finite values', () => {
    expect(normalizeDecorationOpacity(0)).toBe(0.1)
    expect(normalizeDecorationOpacity(0.4)).toBe(0.4)
    expect(normalizeDecorationOpacity(2)).toBe(1)
    expect(normalizeDecorationOpacity(Number.NaN)).toBe(0.65)
  })

  it('rebuilds opacity types before refreshing visible editors', () => {
    const events: string[] = []
    const registry = new DecorationTypeRegistry((opacity) => types((severity) => ({
      id: `${severity}@${opacity}`,
      dispose: () => events.push(`dispose:${severity}`),
    })), 0.65)

    handleDecorationConfigurationChange(
      (section) => section === 'crux.decorations' || section === 'crux.decorations.opacity',
      registry,
      0.35,
      () => events.push(`refresh:${registry.current.information.id}`),
    )

    expect(events).toEqual([
      'dispose:error',
      'dispose:warning',
      'dispose:information',
      'dispose:hint',
      'refresh:information@0.35',
    ])
  })
})

interface FakeType {
  readonly id: string
  dispose(): void
}

function types(
  create: (severity: DecorationSeverity) => FakeType,
): Readonly<Record<DecorationSeverity, FakeType>> {
  return {
    error: create('error'),
    warning: create('warning'),
    information: create('information'),
    hint: create('hint'),
  }
}
