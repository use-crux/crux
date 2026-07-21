/** Compile-time separation between Core and AI SDK tool-output dialects. */

import { tool as aiTool, type Tool as AiTool } from 'ai'
import { tool as cruxTool } from '@use-crux/core'
import type { ToolDef as CruxTool } from '@use-crux/core/tools'
import { z } from 'zod'

cruxTool({
  description: 'Core-native output',
  execute: async () => 'result',
  toModelOutput: () => ({
    type: 'content',
    value: [{ type: 'image', source: 'data:image/png;base64,AQID' }],
  }),
})

type CruxToModelOutput = NonNullable<
  CruxTool<Record<string, never>, string>['toModelOutput']
>
type CruxModelOutput = Awaited<ReturnType<CruxToModelOutput>>
type CruxContentPart = Extract<CruxModelOutput, { type: 'content' }>['value'][number]

// Keep this declaration on one line so supported TypeScript versions attach the diagnostic consistently.
// @ts-expect-error Core callbacks reject AI SDK-native content parts.
const invalidCruxPart: CruxContentPart = { type: 'image-data', data: 'AQID', mediaType: 'image/png' }

void invalidCruxPart

aiTool({
  description: 'AI SDK-native output',
  inputSchema: z.object({}),
  execute: async () => 'result',
  toModelOutput: () => ({
    type: 'content',
    value: [{ type: 'image-data', data: 'AQID', mediaType: 'image/png' }],
  }),
})

type AiToModelOutput = NonNullable<
  AiTool<unknown, string>['toModelOutput']
>
type AiModelOutput = Awaited<ReturnType<AiToModelOutput>>
type AiContentPart = Extract<AiModelOutput, { type: 'content' }>['value'][number]

// Keep this declaration on one line so supported TypeScript versions attach the diagnostic consistently.
// @ts-expect-error AI SDK callbacks reject Core-native content parts.
const invalidAiPart: AiContentPart = { type: 'image', source: 'data:image/png;base64,AQID' }

void invalidAiPart
