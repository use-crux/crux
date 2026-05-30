import { createHash } from 'node:crypto'
import type { ProjectDefinition, ProjectDefinitionKind, ProjectRelation } from '@crux/core/catalog'
import { sourceForFile, sourceSnippet } from './ast/snippets'
import { projectRelation } from './relation-registry'

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
    fingerprint: fingerprint({ kind, name, description, metadata, file }),
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
  return value.trim().replace(/[^a-zA-Z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, '') || fingerprint(value)
}

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
}
