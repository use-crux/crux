import type { IndexLintFinding, ProjectDefinition } from '@use-crux/core/project-index'
import { definitionEvidence, isRecord } from './finding-helpers'
import { indexLintFinding } from './rules'

/** Built-in lint findings for Runtime Engine target authoring hazards. */
export function runtimeLintFindings(
  definitions: readonly ProjectDefinition[],
  options: { readonly runtimeConfigured?: boolean } = {},
): IndexLintFinding[] {
  const targets = runtimeTargetDefinitions(definitions)
  const flows = definitions.filter((definition) => definition.kind === 'flow')
  return [
    ...duplicateTargetNameFindings(targets),
    ...nonLiteralTargetNameFindings(targets),
    ...targetNotExportedFindings(targets),
    ...closureDeferFindings(flows),
    ...missingRuntimeConfigFindings(flows, options.runtimeConfigured),
    ...nondeterministicCodeFindings(flows),
    ...nonSerializablePayloadFindings(flows),
  ]
}

interface RuntimeTargetDefinition {
  readonly definition: ProjectDefinition
  readonly kind: 'flow' | 'task'
  readonly nameLiteral: boolean
  readonly exported: boolean
}

function duplicateTargetNameFindings(targets: readonly RuntimeTargetDefinition[]): IndexLintFinding[] {
  const byName = new Map<string, RuntimeTargetDefinition[]>()
  for (const target of targets) {
    const list = byName.get(target.definition.name) ?? []
    list.push(target)
    byName.set(target.definition.name, list)
  }

  return [...byName.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([name, items]) => {
      const definitions = items.map((item) => item.definition)
      const primary = definitions[0]
      return indexLintFinding({
        ruleId: 'runtime.duplicate_target_name',
        key: name,
        message: `Runtime target name "${name}" is used by ${definitions.length} flow/task declarations. Durable target names must be unique.`,
        ...(primary?.source ? { source: primary.source } : {}),
        primaryDefinitionId: primary?.id,
        relatedDefinitionIds: definitions.map((definition) => definition.id),
        evidence: definitions.map((definition) =>
          definitionEvidence(definition, 'Runtime target shares this durable name'),
        ),
      })
    })
}

function nonLiteralTargetNameFindings(targets: readonly RuntimeTargetDefinition[]): IndexLintFinding[] {
  return targets
    .filter((target) => !target.nameLiteral)
    .map((target) =>
      indexLintFinding({
        ruleId: 'runtime.non_literal_target_name',
        key: target.definition.id,
        message: `${runtimeTargetLabel(target)} does not use a literal durable target name. Use a literal string so Crux can generate stable runtime artifacts.`,
        ...(target.definition.source ? { source: target.definition.source } : {}),
        primaryDefinitionId: target.definition.id,
        relatedDefinitionIds: [target.definition.id],
        evidence: [definitionEvidence(target.definition, 'Runtime target name is not a literal string')],
      }),
    )
}

function targetNotExportedFindings(targets: readonly RuntimeTargetDefinition[]): IndexLintFinding[] {
  return targets
    .filter((target) => !target.exported)
    .map((target) =>
      indexLintFinding({
        ruleId: 'runtime.target_not_exported',
        key: target.definition.id,
        message: `${runtimeTargetLabel(target)} is not a top-level exported declaration. Generated runtime entries can only import named exports.`,
        ...(target.definition.source ? { source: target.definition.source } : {}),
        primaryDefinitionId: target.definition.id,
        relatedDefinitionIds: [target.definition.id],
        evidence: [definitionEvidence(target.definition, 'Runtime target is not exported')],
      }),
    )
}

function closureDeferFindings(flows: readonly ProjectDefinition[]): IndexLintFinding[] {
  return flows.flatMap((flow) =>
    runtimeUsages(flow)
      .filter((usage) => usage.method === 'defer' && usage.closureTarget === true)
      .map((usage, index) =>
        indexLintFinding({
          ruleId: 'runtime.closure_defer',
          key: `${flow.id}:defer:${index}`,
          message: `Flow "${flow.name}" passes an inline closure to flow.defer(). Durable background work must use an exported runtime task target.`,
          ...(sourceLocation(usage) ? { source: sourceLocation(usage) } : flow.source ? { source: flow.source } : {}),
          primaryDefinitionId: flow.id,
          relatedDefinitionIds: [flow.id],
          evidence: [
            definitionEvidence(flow, 'Flow uses flow.defer with an inline closure target'),
            runtimeUsageEvidence(flow, usage, 'Inline defer closure'),
          ],
        }),
      ),
  )
}

function missingRuntimeConfigFindings(
  flows: readonly ProjectDefinition[],
  runtimeConfigured: boolean | undefined,
): IndexLintFinding[] {
  if (runtimeConfigured !== false) return []
  return flows
    .filter((flow) => runtimeUsages(flow).length > 0)
    .map((flow) =>
      indexLintFinding({
        ruleId: 'runtime.missing_runtime_config',
        key: flow.id,
        message: `Flow "${flow.name}" uses runtime-bound APIs, but this project has no runtime configured.`,
        ...(flow.source ? { source: flow.source } : {}),
        primaryDefinitionId: flow.id,
        relatedDefinitionIds: [flow.id],
        evidence: [
          definitionEvidence(flow, 'Flow uses runtime-bound APIs without runtime config'),
          {
            kind: 'definition',
            label: 'Runtime-bound API calls',
            definitionId: flow.id,
            source: flow.source,
            data: { methods: runtimeUsages(flow).map((usage) => usage.method) },
          },
        ],
      }),
    )
}

