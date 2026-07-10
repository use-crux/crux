import { observe } from '../observability'
import type { JsonObject } from '../storage'
import type { FetchedRegistrySkill } from './registry-fetch'

/**
 * Record the loaded skill payload as an observability artifact linked to the load span.
 */
export function emitRegistrySkillArtifact(
  spanId: ReturnType<typeof observe.openSpan>['spanId'],
  identifier: string,
  source: string,
  result: FetchedRegistrySkill,
): void {
  const artifactId = observe.artifact({
    kind: 'output',
    contentType: 'application/json',
    encoding: 'json',
    preview: {
      primitive: 'skill.load',
      loader: 'registry',
      source,
      identifier,
      skillId: result.meta.name,
      description: result.meta.description,
      instructionPreview: result.instructions.slice(0, 500),
      references: result.references.map((reference) => ({
        name: reference.name,
        contentPreview: reference.content.slice(0, 200),
      })),
      meta: {
        name: result.meta.name,
        description: result.meta.description,
        ...(result.meta.version ? { version: result.meta.version } : {}),
        ...(result.meta.license ? { license: result.meta.license } : {}),
        ...(result.meta.tags ? { tags: [...result.meta.tags] } : {}),
      },
    } satisfies JsonObject,
    attributes: {
      primitive: 'skill.load',
      loader: 'registry',
      source,
      identifier,
      skillId: result.meta.name,
      referenceCount: result.references.length,
      instructionChars: result.instructions.length,
      tags: result.meta.tags,
      version: result.meta.version,
    },
  })
  if (!artifactId) return
  observe.edge({
    edgeType: 'produced',
    from: { kind: 'span', id: spanId },
    to: { kind: 'artifact', id: artifactId },
    attributes: { primitive: 'skill.load', loader: 'registry', source, identifier, skillId: result.meta.name },
  })
}
