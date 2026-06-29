import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { STORE_DOC_COMPONENT_SPEC } from '../../store-doc/manifest'

export default defineSchema({
  [STORE_DOC_COMPONENT_SPEC.table]: defineTable({
    key: v.string(),
    content: v.string(),
    metadata: v.optional(v.any()),
    embedding: v.optional(v.array(v.float64())),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index(STORE_DOC_COMPONENT_SPEC.indexes.byKey, [STORE_DOC_COMPONENT_SPEC.fields.key]),

  swarmRuns: defineTable({
    swarmRunId: v.string(),
    currentAgentId: v.string(),
    handoffPath: v.array(v.string()),
    handoffCount: v.number(),
    currentInput: v.any(),
    originalInput: v.any(),
    status: v.union(v.literal('running'), v.literal('completed'), v.literal('error')),
    output: v.optional(v.any()),
    error: v.optional(v.string()),
    flowId: v.string(),
    sessionId: v.optional(v.string()),
    observability: v.optional(v.any()),
    maxHandoffs: v.number(),
    history: v.union(v.literal('transfer-only'), v.literal('accumulate')),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_run_id', ['swarmRunId'])
    .index('by_status', ['status'])
    .index('by_session', ['sessionId']),
})
