/**
 * File-based skill loader — requires Node.js (fs, path).
 *
 * Separated from loaders.ts so that serverless environments (Convex, edge)
 * can import skill.inline() and skill.fromRegistry() without pulling in
 * Node.js built-ins.
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, dirname, basename, extname } from 'path'
import type { Skill, SkillReference } from './types'
import { SkillLoadError } from './types'
import { parseFrontmatter } from './frontmatter'
import { observe } from '../observability'

/**
 * Load a Skill from a local SKILL.md file.
 * Reads synchronously at import time. Parses YAML frontmatter for metadata.
 * Also detects a sibling references/ directory and loads all .md files from it.
 *
 * Only available in Node.js environments.
 *
 * @param filePath - Path to the SKILL.md file
 * @returns A frozen Skill object
 * @throws SkillLoadError if file not found, unreadable, or frontmatter invalid
 */
export function fileSkill(filePath: string): Skill {
  const sourceId = basename(dirname(filePath))
  const span = observe.openSpan({
    name: 'skill.file.load',
    family: 'skill',
    primitive: 'skill.load',
    attributes: {
      loader: 'file',
      sourceId,
      fileName: basename(filePath),
    },
  })
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf-8')
  } catch (err) {
    span.error(err, { loader: 'file', sourceId, fileName: basename(filePath) })
    throw new SkillLoadError(basename(filePath), `could not read file: ${filePath}`, { cause: err })
  }

  try {
    const { meta, body } = parseFrontmatter(raw, sourceId)

    const dir = dirname(filePath)
    const refsDir = join(dir, 'references')
    let references: readonly SkillReference[] = Object.freeze([])

    try {
      const stat = statSync(refsDir)
      if (stat.isDirectory()) {
        const refFiles = readdirSync(refsDir).filter((f) => extname(f) === '.md')
        references = Object.freeze(
          refFiles.map((f) => {
            const content = readFileSync(join(refsDir, f), 'utf-8')
            const name = basename(f, '.md')
            return Object.freeze({ name, content })
          }),
        )
      }
    } catch {
      // No references directory — that's fine
    }

    const skill = Object.freeze({
      _tag: 'Skill' as const,
      id: meta.name,
      description: meta.description,
      instructions: body,
      references,
      meta,
      dump() {
        return body
      },
    })
    span.withContext(() => emitSkillArtifact(span.spanId, skill))
    span.end({
      loader: 'file',
      sourceId,
      skillId: skill.id,
      referenceCount: references.length,
      instructionChars: body.length,
      tags: meta.tags,
      version: meta.version,
    })
    return skill
  } catch (error) {
    span.error(error, { loader: 'file', sourceId, fileName: basename(filePath) })
    throw error
  }
}

function emitSkillArtifact(spanId: ReturnType<typeof observe.openSpan>['spanId'], skill: Skill): void {
  const artifactId = observe.artifact({
    kind: 'output',
    contentType: 'application/json',
    encoding: 'json',
    preview: {
      primitive: 'skill.load',
      loader: 'file',
      skillId: skill.id,
      description: skill.description,
      instructionPreview: skill.instructions.slice(0, 500),
      references: skill.references.map((reference) => ({
        name: reference.name,
        contentPreview: reference.content.slice(0, 200),
      })),
      meta: skill.meta,
    },
    attributes: {
      primitive: 'skill.load',
      loader: 'file',
      skillId: skill.id,
      referenceCount: skill.references.length,
      instructionChars: skill.instructions.length,
      tags: skill.meta.tags,
      version: skill.meta.version,
    },
  })
  if (!artifactId) return
  observe.edge({
    edgeType: 'produced',
    from: { kind: 'span', id: spanId },
    to: { kind: 'artifact', id: artifactId },
    attributes: { primitive: 'skill.load', loader: 'file', skillId: skill.id },
  })
}
