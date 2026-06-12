import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensureQualityGitignore, resolveQualityRunnerSettings } from './quality-config'

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
  it('applies the zero-config defaults from spec 01 §9', () => {
    const settings = resolveQualityRunnerSettings({}, '/proj')

    expect(settings.include).toEqual(['**/*.eval.ts'])
    expect(settings.exclude).toEqual([])
    expect(settings.dir).toBe(join('/proj', '.crux/quality'))
    expect(settings.qualityId).toBeUndefined()
    expect(settings.redact).toEqual([])
  })

  it('resolves a relative quality.dir against the config directory', () => {
    const settings = resolveQualityRunnerSettings({ id: 'acme', dir: 'qa/quality', include: './evals/**/*.eval.ts' }, '/proj')

    expect(settings.dir).toBe(join('/proj', 'qa/quality'))
    expect(settings.qualityId).toBe('acme')
    expect(settings.include).toEqual(['./evals/**/*.eval.ts'])
  })
})
