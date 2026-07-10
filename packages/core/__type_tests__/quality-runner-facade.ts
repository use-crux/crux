import { expectTypeOf } from 'vitest'
import {
  createQualityRunner,
  type QualityCollectedEvaluation,
  type QualityEvaluationHandle,
  type QualityRunner,
} from '../src/quality/internal/runner'

expectTypeOf(createQualityRunner()).toEqualTypeOf<QualityRunner>()
expectTypeOf<QualityCollectedEvaluation['handle']>().toMatchTypeOf<QualityEvaluationHandle>()

// @ts-expect-error The facade handle is opaque; engine definitions stay internal.
type _DefinitionLeak = QualityCollectedEvaluation['handle']['definition']

// @ts-expect-error The runner facade no longer exports the low-level engine entry.
import { runEvaluation } from '../src/quality/internal/runner'

// @ts-expect-error Baseline path helpers are behind runner.promote().
import { baselineRecordPath } from '../src/quality/internal/runner'
