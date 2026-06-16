import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensureQualityGitignore, loadQualityProject, resolveQualityRunnerSettings } from './quality-config'

describe('loadQualityProject', () => {
  it('loads a no-config package root as a source-discovered quality project', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'crux-quality-no-config-'))
    const evalRoot = join(projectRoot, 'evals')
    mkdirSync(evalRoot, { recursive: true })
    writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({ name: '@acme/no-config-quality' }))
    writeFileSync(join(evalRoot, 'smoke.eval.ts'), 'export const marker = true\n')

    const previousCwd = process.cwd()
    try {
      process.chdir(evalRoot)
      const project = await loadQualityProject()

      expect(project.quality).toEqual({})
      expect(project.prompts).toEqual([])
      expect(project.configDir).toBe(projectRoot)
      expect(project.configPath).toBeUndefined()
    } finally {
      process.chdir(previousCwd)
    }
  })
})

describe('ensureQualityGitignore', () => {
  it('scaffolds <dir>/.gitignore ignoring experiments/ and cache/ but not baselines or cassettes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'crux-quality-gi-'))
    await ensureQualityGitignore(dir)

    const content = readFileSync(join(dir, '.gitignore'), 'utf8')
    const rules = content.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('#'))
    expect(rules).toContain('experiments/')
    expect(rules).toContain('cache/')
    expect(rules).not.toContain('baselines/')
    expect(rules).not.toContain('cassettes/')
  })

  it('leaves an existing .gitignore untouched', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'crux-quality-gi-'))
    writeFileSync(join(dir, '.gitignore'), '# custom\n')
    await ensureQualityGitignore(dir)

    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toBe('# custom\n')
  })

  it('creates the directory when missing', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'crux-quality-gi-')), 'nested', '.crux', 'quality')
    await ensureQualityGitignore(dir)

    expect(existsSync(join(dir, '.gitignore'))).toBe(true)
  })
})

describe('resolveQualityRunnerSettings', () => {
  it('applies the zero-config defaults from the config-discovery binding spec', () => {
    const settings = resolveQualityRunnerSettings({}, '/proj')

    expect(settings.include).toEqual(['evals/**/*.eval.ts', '**/*.eval.ts'])
    expect(settings.exclude).toEqual([])
    expect(settings.dir).toBe(join('/proj', '.crux/quality'))
    expect(settings.qualityId).toBeUndefined()
    expect(settings.redact).toEqual([])
  })

  it('derives the default quality id from the nearest package.json name', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'crux-quality-package-id-'))
    writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({ name: '@acme/default-quality-id' }))

    const settings = resolveQualityRunnerSettings({}, projectRoot)

    expect(settings.qualityId).toBe('@acme/default-quality-id')
  })

  it('resolves a relative quality.dir against the config directory', () => {
    const settings = resolveQualityRunnerSettings(
      { id: 'acme', dir: 'qa/quality', include: './evals/**/*.eval.ts' },
      '/proj',
    )

    expect(settings.dir).toBe(join('/proj', 'qa/quality'))
    expect(settings.qualityId).toBe('acme')
    expect(settings.include).toEqual(['./evals/**/*.eval.ts'])
  })
})
