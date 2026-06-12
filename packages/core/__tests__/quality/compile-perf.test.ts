import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Compile-perf budget for the Quality authoring types (spec 01 §12 item 17).
 *
 * Compiles the 50-eval fixture (`__type_tests__/fixtures/quality-perf-fixture.ts`)
 * with `tsc --extendedDiagnostics` and asserts the type-instantiation count
 * stays within the recorded baseline +20%. This monorepo has TS2589 history —
 * the Quality types must never join it.
 *
 * Baseline recorded 2026-06-12 (TypeScript 5.9.3): 337,533 instantiations,
 * 114,466 types, ~2.4s check time. If you intentionally changed the fixture
 * or the public types, re-measure and update BASELINE_INSTANTIATIONS (and the
 * implementation kit's SCRATCHPAD) in the same commit.
 */
const BASELINE_INSTANTIATIONS = 337_533

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..', '..')
const require = createRequire(import.meta.url)

describe('quality authoring compile-perf budget', () => {
  it('keeps fixture instantiations within +20% of the recorded baseline', { timeout: 180_000 }, () => {
    const tscPath = require.resolve('typescript/lib/tsc.js')
    const output = execFileSync(
      process.execPath,
      [tscPath, '-p', resolve(here, 'tsconfig.perf.json'), '--noEmit', '--extendedDiagnostics'],
      { cwd: packageRoot, encoding: 'utf8' },
    )

    const match = output.match(/^Instantiations:\s+([\d,]+)/m)
    expect(match, `tsc output missing Instantiations diagnostic:\n${output}`).not.toBeNull()
    const instantiations = Number(match![1]!.replaceAll(',', ''))

    expect(instantiations).toBeGreaterThan(0)
    expect(
      instantiations,
      `Quality types instantiation count regressed: ${instantiations} > ${BASELINE_INSTANTIATIONS} +20%. ` +
        'If the fixture or public types changed intentionally, re-measure and update the baseline.',
    ).toBeLessThanOrEqual(Math.round(BASELINE_INSTANTIATIONS * 1.2))

    // A collapse far below baseline means the fixture stopped exercising the
    // types (e.g. an import broke) — that is a test bug, not a perf win.
    expect(instantiations).toBeGreaterThanOrEqual(Math.round(BASELINE_INSTANTIATIONS * 0.5))
  })
})
