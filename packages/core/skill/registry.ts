/**
 * Registry-backed skill loading.
 *
 * Registries are runtime values. Built-in registries are exported as values,
 * and custom registries are created with `registry(...)`. Pass a registry value
 * to `skill.fromRegistry(registry, path)` so runtime binding is explicit and
 * independent from project config or module import order.
 *
 * @module
 */

import type { Skill, SkillMeta, SkillReference } from './types'
import { SkillLoadError } from './types'
import { getCached, setCached, DEFAULT_CACHE_TTL } from './cache'
import { getRuntime } from '../runtime/runtime'
import { observe } from '../observability'
import { SKILLS_SH_BASE, fetchFromCustomRegistry, fetchFromSkillsSh, type FetchedRegistrySkill } from './registry-fetch'
import { emitRegistrySkillArtifact } from './registry-observability'

export { fetchFromCustomRegistry, fetchFromSkillsSh } from './registry-fetch'

/**
 * Configuration for a custom skill registry.
 *
 * Registries are authored as normal TypeScript values. They are not declared in
 * `crux.config.ts`.
 */
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

/** Built-in skills.sh registry value for `skill.fromRegistry(skillsSh, path)`. */
export const skillsSh: Registry = Object.freeze({
  name: 'skills.sh',
  baseUrl: SKILLS_SH_BASE,
  auth: undefined,
})

registries.set(skillsSh.name, skillsSh)

/**
 * Define a custom skill registry.
 *
 * The returned value is passed directly to `skill.fromRegistry(registry, path)`.
 * Creating a registry value does not load remote content and does not require
 * project config.
 */
export function registry(config: RegistryConfig): Registry {
  return createRegistry(config)
}

/**
 * Parse the internal registry cache identifier into registry name and skill path.
 *
 * Public callers bind registry skills with `skill.fromRegistry(registry, path)`;
 * this parser is the fetch/cache boundary for the derived
 * `${registry.name}:${path}` identifier stored on the lazy skill.
 *
 * - 'skills.sh:mattpocock/skills/seo' -> { registry: 'skills.sh', path: 'mattpocock/skills/seo' }
 * - 'acme:brand-guide' -> { registry: 'acme', path: 'brand-guide' }
 *
 * @throws SkillLoadError if the derived identifier cannot be split into registry and path
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

function createRegistry(config: RegistryConfig): Registry {
  return Object.freeze({
    name: config.name,
    baseUrl: config.baseUrl.replace(/\/$/, ''), // strip trailing slash
    auth: config.auth,
  })
}

function identifierFromRegistry(registryRef: Registry, path: string | undefined): string {
  if (!path) {
    throw new SkillLoadError(registryRef.name, 'skill.fromRegistry(registry, path) requires a non-empty skill path')
  }
  const created = createRegistry(registryRef)
  registries.set(created.name, created)
  return `${created.name}:${path}`
}

/**
 * Create a lazy skill from a registry.
 *
 * Pass a registry value with a skill path so the registry is bound by reference
 * at the call site. Content is fetched on first `prompt.resolve()` and cached by
 * identifier.
 */
export function registrySkill(registry: Registry, path: string): Skill
export function registrySkill(registry: Registry, path: string): Skill {
  const identifier = identifierFromRegistry(registry, path)
  parseIdentifier(identifier)

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
 * Resolve a registry skill — fetch content if not cached, update the skill's state.
 * Called during prompt resolution for lazy registry skills.
 */
export async function resolveRegistrySkill(
  identifier: string,
  ttl: number = DEFAULT_CACHE_TTL,
): Promise<FetchedRegistrySkill> {
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
  try {
    // Check cache
    const cached = getCached(identifier)
    if (cached) {
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


    const { registryName, path } = parseIdentifier(identifier)

    const registry = registries.get(registryName)
    if (!registry) {
      throw new SkillLoadError(
        identifier,
        `unknown registry "${registryName}". Create a registry value and pass it to skill.fromRegistry(registry, path).`,
      )
    }

    let result: FetchedRegistrySkill

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
