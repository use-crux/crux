import { describe, it, expect, vi, beforeEach } from 'vitest'
import { skill, registry as makeRegistry, clearCache, cacheSize, skillsSh } from '../../src/skill/index'
import { resolveRegistrySkill, type Registry } from '../../src/skill/registry'
import { SkillLoadError } from '../../src/skill/types'

beforeEach(() => {
  clearCache()
})

describe('skill.fromRegistry()', () => {
  it('creates a skill object with the identifier as ID', () => {
    const s = skill.fromRegistry(skillsSh, 'mattpocock/skills/seo')

    expect(s._tag).toBe('Skill')
    expect(s.id).toBe('skills.sh:mattpocock/skills/seo')
  })

    it('has a placeholder description until loaded', () => {
    const s = skill.fromRegistry(skillsSh, 'mattpocock/skills/seo')
    expect(s.description).toContain('registry')
  })

    it('accepts a registry object so custom registries are code-bound, not config-bound', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('SKILL.md')) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve('---\nname: brand\ndescription: Brand guide\n---\n\nBrand instructions.'),
        })
      }
      return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' })
    })

    const original = globalThis.fetch
    globalThis.fetch = mockFetch

    const acme = {
      name: 'acme-ref',
      baseUrl: 'https://skills.acme.corp',
    } satisfies Registry
    const s = skill.fromRegistry(acme, 'brand-guidelines')

    try {
      expect(s.id).toBe('acme-ref:brand-guidelines')
      const result = await resolveRegistrySkill(s.id)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://skills.acme.corp/.well-known/agent-skills/brand-guidelines/SKILL.md',
        expect.any(Object),
      )
      expect(result.instructions).toBe('Brand instructions.')
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('identifier parsing', () => {
  it('skills.sh prefix routes to skills.sh download API', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          files: [{ path: 'SKILL.md', contents: '---\nname: seo\ndescription: SEO skill\n---\n\nSEO instructions.' }],
          hash: 'abc123',
        }),
    })

    const original = globalThis.fetch
    globalThis.fetch = mockFetch

    try {
      const result = await resolveRegistrySkill('skills.sh:mattpocock/skills/seo')
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('skills.sh/api/download/mattpocock/skills/seo'))
      expect(result.instructions).toBe('SEO instructions.')
      expect(result.meta.name).toBe('seo')
    } finally {
      globalThis.fetch = original
    }
  })

    it('custom prefix routes to custom registry', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('SKILL.md')) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve('---\nname: brand\ndescription: Brand guide\n---\n\nBrand instructions.'),
        })
      }
      return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' })
    })

    const original = globalThis.fetch
    globalThis.fetch = mockFetch

    const acme = makeRegistry({
      name: 'acme',
      baseUrl: 'https://skills.acme.corp',
    })
    const s = skill.fromRegistry(acme, 'brand-guidelines')

    try {
      const result = await resolveRegistrySkill(s.id)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://skills.acme.corp/.well-known/agent-skills/brand-guidelines/SKILL.md',
        expect.any(Object),
      )
      expect(result.instructions).toBe('Brand instructions.')
    } finally {
      globalThis.fetch = original
    }
  })

    it('throws SkillLoadError for unknown internal registry identifiers', async () => {
    await expect(resolveRegistrySkill('unknown:skill')).rejects.toThrow(SkillLoadError)
    await expect(resolveRegistrySkill('unknown:skill')).rejects.toThrow('unknown registry')
  })

    it('throws SkillLoadError for malformed internal registry identifiers', async () => {
    await expect(resolveRegistrySkill('mattpocock/skills/seo')).rejects.toThrow(SkillLoadError)
    await expect(resolveRegistrySkill('mattpocock/skills/seo')).rejects.toThrow('must be prefixed')
  })
})

