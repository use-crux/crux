import { safeId } from '../definitions'
import type { CatalogExtractor } from '../extensions'
import { facts } from '../extensions'

/**
 * Extracts workspace definitions and their mount/write-policy intelligence.
 *
 * Workspaces are cataloged as authored state/resources. The extractor records mount metadata and
 * writable/read-only posture so lint rules and detail views can reason about guardrails.
 */
export const workspaceCatalogExtractor: CatalogExtractor = {
  name: 'workspace',
  patterns: [{ kind: 'call', name: 'workspace' }],
  extract: (ctx) => {
    if (ctx.match.name !== 'workspace') return { kind: 'none' }
    const explicitId = ctx.config?.string('id')
    const localId = explicitId ?? ctx.source.localName
    const id = `workspace:${safeId(localId)}`
    const toolRefs = ctx.config?.objectMapIdentifiers('tools') ?? []
    const mounts = workspaceMountsMetadata(ctx.config?.objectArray('mounts') ?? [])
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
            toolRefs: toolRefs.length > 0 ? toolRefs : undefined,
            hasBlobStorage: ctx.config ? ctx.config.has('blobs') || ctx.config.has('storage') : undefined,
            intelligence: workspaceIntelligence(mounts, toolRefs),
          },
        }),
      ],
      references: [
        ...toolRefs.map((toVariable) => ctx.ref.variable('workspace.exposes_tool', toVariable)),
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

/** Converts authored mount objects into JSON-like metadata suitable for catalog consumers. */
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

/**
 * Builds structured workspace intelligence for detail views and lints.
 *
 * The payload separates mount topology from access policy so downstream consumers do not need to parse
 * free-form metadata.
 */
function workspaceIntelligence(
  mounts: Array<Record<string, unknown>> | undefined,
  toolRefs: readonly string[],
): Record<string, unknown> | undefined {
  if ((!mounts || mounts.length === 0) && toolRefs.length === 0) return undefined
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
  }
}
