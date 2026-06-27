import type { InjectionUseFacts } from '@use-crux/core/project-index'
import type { ExtractedFacts } from '../../../extensions'
import type { StaticFunctionValue, StaticObjectValue, StaticSyntaxFileRecord, StaticSyntaxValue } from './types'
import {
  createStaticSyntaxInitializerMap,
  resolveStaticSyntaxValue,
  staticObjectPropertyValue,
} from './value'

/** Derives partial prompt injection facts from Convex runtime prepare helpers in syntax records. */
export function staticRecordRuntimePrepareFacts(record: StaticSyntaxFileRecord): ExtractedFacts[] {
  const functions = new Map(
    record.localInitializers.flatMap((initializer): readonly [string, StaticFunctionValue][] =>
      initializer.value.kind === 'function' ? [[initializer.name, initializer.value]] : [],
    ),
  )
  const facts: ExtractedFacts[] = []
  for (const fn of functions.values()) {
    const promptVariable = preparePromptVariable(fn)
    if (!promptVariable) continue
    const returned = returnedObjects(fn)
    for (const object of returned) {
      const useValue = staticObjectPropertyValue(object, 'use')
      const helperCall = useValue?.kind === 'call' ? useValue : undefined
      const helperName = helperCall?.callee.localName ?? helperCall?.callee.name
      const helper = helperName ? functions.get(helperName) : undefined
      if (!helper) continue
      const useEntries = runtimeUseEntriesFromHelper(helper)
      if (useEntries.length === 0) continue
      facts.push({
        definitions: [
          {
            variableName: `runtimePrepare:${promptVariable}`,
            definition: {
              id: `prompt:${safeRuntimeId(promptVariable)}`,
              kind: 'prompt',
              name: promptVariable,
              fidelity: 'partial',
              status: 'active',
              metadata: {
                facts: {
                  kind: 'prompt',
                  useEntries,
                },
              },
            },
          },
        ],
      })
    }
  }
  return facts
}

function returnedObjects(fn: StaticFunctionValue): readonly StaticObjectValue[] {
  return fn.returns.flatMap((value): readonly StaticObjectValue[] => {
    if (value.kind === 'object') return [value]
    if (value.kind === 'function') return returnedObjects(value)
    return []
  })
}

function runtimeUseEntriesFromHelper(fn: StaticFunctionValue): readonly InjectionUseFacts[] {
  const initializers = createStaticSyntaxInitializerMap(fn.localInitializers)
  return fn.returns.flatMap((value): readonly InjectionUseFacts[] => {
    const resolved = resolveStaticSyntaxValue(value, initializers)
    return resolved?.kind === 'array'
      ? resolved.elements.map((element) => runtimeUseEntry(runtimeVariableName(element), {
          conditionality: 'dynamic',
          via: 'runtime',
        }))
      : []
  })
}

function runtimeVariableName(value: StaticSyntaxValue): string {
  if (value.kind === 'property-access') return value.path.join('.')
  if (value.kind === 'identifier') return value.name
  return '<dynamic>'
}

function runtimeUseEntry(
  variable: string,
  defaults: Pick<InjectionUseFacts, 'conditionality' | 'via'>,
): InjectionUseFacts {
  return {
    variable,
    relationHint: runtimeRelationHint(variable),
    ...defaults,
  }
}

function runtimeRelationHint(variable: string): InjectionUseFacts['relationHint'] {
  const lower = variable.toLowerCase()
  if (lower.includes('memory')) return 'memory'
  if (lower.includes('blackboard')) return 'blackboard'
  return 'unknown'
}

function preparePromptVariable(fn: StaticFunctionValue): string | undefined {
  const text = fn.snippet?.source
  return text?.match(/ConvexAgentPrepare(?:Args|Result)<typeof\s+([A-Za-z_$][\w$]*)>/)?.[1]
}

function safeRuntimeId(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .toLowerCase()
}
