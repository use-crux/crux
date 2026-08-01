/**
 * Validation helpers for generated community reports.
 *
 * @module
 */

import { z } from 'zod'

export const communityReportOutputSchema = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().max(2_000),
  findings: z.array(z.object({
    id: z.string().min(1).optional(),
    statement: z.string().min(1).max(500),
    evidence: z.array(z.union([
      z.object({ kind: z.literal('document'), sourceId: z.string() }).strict(),
      z.object({ kind: z.literal('parent'), sourceId: z.string(), parentId: z.string() }).strict(),
      z.object({ kind: z.literal('chunk'), sourceId: z.string(), chunkId: z.string() }).strict(),
      z.object({ kind: z.literal('entity'), entityId: z.string() }).strict(),
    ])).min(1),
    assertionRefs: z.array(z.object({ assertionId: z.string().min(1) }).strict()).optional(),
  }).strict()).default([]),
}).strict()

export type CommunityReportOutput = z.infer<typeof communityReportOutputSchema>
