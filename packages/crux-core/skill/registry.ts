/**
 * Registry — fetch skills from skills.sh and custom registries.
 *
 * Default: skills.sh download API at /api/download/{owner}/{repo}/{slug}
 * Custom: .well-known/agent-skills/ protocol
 */

import type { Skill, SkillMeta, SkillReference } from './types'
import { SkillLoadError } from './types'
import { parseFrontmatter } from './frontmatter'
import { getCached, setCached, DEFAULT_CACHE_TTL } from './cache'
import { getRuntime } from '../runtime'
import { observe } from '../observability'
import type { JsonObject } from '../store/types'

/** Configuration for a custom skill registry. */
export interface RegistryConfig {
  readonly name: string
  readonly baseUrl: string
  readonly auth?: () => string | undefined
}

/** A configured skill registry instance. */
export interface Registry {
  readonly name: string
  readonly baseUrl: string
  readonly auth?: () => string | undefined
}

/** Map of registered registries. Keyed by registry name. */
const registries = new Map<string, Registry>()

/** skills.sh download API base URL. */
const SKILLS_SH_BASE = 'https://skills.sh'

// Pre-register skills.sh as a built-in registry.
// Users reference it explicitly: skill.fromRegistry('skills.sh:mattpocock/skills/seo')
registries.set(
  'skills.sh',
  Object.freeze({
    name: 'skills.sh',
    baseUrl: SKILLS_SH_BASE,
    auth: undefined,
  }),
)

/**
 * Define a custom skill registry.
 * Custom registries use the .well-known/agent-skills/ protocol.
 */
export function registry(config: RegistryConfig): Registry {
  const registry: Registry = Object.freeze({
    name: config.name,
    baseUrl: config.baseUrl.replace(/\/$/, ''), // strip trailing slash
    auth: config.auth,
  })
  registries.set(config.name, registry)
  return registry
}

/** Register a custom registry (called from config). */
export function registerRegistry(name: string, registry: Registry): void {
  registries.set(name, registry)
}

/** Get a registered registry by name. */
export function getRegistry(name: string): Registry | undefined {
  return registries.get(name)
}

/**
 * Parse a registry identifier into registry name and skill path.
 * All identifiers MUST be prefixed with the registry name.
 *
 * - 'skills.sh:mattpocock/skills/seo' -> { registry: 'skills.sh', path: 'mattpocock/skills/seo' }
 * - 'acme:brand-guide' -> { registry: 'acme', path: 'brand-guide' }
 *
 * @throws SkillLoadError if identifier has no registry prefix
 */
function parseIdentifier(identifier: string): { registryName: string; path: string } {
  const colonIdx = identifier.indexOf(':')
  if (colonIdx > 0 && !identifier.slice(0, colonIdx).includes('/')) {
    return {
      registryName: identifier.slice(0, colonIdx),
      path: identifier.slice(colonIdx + 1),
    }
  }
  throw new SkillLoadError(
    identifier,
    `registry identifier must be prefixed with registry name (e.g., "skills.sh:${identifier}" or "myregistry:${identifier}")`,
  )
}

/**
 * Create a lazy skill from a registry identifier.
 * Content is NOT fetched immediately — it loads on first prompt.resolve().
 */
export function registrySkill(identifier: string): Skill {
  const { registryName, path } = parseIdentifier(identifier)

  // Create a lazy skill that fetches on first access
  let loaded = false
  let cachedInstructions = ''
  let cachedRefs: readonly SkillReference[] = Object.freeze([])
  let cachedMeta: SkillMeta = Object.freeze({ name: identifier, description: `Skill from registry: ${identifier}` })

  const skill: Skill = Object.freeze({
    _tag: 'Skill' as const,
    id: identifier,
    description: `Skill from registry: ${identifier}`,

    get instructions(): string {
      if (!loaded) {
        // Check cache first
        const cached = getCached(identifier)
        if (cached) {
          cachedInstructions = cached.instructions
          cachedRefs = cached.references
          cachedMeta = Object.freeze({
            name: cached.name,
            description: cached.description,
            ...(cached.version ? { version: cached.version } : {}),
            ...(cached.license ? { license: cached.license } : {}),
            ...(cached.tags ? { tags: cached.tags } : {}),
          })
          loaded = true
          return cachedInstructions
        }
        // Not in cache — return placeholder, actual fetch happens in resolve
        return `[Skill "${identifier}" not yet loaded from registry]`
      }
      return cachedInstructions
    },

    get references(): readonly SkillReference[] {
      return cachedRefs
    },

    get meta(): SkillMeta {
      return cachedMeta
    },

    dump(): string {
      return cachedInstructions || `[Skill "${identifier}" not yet loaded from registry]`
    },
  })

  return skill
}

/**
 * Fetch a skill from skills.sh download API.
 * Returns parsed skill content with instructions and references.
 */
