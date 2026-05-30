/**
 * Lightweight YAML frontmatter parser for SKILL.md files.
 *
 * Parses the simple key-value YAML frontmatter used by skills.sh:
 * ---
 * name: skill-name
 * description: A description
 * version: 1.0.0
 * license: Apache-2.0
 * ---
 *
 * Does NOT handle nested YAML, arrays, or complex structures.
 * This avoids adding a YAML dependency to @crux/core.
 */

import type { SkillMeta } from './types'
import { SkillLoadError } from './types'

/** Result of parsing a SKILL.md file. */
export interface ParsedSkillFile {
  readonly meta: SkillMeta
  readonly body: string
}

/** Raw key-value pairs extracted from frontmatter. */
interface FrontmatterFields {
  [key: string]: string
}

const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/

/**
 * Parse YAML frontmatter from a SKILL.md file.
 *
 * @param raw - The full file content
 * @param sourceId - Identifier for error messages (filename or registry ID)
 * @returns Parsed metadata and instruction body
 * @throws SkillLoadError if frontmatter is missing or required fields are absent
 */
export function parseFrontmatter(raw: string, sourceId: string): ParsedSkillFile {
  const match = raw.match(FRONTMATTER_REGEX)
  if (!match) {
    throw new SkillLoadError(sourceId, 'SKILL.md must have YAML frontmatter (--- delimiters with name and description)')
  }

  const [, frontmatterBlock, body] = match
  const fields = parseFrontmatterFields(frontmatterBlock!, sourceId)

  // Required fields
  if (!fields.name) {
    throw new SkillLoadError(sourceId, 'frontmatter missing required field: name')
  }
  if (!fields.description) {
    throw new SkillLoadError(sourceId, 'frontmatter missing required field: description')
  }

  // Parse tags if present (comma-separated or YAML array syntax)
  let tags: string[] | undefined
  if (fields.tags) {
    tags = fields.tags
      .replace(/^\[|\]$/g, '') // strip [ ]
      .split(',')
      .map((t) => t.trim().replace(/^['"]|['"]$/g, '')) // strip quotes
      .filter(Boolean)
  }

  const meta: SkillMeta = Object.freeze({
    name: fields.name,
    description: fields.description,
    ...(fields.version ? { version: fields.version } : {}),
    ...(fields.license ? { license: fields.license } : {}),
    ...(tags && tags.length > 0 ? { tags: Object.freeze(tags) } : {}),
  })

  return {
    meta,
    body: (body ?? '').trim(),
  }
}

/**
 * Parse simple key: value lines from a YAML frontmatter block.
 * Handles quoted values, ignores unknown fields (allowed-tools, model, etc.).
 */
function parseFrontmatterFields(block: string, sourceId: string): FrontmatterFields {
  const fields: FrontmatterFields = {}

  for (const line of block.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const colonIdx = trimmed.indexOf(':')
    if (colonIdx === -1) continue

    const key = trimmed.slice(0, colonIdx).trim()
    let value = trimmed.slice(colonIdx + 1).trim()

    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    fields[key] = value
  }

  return fields
}
