import { z } from 'zod'
import {
  CRUX_CANONICAL_ARTIFACT_KINDS,
  CRUX_CANONICAL_EDGE_TYPES,
  CRUX_GENERATION_METRIC_KEYS,
  CRUX_OBSERVABILITY_SCHEMA_VERSION,
  CRUX_PRIMITIVE_FAMILIES,
  CRUX_PRIMITIVE_FAMILY_BY_NAME,
  CRUX_PRIMITIVE_NAMES,
  CRUX_TOKEN_METRIC_KEYS,
  type CruxArtifactId,
  type CruxArtifactKind,
  type CruxCustomArtifactKind,
  type CruxCustomEdgeType,
  type CruxEdgeId,
  type CruxEdgeType,
  type CruxMetricKey,
  type CruxRecordId,
  type CruxRunId,
  type CruxSegmentId,
  type CruxSpanEventId,
  type CruxSpanId,
  type CruxTraceId,
  type DefinitionRef,
  type DefinitionRefRole,
  type SanitizedSourceRef,
} from './contract'
import { ProjectDefinitionKindSchema } from '../project-index'

const nonEmptyString = z.string().min(1)
const isoTimestamp = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'Expected an ISO-compatible timestamp',
})
const w3cTraceId = /^[0-9a-f]{32}$/
const w3cSpanId = /^[0-9a-f]{16}$/
const allZeroHex = /^0+$/

export const CruxRecordIdSchema = nonEmptyString.transform((value) => value as CruxRecordId)
export const CruxRunIdSchema = nonEmptyString.transform((value) => value as CruxRunId)
export const CruxSegmentIdSchema = nonEmptyString.transform((value) => value as CruxSegmentId)
export const CruxTraceIdSchema = nonEmptyString
  .regex(w3cTraceId, 'Trace IDs must be 32 lowercase hexadecimal characters')
  .refine((value) => !allZeroHex.test(value), { message: 'Trace IDs must not be all zeroes' })
  .transform((value) => value as CruxTraceId)
export const CruxSpanIdSchema = nonEmptyString
  .regex(w3cSpanId, 'Span IDs must be 16 lowercase hexadecimal characters')
  .refine((value) => !allZeroHex.test(value), { message: 'Span IDs must not be all zeroes' })
  .transform((value) => value as CruxSpanId)
export const CruxSpanEventIdSchema = nonEmptyString.transform((value) => value as CruxSpanEventId)
export const CruxEdgeIdSchema = nonEmptyString.transform((value) => value as CruxEdgeId)
export const CruxArtifactIdSchema = nonEmptyString.transform((value) => value as CruxArtifactId)

export const CruxRunStatusSchema = z.enum(['running', 'ok', 'error', 'blocked', 'cancelled', 'suspended'])
export const CruxTerminalRunStatusSchema = z.enum(['ok', 'error', 'blocked', 'cancelled', 'suspended'])
export const CruxSpanStatusSchema = z.enum(['running', 'ok', 'error', 'blocked', 'cancelled', 'suspended', 'skipped'])
export const CruxTerminalSpanStatusSchema = z.enum(['ok', 'error', 'blocked', 'cancelled', 'suspended', 'skipped'])

export const CruxPrimitiveFamilySchema = z.enum(CRUX_PRIMITIVE_FAMILIES)

export const CruxPrimitiveNameSchema = z.enum(CRUX_PRIMITIVE_NAMES)

const customPrefixed = (value: string) => value.startsWith('custom.') && value.length > 'custom.'.length

export const CruxCanonicalEdgeTypeSchema = z.enum(CRUX_CANONICAL_EDGE_TYPES)
export const CruxCustomEdgeTypeSchema = z
  .string()
  .refine(customPrefixed, { message: 'Custom edge types must use the custom.* namespace' })
  .transform((value) => value as CruxCustomEdgeType)
export const CruxEdgeTypeSchema = z.union([
  CruxCanonicalEdgeTypeSchema,
  CruxCustomEdgeTypeSchema,
]) satisfies z.ZodType<CruxEdgeType>

export const CruxCanonicalArtifactKindSchema = z.enum(CRUX_CANONICAL_ARTIFACT_KINDS)
export const CruxCustomArtifactKindSchema = z
  .string()
  .refine(customPrefixed, { message: 'Custom artifact kinds must use the custom.* namespace' })
  .transform((value) => value as CruxCustomArtifactKind)
export const CruxArtifactKindSchema = z.union([
  CruxCanonicalArtifactKindSchema,
  CruxCustomArtifactKindSchema,
]) satisfies z.ZodType<CruxArtifactKind>

const customMetricPrefixed = (value: string) => value.startsWith('custom.') && value.length > 'custom.'.length

