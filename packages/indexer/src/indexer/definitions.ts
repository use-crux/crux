import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import type { ProjectDefinition, ProjectDefinitionKind, ProjectRelation } from '@use-crux/core/project-index'
import { sourceForFile, sourceSnippet } from './ast/snippets'
import { projectRelation } from './relations'

export async function definition(
  root: string,
  file: string,
  id: string,
  kind: ProjectDefinitionKind,
  name: string,
  description: string | undefined,
  metadata: Record<string, unknown>,
): Promise<ProjectDefinition> {
  const source = sourceForFile(file)
  return {
    id,
    kind,
    name,
    description,
    source,
    sourceSnippet: await sourceSnippet(root, file),
    fidelity: 'resolved',
    status: 'active',
    fingerprint: fingerprint({
      kind,
      name,
      description,
      metadata,
      file: definitionFingerprintFile(root, file),
    }),
    metadata,
  }
}

export function relation(type: string, from: string, to: string, file: string): ProjectRelation {
  return projectRelation({
    type,
    from,
    to,
    fidelity: 'resolved',
    source: sourceForFile(file),
  })
}

export function safeId(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9_.:-]+/g, '-')
      .replace(/^-+|-+$/g, '') || fingerprint(value)
  )
}

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
}

/** Normalizes source identity so definition fingerprints survive checkout moves. */
export function definitionFingerprintFile(root: string, file: string): string {
  const normalizedRoot = posix.normalize(root.replaceAll('\\', '/')).replace(/\/$/, '')
  const normalizedFile = posix.normalize(file.replaceAll('\\', '/'))
  if (normalizedFile === normalizedRoot) return '.'
  if (normalizedFile.startsWith(`${normalizedRoot}/`)) {
    return normalizedFile.slice(normalizedRoot.length + 1)
  }
  return normalizedFile.replace(/^\.\//, '')
}
