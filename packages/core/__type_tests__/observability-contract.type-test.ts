/**
 * Type-level checks for the canonical observability wire contract.
 *
 * These assertions intentionally compare the handwritten public record types
 * with the Zod parser output. If either side drifts, package typecheck fails
 * before the runtime or Go mirror can silently disagree.
 */

import type { z } from 'zod'
import type {
  CruxArtifactRecord,
  CruxEdgeRecord,
  CruxMetrics,
  CruxRunEndRecord,
  CruxRunLifecycleRecord,
  CruxRunResumeRecord,
  CruxRunStartRecord,
  CruxRunSuspendRecord,
  CruxSpanEndRecord,
  CruxSpanEventRecord,
  CruxSpanRecord,
  CruxSpanStartRecord,
} from '../src/observability'
import {
  CruxArtifactRecordSchema,
  CruxEdgeRecordSchema,
  CruxMetricsSchema,
  CruxRunEndRecordSchema,
  CruxRunResumeRecordSchema,
  CruxRunStartRecordSchema,
  CruxRunSuspendRecordSchema,
  CruxSpanEndRecordSchema,
  CruxSpanEventRecordSchema,
  CruxSpanRecordSchema,
  CruxSpanStartRecordSchema,
} from '../src/observability'

type AssertEqual<T, U> = (<G>() => G extends T ? 1 : 2) extends <G>() => G extends U ? 1 : 2
  ? (<G>() => G extends U ? 1 : 2) extends <G>() => G extends T ? 1 : 2
    ? true
    : false
  : false

type Expect<T extends true> = T
type ExpectFalse<T extends false> = T

type _RunStartRecord = Expect<AssertEqual<CruxRunStartRecord, z.infer<typeof CruxRunStartRecordSchema>>>
type _RunEndRecord = Expect<AssertEqual<CruxRunEndRecord, z.infer<typeof CruxRunEndRecordSchema>>>
type _RunSuspendRecord = Expect<AssertEqual<CruxRunSuspendRecord, z.infer<typeof CruxRunSuspendRecordSchema>>>
type _RunResumeRecord = Expect<AssertEqual<CruxRunResumeRecord, z.infer<typeof CruxRunResumeRecordSchema>>>
type _RunLifecycleRecord = Expect<AssertEqual<CruxRunLifecycleRecord, Extract<
  import('../src/observability').CruxGraphRecord,
  { type: 'run:start' | 'run:suspend' | 'run:resume' | 'run:end' }
>>>
type _SpanStartRecord = Expect<AssertEqual<CruxSpanStartRecord, z.infer<typeof CruxSpanStartRecordSchema>>>
type _SpanEndRecord = Expect<AssertEqual<CruxSpanEndRecord, z.infer<typeof CruxSpanEndRecordSchema>>>
type _SpanRecord = Expect<AssertEqual<CruxSpanRecord, z.infer<typeof CruxSpanRecordSchema>>>
type _SpanEventRecord = Expect<AssertEqual<CruxSpanEventRecord, z.infer<typeof CruxSpanEventRecordSchema>>>
type _EdgeRecord = Expect<AssertEqual<CruxEdgeRecord, z.infer<typeof CruxEdgeRecordSchema>>>
type _ArtifactRecord = Expect<AssertEqual<CruxArtifactRecord, z.infer<typeof CruxArtifactRecordSchema>>>

// Deliberate asymmetry: callers may pass optional metric expressions, while
// parsed records have already stripped undefined and non-finite values.
type _MetricsInputDiffersFromParsed = ExpectFalse<AssertEqual<CruxMetrics, z.infer<typeof CruxMetricsSchema>>>
