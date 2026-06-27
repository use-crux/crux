import { parseFrontmatter } from './frontmatter'
import { SkillLoadError, type SkillMeta, type SkillReference } from './types'
import type { Registry } from './registry'

export const SKILLS_SH_BASE = 'https://skills.sh'

export interface FetchedRegistrySkill {
  readonly instructions: string
  readonly references: readonly SkillReference[]
  readonly meta: SkillMeta
}

/**
 * Fetch a skill from the skills.sh download API.
 *
 * `skills.sh` serves a repository bundle, so references are discovered from the
 * returned file list instead of the custom-registry index protocol.
 */
export async function fetchFromSkillsSh(path: string): Promise<FetchedRegistrySkill> {
  const parts = path.split('/')
  if (parts.length < 2) {
    throw new SkillLoadError(path, 'skills.sh identifier must be in format: owner/repo/skill or owner/repo')
  }

  const owner = parts[0]
  const repo = parts[1]
  const slug = parts.length > 2 ? parts.slice(2).join('/') : parts[1]

  const url = `${SKILLS_SH_BASE}/api/download/${owner}/${repo}/${slug}`

  let response: Response
  try {
    response = await fetch(url)
  } catch (err) {
    throw new SkillLoadError(
      path,
      `network error fetching from skills.sh: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  if (!response.ok) {
    throw new SkillLoadError(path, `skills.sh returned ${response.status}: ${response.statusText}`)
  }

  let data: { files: { path: string; contents: string }[]; hash?: string }
  try {
    data = (await response.json()) as typeof data
  } catch {
    throw new SkillLoadError(path, 'invalid JSON response from skills.sh')
  }

  if (!data.files || !Array.isArray(data.files)) {
    throw new SkillLoadError(path, 'skills.sh response missing files array')
  }

  const skillFile = data.files.find((file) => file.path.endsWith('SKILL.md') || file.path === 'SKILL.md')
  if (!skillFile) {
    throw new SkillLoadError(path, 'no SKILL.md found in skills.sh response')
  }

  const { meta, body } = parseFrontmatter(skillFile.contents, path)
  const references: SkillReference[] = data.files
    .filter((file) => file.path.includes('references/') && file.path.endsWith('.md'))
    .map((file) => {
      const name = file.path.split('/').pop()?.replace('.md', '') ?? file.path
      return Object.freeze({ name, content: file.contents })
    })

  return {
    instructions: body,
    references: Object.freeze(references),
    meta,
  }
}

/**
 * Fetch a skill from a custom registry using the .well-known/agent-skills/ protocol.
 */
export async function fetchFromCustomRegistry(registry: Registry, skillPath: string): Promise<FetchedRegistrySkill> {
  const headers: Record<string, string> = {}
  if (registry.auth) {
    const token = registry.auth()
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }
  }

  const skillUrl = `${registry.baseUrl}/.well-known/agent-skills/${skillPath}/SKILL.md`
  let response: Response
  try {
    response = await fetch(skillUrl, { headers })
  } catch (err) {
    throw new SkillLoadError(
      `${registry.name}:${skillPath}`,
      `network error fetching from ${registry.name}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  if (!response.ok) {
    throw new SkillLoadError(
      `${registry.name}:${skillPath}`,
      `${registry.name} returned ${response.status}: ${response.statusText}`,
    )
  }

  const raw = await response.text()
  const { meta, body } = parseFrontmatter(raw, `${registry.name}:${skillPath}`)
  const references = await fetchCustomRegistryReferences(registry, skillPath, headers)

  return { instructions: body, references, meta }
}

async function fetchCustomRegistryReferences(
  registry: Registry,
  skillPath: string,
  headers: Record<string, string>,
): Promise<readonly SkillReference[]> {
  try {
    const indexUrl = `${registry.baseUrl}/.well-known/agent-skills/${skillPath}/index.json`
    const indexResp = await fetch(indexUrl, { headers })
    if (!indexResp.ok) return Object.freeze([])

    const index = (await indexResp.json()) as { references?: unknown }
    if (!Array.isArray(index.references)) return Object.freeze([])

    const refs: SkillReference[] = []
    for (const refName of index.references) {
      if (typeof refName !== 'string') continue
      const reference = await fetchCustomRegistryReference(registry, skillPath, refName, headers)
      if (reference) refs.push(reference)
    }
    return Object.freeze(refs)
  } catch {
    return Object.freeze([])
  }
}

async function fetchCustomRegistryReference(
  registry: Registry,
  skillPath: string,
  refName: string,
  headers: Record<string, string>,
): Promise<SkillReference | null> {
  try {
    const refUrl = `${registry.baseUrl}/.well-known/agent-skills/${skillPath}/references/${refName}`
    const refResp = await fetch(refUrl, { headers })
    if (!refResp.ok) return null
    return Object.freeze({ name: refName.replace('.md', ''), content: await refResp.text() })
  } catch {
    return null
  }
}