export async function fetchFromSkillsSh(path: string): Promise<{
  instructions: string
  references: readonly SkillReference[]
  meta: SkillMeta
}> {
  // Parse path: 'owner/repo/slug' or 'owner/repo' (slug = last segment)
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

  // Find SKILL.md
  const skillFile = data.files.find((f) => f.path.endsWith('SKILL.md') || f.path === 'SKILL.md')
  if (!skillFile) {
    throw new SkillLoadError(path, 'no SKILL.md found in skills.sh response')
  }

  const { meta, body } = parseFrontmatter(skillFile.contents, path)

  // Extract references
  const references: SkillReference[] = data.files
    .filter((f) => f.path.includes('references/') && f.path.endsWith('.md'))
    .map((f) => {
      const name = f.path.split('/').pop()?.replace('.md', '') ?? f.path
      return Object.freeze({ name, content: f.contents })
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
export async function fetchFromCustomRegistry(
  registry: Registry,
  skillPath: string,
): Promise<{
  instructions: string
  references: readonly SkillReference[]
  meta: SkillMeta
}> {
  const headers: Record<string, string> = {}
  if (registry.auth) {
    const token = registry.auth()
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
  }

  // Fetch the skill's SKILL.md
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

  // Try to fetch index for references
  let references: readonly SkillReference[] = Object.freeze([])
  try {
    const indexUrl = `${registry.baseUrl}/.well-known/agent-skills/${skillPath}/index.json`
    const indexResp = await fetch(indexUrl, { headers })
    if (indexResp.ok) {
      const index = (await indexResp.json()) as { references?: string[] }
      if (index.references && Array.isArray(index.references)) {
        const refs: SkillReference[] = []
        for (const refName of index.references) {
          try {
            const refUrl = `${registry.baseUrl}/.well-known/agent-skills/${skillPath}/references/${refName}`
            const refResp = await fetch(refUrl, { headers })
            if (refResp.ok) {
              refs.push(Object.freeze({ name: refName.replace('.md', ''), content: await refResp.text() }))
            }
          } catch {
            // Skip failed reference fetches
          }
        }
        references = Object.freeze(refs)
      }
    }
  } catch {
    // No index — no references
  }

  return { instructions: body, references, meta }
}

/**
 * Resolve a registry skill — fetch content if not cached, update the skill's state.
 * Called during prompt resolution for lazy registry skills.
 */
export async function resolveRegistrySkill(
  identifier: string,
  ttl: number = DEFAULT_CACHE_TTL,
): Promise<{
  instructions: string
  references: readonly SkillReference[]
  meta: SkillMeta
}> {
  const span = observe.openSpan({
    name: 'skill.registry.load',
    family: 'skill',
    primitive: 'skill.load',
    attributes: {
      loader: 'registry',
      identifier,
      ttlMs: ttl,
    },
  })
  const hooks = getRuntime().instrumentationHooks
  try {
    // Check cache
    const cached = getCached(identifier)
    if (cached) {
      hooks?.onSkillCacheHit?.({ skillId: identifier })
      const result = {
        instructions: cached.instructions,
        references: cached.references,
        meta: Object.freeze({
          name: cached.name,
          description: cached.description,
          ...(cached.version ? { version: cached.version } : {}),
          ...(cached.license ? { license: cached.license } : {}),
          ...(cached.tags ? { tags: cached.tags } : {}),
        }),
      }
      span.withContext(() => emitRegistrySkillArtifact(span.spanId, identifier, 'cache', result))
      span.end({
        loader: 'registry',
        source: 'cache',
        identifier,
        cached: true,
        skillId: result.meta.name,
        referenceCount: result.references.length,
        instructionChars: result.instructions.length,
        tags: result.meta.tags,
        version: result.meta.version,
      })
      return result
    }

    hooks?.onSkillCacheMiss?.({ skillId: identifier })

    const { registryName, path } = parseIdentifier(identifier)

    const registry = registries.get(registryName)
    if (!registry) {
      throw new SkillLoadError(
        identifier,
        `unknown registry "${registryName}". Register it with config({ registries: { ${registryName}: registry(...) } })`,
      )
    }

    let result: { instructions: string; references: readonly SkillReference[]; meta: SkillMeta }

    // skills.sh uses its own download API; custom registries use .well-known protocol
    if (registryName === 'skills.sh') {
      result = await span.withContext(() => fetchFromSkillsSh(path))
    } else {
      result = await span.withContext(() => fetchFromCustomRegistry(registry, path))
    }

    // Cache the result
    setCached(
      identifier,
      {
        instructions: result.instructions,
        references: result.references,
        name: result.meta.name,
        description: result.meta.description,
        version: result.meta.version,
        license: result.meta.license,
        tags: result.meta.tags,
      },
      ttl,
    )

    span.withContext(() => emitRegistrySkillArtifact(span.spanId, identifier, registryName, result))
    span.end({
      loader: 'registry',
      source: registryName,
      identifier,
      cached: false,
      skillId: result.meta.name,
      referenceCount: result.references.length,
      instructionChars: result.instructions.length,
      tags: result.meta.tags,
      version: result.meta.version,
    })
    return result
  } catch (error) {
    span.error(error, { loader: 'registry', identifier })
    throw error
  }
}

function emitRegistrySkillArtifact(
  spanId: ReturnType<typeof observe.openSpan>['spanId'],
  identifier: string,
  source: string,
  result: {
    instructions: string
    references: readonly SkillReference[]
    meta: SkillMeta
  },
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
      meta: result.meta,
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
