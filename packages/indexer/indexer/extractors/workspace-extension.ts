import { safeId } from '../definitions'
import type { DependencyFacts } from '@use-crux/core/project-index'
import type { IndexExtractor } from '../extensions'
import { facts } from '../extensions'
import { storageConfigReferences, storageDependencyFacts, storageRelationRefs } from './storage-dependencies'

/**
 * Extracts workspace definitions and their mount/write-policy intelligence.
 *
 * Workspaces are indexed as authored state/resources. The extractor records mount metadata and
 * writable/read-only posture so lint rules and detail views can reason about guardrails.
 */
export const workspaceIndexExtractor: IndexExtractor = {
  name: 'workspace',
  patterns: [{ kind: 'call', name: 'workspace' }],
  extract: (ctx) => {
    if (ctx.match.name !== 'workspace') return { kind: 'none' }
    const explicitId = ctx.config?.string('id')
    const localId = explicitId ?? ctx.source.localName
    const id = `workspace:${safeId(localId)}`
    const toolRefs = ctx.config?.objectMapIdentifiers('tools') ?? []
    const mounts = workspaceMountsMetadata(ctx.config?.objectArray('mounts') ?? [])
    const tools = workspaceToolsMetadata(ctx.config?.object('tools'))
    const limits = workspaceLimitsMetadata(ctx.config?.object('limits'))
    const retention = workspaceRetentionMetadata(ctx.config?.object('retention'))
    const storageRefs = storageConfigReferences(ctx.config)
    const storageDependencies = storageDependencyFacts(storageRefs)
    return facts({
      definitions: [
        ctx.define.definition({
          variableName: ctx.source.variableName,
          id,
          kind: 'workspace',
          name: explicitId ?? ctx.source.variableName,
          metadata: {
            exportName: ctx.source.variableName,
            namespace: ctx.config?.string('namespace'),
            mounts,
            hasTools: ctx.config?.has('tools'),
            tools,
            toolRefs: toolRefs.length > 0 ? toolRefs : undefined,
            limits,
            retention,
            hasBlobStorage: ctx.config ? ctx.config.has('blobs') || ctx.config.has('storage') : undefined,
            intelligence: workspaceIntelligence(mounts, toolRefs, { limits, retention }, storageDependencies),
          },
        }),
      ],
      references: [
        ...toolRefs.map((toVariable) => ctx.ref.variable('workspace.exposes_tool', toVariable)),
        ...storageRelationRefs('workspace', storageRefs),
        ...(mounts ?? []).flatMap((mount) =>
          typeof mount.path === 'string'
            ? [
                ctx.ref.id(
                  'workspace.mounts_path',
                  `workspace.path:${safeId(localId)}:${safeId(mount.path)}`,
                ),
              ]
            : [],
        ),
      ],
    })
  },
}

/** Converts authored mount objects into JSON-like metadata suitable for index consumers. */
function workspaceMountsMetadata(
  mounts: readonly { readonly string: (property: string) => string | undefined }[],
): Array<Record<string, unknown>> | undefined {
  const metadata = mounts
    .map((mount) => ({
      path: mount.string('path'),
      access: mount.string('access'),
      description: mount.string('description'),
    }))
    .filter((mount) => mount.path || mount.access || mount.description)
  return metadata.length > 0 ? metadata : undefined
}

/** Reads the public `limits` workspace config into operator-facing metadata. */
function workspaceLimitsMetadata(
  limits: { readonly number: (property: string) => number | undefined } | undefined,
): Record<string, number> | undefined {
  if (!limits) return undefined
  const metadata = {
    maxFileBytes: limits.number('maxFileBytes'),
    maxNamespaceBytes: limits.number('maxNamespaceBytes'),
  }
  return compactNumberMetadata(metadata)
}

/** Reads the public `retention` workspace config into operator-facing metadata. */
function workspaceRetentionMetadata(
  retention: { readonly number: (property: string) => number | undefined } | undefined,
): Record<string, number> | undefined {
  if (!retention) return undefined
  return compactNumberMetadata({ ttlMs: retention.number('ttlMs') })
}

function compactNumberMetadata(metadata: Record<string, number | undefined>): Record<string, number> | undefined {
  const entries = Object.entries(metadata).filter((entry): entry is [string, number] => typeof entry[1] === 'number')
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

/** Projects generated workspace tool names from the authored `tools` config. */
function workspaceToolsMetadata(
  tools: {
    readonly string: (property: string) => string | undefined
    readonly boolean: (property: string) => boolean | undefined
  } | undefined,
): Record<string, unknown> | undefined {
  if (!tools) return undefined
  const prefix = tools.string('prefix')
  const deleteEnabled = tools.boolean('delete') === true
  return {
    ...(prefix ? { prefix } : {}),
    ...(deleteEnabled ? { delete: true } : {}),
    generated: workspaceGeneratedToolNames(prefix, deleteEnabled),
  }
}

function workspaceGeneratedToolNames(prefix: string | undefined, deleteEnabled: boolean): Record<string, string> {
  const part = prefix ? `${prefix[0]?.toUpperCase() ?? ''}${prefix.slice(1)}` : ''
  return {
    list: `list${part}Workspace`,
    readFile: `read${part}WorkspaceFile`,
    writeFile: `write${part}WorkspaceFile`,
    editFile: `edit${part}WorkspaceFile`,
    renameFile: `rename${part}WorkspaceFile`,
    grep: `grep${part}Workspace`,
    ...(deleteEnabled ? { deleteFile: `delete${part}WorkspaceFile` } : {}),
  }
}

/**
 * Builds structured workspace intelligence for detail views and lints.
 *
 * The payload separates mount topology from access policy so downstream consumers do not need to parse
 * free-form metadata.
 */
function workspaceIntelligence(
  mounts: Array<Record<string, unknown>> | undefined,
  toolRefs: readonly string[],
  operator: {
    readonly limits?: Record<string, number>
    readonly retention?: Record<string, number>
  },
  dependencies: DependencyFacts | undefined,
): Record<string, unknown> | undefined {
  const hasOperator = operator.limits !== undefined || operator.retention !== undefined
  const hasDependencies = dependencies !== undefined && Object.keys(dependencies).length > 0
  if ((!mounts || mounts.length === 0) && toolRefs.length === 0 && !hasOperator && !hasDependencies) return undefined
  return {
    confidence: 'static',
    data: {
      ...(mounts && mounts.length > 0
        ? {
            artifacts: mounts
              .filter((mount): mount is { path: string; access?: string } => typeof mount.path === 'string')
              .map((mount) => ({ name: mount.path, kind: mount.access ?? 'mount' })),
          }
        : {}),
    },
    ...(toolRefs.length > 0 ? { tools: [...toolRefs] } : {}),
    ...(dependencies ? { dependencies } : {}),
    ...(hasOperator ? { operator } : {}),
  }
}
