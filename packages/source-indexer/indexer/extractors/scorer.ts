import { stringProperty } from '../ast/literals'
import { callbackSourceRefForProperty } from '../ast/source-refs'
import type { PrimitiveExtractor } from './types'
import { foundDefinition } from './types'

export const scorerExtractor: PrimitiveExtractor = {
  name: 'scorer',
  capabilities: ['definition', 'source', 'runtime-join', 'partial'],
  callNames: ['llmJudge'],
  extract: (ctx) => {
    if (ctx.callName !== 'llmJudge' || !ctx.objectArg) return undefined
    const explicitId = stringProperty(ctx.objectArg, 'id')
    const id = `scorer:${ctx.safeId(explicitId ?? ctx.localName)}`
    const sourceRefs = ['score', 'evaluate', 'run', 'judge']
      .map((property) => callbackSourceRefForProperty({ ...ctx, object: ctx.objectArg!, property, role: 'validator', definitionId: id }))
      .filter((ref): ref is NonNullable<typeof ref> => Boolean(ref))
    return foundDefinition(
      ctx.variableName,
      {
        ...ctx.define(id, 'scorer', explicitId ?? ctx.variableName, ctx.objectArg, {
          exportName: ctx.variableName,
        }),
        ...(sourceRefs.length > 0 ? { sourceRefs } : {}),
      },
    )
  },
}
