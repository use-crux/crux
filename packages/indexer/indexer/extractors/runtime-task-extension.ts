import { facts, type IndexExtractor } from '../extensions'

/** Extracts executable Runtime Engine `task(...)` targets from `@use-crux/core/runtime`. */
export const runtimeTaskIndexExtractor: IndexExtractor = {
  name: 'runtime.task',
  patterns: [{ kind: 'call', name: 'task', importFrom: ['@use-crux/core/runtime'] }],
  extract: (ctx) => {
    const explicitName = ctx.args.string(0)
    if (!explicitName) return { kind: 'none' }
    const id = `task:${ctx.source.safeId(explicitName)}`
    return facts({
      definitions: [
        ctx.define.definition({
          variableName: ctx.source.variableName,
          id,
          kind: 'task',
          name: explicitName,
          metadata: {
            exportName: ctx.source.variableName,
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