export const CruxAttributesSchema = z.record(z.string(), z.unknown())
export const CruxMetricKeySchema = z.union([
  z.enum(CRUX_TOKEN_METRIC_KEYS),
  z.enum(CRUX_GENERATION_METRIC_KEYS),
  z
    .string()
    .refine(customMetricPrefixed, { message: 'Custom metric keys must use the custom.* namespace' })
    .transform((value) => value as `custom.${string}`),
]) satisfies z.ZodType<CruxMetricKey>
export const CruxMetricsSchema = z.partialRecord(CruxMetricKeySchema, z.number())

export const CruxSourceLocationSchema = z.object({
  file: nonEmptyString,
  line: z.number().int().positive(),
  column: z.number().int().positive().optional(),
  function: nonEmptyString.optional(),
})

export const DefinitionRefRoleSchema = z.enum([
  'resolved-prompt',
  'resolved-context',
  'invoked-tool',
  'invoked-agent',
  'invoked-flow',
  'invoked-retriever',
  'invoked-composition',
  'invoked-blackboard',
]) satisfies z.ZodType<DefinitionRefRole>

export const SanitizedSourceRefSchema = z.object({
  file: nonEmptyString,
  line: z.number().int().positive(),
  column: z.number().int().positive().optional(),
}) satisfies z.ZodType<SanitizedSourceRef>

export const DefinitionRefSchema = z.object({
  id: nonEmptyString,
  kind: ProjectDefinitionKindSchema,
  role: DefinitionRefRoleSchema,
  source: SanitizedSourceRefSchema.optional(),
}) satisfies z.ZodType<DefinitionRef>

export const CruxErrorSummarySchema = z.object({
  message: nonEmptyString,
  name: nonEmptyString.optional(),
  category: nonEmptyString.optional(),
  retryable: z.boolean().optional(),
  statusCode: z.number().int().optional(),
})

const CruxRecordBaseSchema = z.object({
  schemaVersion: z.literal(CRUX_OBSERVABILITY_SCHEMA_VERSION),
  recordId: CruxRecordIdSchema,
  runId: CruxRunIdSchema,
  segmentId: CruxSegmentIdSchema,
  segmentSeq: z.number().int().positive(),
  sessionId: z.string().optional(),
  userId: z.string().optional(),
  traceId: CruxTraceIdSchema.optional(),
})

export const CruxRunStartRecordSchema = CruxRecordBaseSchema.extend({
  type: z.literal('run:start'),
  name: nonEmptyString,
  rootPrimitive: CruxPrimitiveNameSchema,
  startedAt: isoTimestamp,
  status: z.literal('running'),
  attributes: CruxAttributesSchema.optional(),
  source: CruxSourceLocationSchema.optional(),
  definitionRefs: z.array(DefinitionRefSchema).optional(),
}).refine((record) => record.segmentSeq === 1, {
  message: 'run:start must be the first record in its segment',
  path: ['segmentSeq'],
})

export const CruxRunSuspendRecordSchema = CruxRecordBaseSchema.extend({
  type: z.literal('run:suspend'),
  suspendedAt: isoTimestamp,
  reason: nonEmptyString,
  attributes: CruxAttributesSchema.optional(),
})

export const CruxRunResumeRecordSchema = CruxRecordBaseSchema.extend({
  type: z.literal('run:resume'),
  resumedAt: isoTimestamp,
  reason: nonEmptyString,
  previousSegmentId: CruxSegmentIdSchema.optional(),
  attributes: CruxAttributesSchema.optional(),
}).refine((record) => record.segmentSeq === 1, {
  message: 'run:resume must be the first record in its segment',
  path: ['segmentSeq'],
})

export const CruxRunEndRecordSchema = CruxRecordBaseSchema.extend({
  type: z.literal('run:end'),
  endedAt: isoTimestamp,
  durationMs: z.number().nonnegative().optional(),
  status: CruxTerminalRunStatusSchema,
  metrics: CruxMetricsSchema.optional(),
  error: CruxErrorSummarySchema.optional(),
  attributes: CruxAttributesSchema.optional(),
})