describe('caching', () => {
  it('caches fetched skills and returns from cache on second call', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          files: [
            { path: 'SKILL.md', contents: '---\nname: cached\ndescription: Cached skill\n---\n\nCached content.' },
          ],
        }),
    })

    const original = globalThis.fetch
    globalThis.fetch = mockFetch

    try {
      expect(cacheSize()).toBe(0)

      // First call — fetches
      await resolveRegistrySkill('skills.sh:owner/repo/cached')
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(cacheSize()).toBe(1)

      // Second call — from cache
      const result = await resolveRegistrySkill('skills.sh:owner/repo/cached')
      expect(mockFetch).toHaveBeenCalledTimes(1) // no additional fetch
      expect(result.instructions).toBe('Cached content.')
    } finally {
      globalThis.fetch = original
    }
  })

    it('expires cached entries after TTL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          files: [{ path: 'SKILL.md', contents: '---\nname: expiring\ndescription: Expiring\n---\n\nContent.' }],
        }),
    })

    const original = globalThis.fetch
    globalThis.fetch = mockFetch

    try {
      // Fetch with very short TTL
      await resolveRegistrySkill('skills.sh:owner/repo/expiring', 1) // 1ms TTL

      // Wait for expiry
      await new Promise((r) => setTimeout(r, 10))

      // Should fetch again
      await resolveRegistrySkill('skills.sh:owner/repo/expiring', 1)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('error handling', () => {
  it('throws SkillLoadError on network failure', async () => {
    const original = globalThis.fetch
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network down'))

    try {
      await expect(resolveRegistrySkill('skills.sh:owner/repo/skill')).rejects.toThrow(SkillLoadError)
      await expect(resolveRegistrySkill('skills.sh:owner/repo/skill')).rejects.toThrow('network error')
    } finally {
      globalThis.fetch = original
    }
  })

    it('throws SkillLoadError on non-200 response', async () => {
    const original = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    })

    try {
      await expect(resolveRegistrySkill('skills.sh:owner/repo/missing')).rejects.toThrow(SkillLoadError)
      await expect(resolveRegistrySkill('skills.sh:owner/repo/missing')).rejects.toThrow('404')
    } finally {
      globalThis.fetch = original
    }
  })

    it('throws SkillLoadError on invalid JSON', async () => {
    const original = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new Error('Invalid JSON')),
    })

    try {
      await expect(resolveRegistrySkill('skills.sh:owner/repo/bad')).rejects.toThrow(SkillLoadError)
    } finally {
      globalThis.fetch = original
    }
  })

    it('throws SkillLoadError when skills.sh identifier is too short', async () => {
    await expect(resolveRegistrySkill('skills.sh:tooshort')).rejects.toThrow(SkillLoadError)
    await expect(resolveRegistrySkill('skills.sh:tooshort')).rejects.toThrow('owner/repo')
  })
})

describe('skills.sh references', () => {
  it('extracts reference files from the response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          files: [
            { path: 'SKILL.md', contents: '---\nname: rich\ndescription: Rich skill\n---\n\nMain content.' },
            { path: 'references/patterns.md', contents: '# Patterns\n\nPattern content.' },
            { path: 'references/examples.md', contents: '# Examples\n\nExample content.' },
          ],
        }),
    })

    const original = globalThis.fetch
    globalThis.fetch = mockFetch

    try {
      const result = await resolveRegistrySkill('skills.sh:owner/repo/rich')
      expect(result.references).toHaveLength(2)
      expect(result.references.map((r) => r.name).sort()).toEqual(['examples', 'patterns'])
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('custom registry auth', () => {
  it('passes auth token in headers', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('SKILL.md')) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve('---\nname: authed\ndescription: Auth test\n---\n\nContent.'),
        })
      }
      return Promise.resolve({ ok: false, status: 404 })
    })

    const original = globalThis.fetch
    globalThis.fetch = mockFetch

    const privateRegistry = makeRegistry({
      name: 'private',
      baseUrl: 'https://private.corp',
      auth: () => 'secret-token',
    })
    const s = skill.fromRegistry(privateRegistry, 'my-skill')

    try {
      await resolveRegistrySkill(s.id)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer secret-token',
          }),
        }),
      )
    } finally {
      globalThis.fetch = original
    }
  })
})