function nondeterministicCodeFindings(flows: readonly ProjectDefinition[]): IndexLintFinding[] {
  return flows.flatMap((flow) =>
    nondeterministicCalls(flow).map((call, index) =>
      indexLintFinding({
        ruleId: 'flow.nondeterministic_code',
        key: `${flow.id}:${call.expression}:${index}`,
        message: `Flow "${flow.name}" calls ${call.expression} outside flow.step(). Move nondeterministic reads behind a replayed step.`,
        ...(sourceLocation(call) ? { source: sourceLocation(call) } : flow.source ? { source: flow.source } : {}),
        primaryDefinitionId: flow.id,
        relatedDefinitionIds: [flow.id],
        evidence: [
          definitionEvidence(flow, 'Flow contains nondeterministic code'),
          {
            kind: 'definition',
            label: 'Nondeterministic call',
            definitionId: flow.id,
            source: sourceLocation(call) ?? flow.source,
            data: { expression: call.expression },
          },
        ],
      }),
    ),
  )
}

function nonSerializablePayloadFindings(flows: readonly ProjectDefinition[]): IndexLintFinding[] {
  return flows.flatMap((flow) =>
    runtimeUsages(flow)
      .filter((usage) => typeof usage.nonSerializablePayload === 'string')
      .map((usage, index) =>
        indexLintFinding({
          ruleId: 'runtime.non_serializable_payload',
          key: `${flow.id}:${usage.method}:payload:${index}`,
          message: `Flow "${flow.name}" passes a non-JSON ${usage.nonSerializablePayload} payload to flow.${usage.method}(). Durable payloads must be JSON-serializable.`,
          ...(sourceLocation(usage) ? { source: sourceLocation(usage) } : flow.source ? { source: flow.source } : {}),
          primaryDefinitionId: flow.id,
          relatedDefinitionIds: [flow.id],
          evidence: [
            definitionEvidence(flow, 'Flow passes a non-JSON durable payload'),
            runtimeUsageEvidence(flow, usage, 'Non-serializable payload'),
          ],
        }),
      ),
  )
}

function runtimeTargetDefinitions(definitions: readonly ProjectDefinition[]): RuntimeTargetDefinition[] {
  return definitions.flatMap((definition): RuntimeTargetDefinition[] => {
    if (definition.kind !== 'flow' && definition.kind !== 'task') return []
    const runtimeTarget = definition.metadata?.runtimeTarget
    if (!isRecord(runtimeTarget)) return []
    return [
      {
        definition,
        kind: definition.kind,
        nameLiteral: runtimeTarget.nameLiteral === true,
        exported: runtimeTarget.exported === true,
      },
    ]
  })
}

function runtimeTargetLabel(target: RuntimeTargetDefinition): string {
  return `${target.kind} "${target.definition.name}"`
}

function runtimeUsages(definition: ProjectDefinition): RuntimeUsage[] {
  const value = definition.metadata?.runtimeUsages
  return Array.isArray(value) ? value.filter(isRuntimeUsage) : []
}

function nondeterministicCalls(definition: ProjectDefinition): NondeterministicCall[] {
  const value = definition.metadata?.nondeterministicCalls
  return Array.isArray(value) ? value.filter(isNondeterministicCall) : []
}

interface RuntimeUsage {
  readonly method: 'waitFor' | 'defer' | 'after' | 'untilIdle'
  readonly source?: unknown
  readonly closureTarget?: boolean
  readonly nonSerializablePayload?: string
}

interface NondeterministicCall {
  readonly expression: 'Date.now' | 'Math.random' | 'new Date'
  readonly source?: unknown
}

function isRuntimeUsage(value: unknown): value is RuntimeUsage {
  return (
    isRecord(value) &&
    (value.method === 'waitFor' || value.method === 'defer' || value.method === 'after' || value.method === 'untilIdle')
  )
}

function isNondeterministicCall(value: unknown): value is NondeterministicCall {
  return (
    isRecord(value) &&
    (value.expression === 'Date.now' || value.expression === 'Math.random' || value.expression === 'new Date')
  )
}

function runtimeUsageEvidence(
  definition: ProjectDefinition,
  usage: RuntimeUsage,
  label: string,
): IndexLintFinding['evidence'][number] {
  return {
    kind: 'definition',
    label,
    definitionId: definition.id,
    source: sourceLocation(usage) ?? definition.source,
    data: {
      method: usage.method,
      closureTarget: usage.closureTarget,
      nonSerializablePayload: usage.nonSerializablePayload,
    },
  }
}

function sourceLocation(value: { readonly source?: unknown }): IndexLintFinding['source'] | undefined {
  return isRecord(value.source) &&
    typeof value.source.file === 'string' &&
    typeof value.source.line === 'number' &&
    typeof value.source.column === 'number'
    ? {
        file: value.source.file,
        line: value.source.line,
        column: value.source.column,
      }
    : undefined
}
