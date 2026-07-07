import { facts, type IndexExtractor } from '../extensions'

/** Extracts executable Runtime Engine `durableTask(...)` targets. */
export const runtimeTaskIndexExtractor: IndexExtractor = {
  name: 'runtime.task',
  patterns: [{ kind: 'call', name: 'durableTask', importFrom: ['@use-crux/core', '@use-crux/core/runtime'] }],
  extract: (ctx) => {
    const explicitName = ctx.args.string(0)
    const targetName = explicitName ?? ctx.source.variableName
    const id = `task:${ctx.source.safeId(explicitName ?? ctx.source.localName)}`
    return facts({
      definitions: [
        ctx.define.definition({
          variableName: ctx.source.variableName,
          id,
          kind: 'task',
          name: targetName,
          metadata: {
            exportName: ctx.source.variableName,
            runtimeTarget: {
              kind: 'task',
              nameLiteral: explicitName !== undefined,
              exported: ctx.source.exported === true,
            },
            facts: {
              kind: 'task',
              runtime: true,
            },
            intelligence: {
              confidence: 'static',
              control: {
                mode: 'durable',
              },
            },
          },
        }),
      ],
      sourceRefs: [
        ctx.sourceRef.callbackProperty({
          property: 'run',
          role: 'execute',
          definitionId: id,
        }),
      ].filter(isDefined),
    })
  },
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}