export const CruxSpanStartRecordSchema = CruxRecordBaseSchema.extend({
  type: z.literal('span:start'),
  spanId: CruxSpanIdSchema,
  parentSpanId: CruxSpanIdSchema.nullable().optional(),
  family: CruxPrimitiveFamilySchema,
  primitive: CruxPrimitiveNameSchema,
  name: nonEmptyString,
  startedAt: isoTimestamp,
  status: z.literal('running'),
  model: nonEmptyString.optional(),
  provider: nonEmptyString.optional(),
  promptId: nonEmptyString.optional(),
  contextId: nonEmptyString.optional(),
  agentId: nonEmptyString.optional(),
  toolName: nonEmptyString.optional(),
  flowId: nonEmptyString.optional(),
  stepId: nonEmptyString.optional(),
  memoryId: nonEmptyString.optional(),
  retrieverId: nonEmptyString.optional(),
  attributes: CruxAttributesSchema.optional(),
  source: CruxSourceLocationSchema.optional(),
  definitionRefs: z.array(DefinitionRefSchema).optional(),
}).refine((record) => CRUX_PRIMITIVE_FAMILY_BY_NAME[record.primitive] === record.family, {
  message: 'Span family must match primitive family',
  path: ['family'],
})

export const CruxSpanEndRecordSchema = CruxRecordBaseSchema.extend({
  type: z.literal('span:end'),
  spanId: CruxSpanIdSchema,
  endedAt: isoTimestamp,
  durationMs: z.number().nonnegative().optional(),
  status: CruxTerminalSpanStatusSchema,
  metrics: CruxMetricsSchema.optional(),
  error: CruxErrorSummarySchema.optional(),
  attributes: CruxAttributesSchema.optional(),
})

export const CruxSpanRecordSchema = CruxRecordBaseSchema.extend({
  type: z.literal('span'),
  spanId: CruxSpanIdSchema,
  parentSpanId: CruxSpanIdSchema.nullable().optional(),
  family: CruxPrimitiveFamilySchema,
  primitive: CruxPrimitiveNameSchema,
  name: nonEmptyString,
  startedAt: isoTimestamp,
  endedAt: isoTimestamp.optional(),
  durationMs: z.number().nonnegative().optional(),
  status: CruxTerminalSpanStatusSchema,
  metrics: CruxMetricsSchema.optional(),
  error: CruxErrorSummarySchema.optional(),
  attributes: CruxAttributesSchema.optional(),
  source: CruxSourceLocationSchema.optional(),
  definitionRefs: z.array(DefinitionRefSchema).optional(),
}).refine((record) => CRUX_PRIMITIVE_FAMILY_BY_NAME[record.primitive] === record.family, {
  message: 'Span family must match primitive family',
  path: ['family'],
})

export const CruxSpanEventRecordSchema = CruxRecordBaseSchema.extend({
  type: z.literal('span:event'),
  spanId: CruxSpanIdSchema,
  eventId: CruxSpanEventIdSchema,
  name: nonEmptyString,
  timestamp: isoTimestamp,
  attributes: CruxAttributesSchema.optional(),
})

export const CruxGraphNodeRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('run'), id: CruxRunIdSchema }),
  z.object({ kind: z.literal('span'), id: CruxSpanIdSchema }),
  z.object({ kind: z.literal('artifact'), id: CruxArtifactIdSchema }),
])

export const CruxEdgeRecordSchema = CruxRecordBaseSchema.extend({
  type: z.literal('edge'),
  edgeId: CruxEdgeIdSchema,
  edgeType: CruxEdgeTypeSchema,
  from: CruxGraphNodeRefSchema,
  to: CruxGraphNodeRefSchema,
  createdAt: isoTimestamp,
  attributes: CruxAttributesSchema.optional(),
})

export const CruxArtifactRecordSchema = CruxRecordBaseSchema.extend({
  type: z.literal('artifact'),
  artifactId: CruxArtifactIdSchema,
  spanId: CruxSpanIdSchema.optional(),
  kind: CruxArtifactKindSchema,
  createdAt: isoTimestamp,
  contentType: nonEmptyString,
  encoding: z.enum(['json', 'text', 'bytes', 'reference']),
  sizeBytes: z.number().int().nonnegative().optional(),
  hash: nonEmptyString.optional(),
  preview: z.unknown().optional(),
  uri: nonEmptyString.optional(),
  attributes: CruxAttributesSchema.optional(),
})

export const CruxGraphRecordSchema = z.discriminatedUnion('type', [
  CruxRunStartRecordSchema,
  CruxRunSuspendRecordSchema,
  CruxRunResumeRecordSchema,
  CruxRunEndRecordSchema,
  CruxSpanStartRecordSchema,
  CruxSpanEndRecordSchema,
  CruxSpanRecordSchema,
  CruxSpanEventRecordSchema,
  CruxEdgeRecordSchema,
  CruxArtifactRecordSchema,
])

export const CruxGraphRecordBatchSchema = z.object({
  records: z.array(CruxGraphRecordSchema),
})

export type ParsedCruxGraphRecord = z.infer<typeof CruxGraphRecordSchema>
export type ParsedCruxGraphRecordBatch = z.infer<typeof CruxGraphRecordBatchSchema>
