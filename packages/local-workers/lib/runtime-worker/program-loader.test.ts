import { describe, expect, it } from 'vitest'
import { fixture } from './program-loader.test-fixtures'
import { loadGeneratedRuntimeProgram } from './program-loader'

describe('loadGeneratedRuntimeProgram', () => {
  it('reports a missing generated program actionably', async () => {
    const root = await fixture({})

    await expect(loadGeneratedRuntimeProgram(root)).rejects.toMatchObject({
      code: 'SETUP_REQUIRED',
      nextStep: 'Run `crux runtime generate`, then retry `crux runtime worker`.',
    })
  })

  it('loads the generated program when its artifact identity is fresh', async () => {
    const manifest =
      '{"version":3,"targets":[],"effectTargets":[],"providers":[],"transports":[],"evals":[],"evalPrivacyFingerprint":"safe"}\n'
    const { createHash } = await import('node:crypto')
    const hash = createHash('sha256').update(manifest).digest('hex')
    const root = await fixture({
      '.crux/generated/runtime/manifest.json': manifest,
      '.crux/generated/runtime/program.ts': [
        `export const runtimeArtifactManifestHash = '${hash}'`,
        "export const runtimeProgramFormat = 'crux-runtime-program:v1'",
        "export const runtimeProgram = { manifestHash: 'program', targets: [], targetDefinitions: [], effectTargets: [], providers: [], transports: [] }",
      ].join('\n'),
    })

    await expect(loadGeneratedRuntimeProgram(root)).resolves.toMatchObject({
      manifestHash: 'program',
      targets: [],
    })
  })

  it.each([
    {
      name: 'stale program',
      program:
        "export const runtimeArtifactManifestHash = 'old'\nexport const runtimeProgramFormat = 'crux-runtime-program:v1'\nexport const runtimeProgram = { manifestHash: 'program', targets: [], targetDefinitions: [], effectTargets: [], providers: [], transports: [] }",
      code: 'ARTIFACTS_STALE',
    },
    {
      name: 'incompatible format',
      program:
        "export const runtimeArtifactManifestHash = 'HASH'\nexport const runtimeProgramFormat = 'crux-runtime-program:v0'\nexport const runtimeProgram = { manifestHash: 'program', targets: [], targetDefinitions: [], effectTargets: [], providers: [], transports: [] }",
      code: 'RUNTIME_ARTIFACT_MANIFEST_INCOMPATIBLE',
    },
    {
      name: 'invalid program',
      program:
        "export const runtimeArtifactManifestHash = 'HASH'\nexport const runtimeProgramFormat = 'crux-runtime-program:v1'\nexport const runtimeProgram = { targets: [] }",
      code: 'RUNTIME_ARTIFACT_MANIFEST_INVALID',
    },
  ])('reports a $name artifact actionably', async ({ program, code }) => {
    const manifest =
      '{"version":3,"evalPrivacyFingerprint":"safe","targets":[],"effectTargets":[],"providers":[],"transports":[],"evals":[]}\n'
    const { createHash } = await import('node:crypto')
    const hash = createHash('sha256').update(manifest).digest('hex')
    const root = await fixture({
      '.crux/generated/runtime/manifest.json': manifest,
      '.crux/generated/runtime/program.ts': program.replace('HASH', hash),
    })

    await expect(loadGeneratedRuntimeProgram(root)).rejects.toMatchObject({
      code,
    })
  })

  it('reports authored import failures without hiding their cause', async () => {
    const root = await fixture({
      '.crux/generated/runtime/manifest.json':
        '{"version":3,"evalPrivacyFingerprint":"safe","targets":[],"effectTargets":[],"providers":[],"transports":[],"evals":[]}\n',
      '.crux/generated/runtime/program.ts': "import './missing-target'",
    })

    await expect(loadGeneratedRuntimeProgram(root)).rejects.toMatchObject({
      code: 'RUNTIME_ARTIFACT_MANIFEST_INVALID',
      whatFailed: expect.stringContaining('could not import'),
    })
  })

  it.each([
    ['malformed', '{'],
    ['incompatible', '{"version":1}\n'],
  ])('reports an %s manifest before starting a worker', async (_name, manifest) => {
    const root = await fixture({
      '.crux/generated/runtime/manifest.json': manifest,
      '.crux/generated/runtime/program.ts': 'export const runtimeProgram = {}',
    })

    await expect(loadGeneratedRuntimeProgram(root)).rejects.toMatchObject({
      code: manifest === '{' ? 'RUNTIME_ARTIFACT_MANIFEST_INVALID' : 'RUNTIME_ARTIFACT_MANIFEST_INCOMPATIBLE',
    })
  })

  it('reports a legacy v2 manifest as version incompatible', async () => {
    const root = await fixture({
      '.crux/generated/runtime/manifest.json': '{"version":2}\n',
      '.crux/generated/runtime/program.ts': 'export const runtimeProgram = {}',
    })

    await expect(loadGeneratedRuntimeProgram(root)).rejects.toMatchObject({
      code: 'RUNTIME_ARTIFACT_MANIFEST_INCOMPATIBLE',
    })
  })

  it('rejects generated target definitions that disagree with the manifest', async () => {
    const manifest = `${JSON.stringify({
      version: 3,
      evalPrivacyFingerprint: 'safe',
      targets: [
        {
          name: 'review',
          kind: 'flow',
          module: './review.ts',
          export: 'review',
          definitionId: 'flow:review',
          fingerprint: 'definition-review-v1',
        },
      ],
      effectTargets: [],
      providers: [],
      transports: [],
      evals: [],
    })}\n`
    const { createHash } = await import('node:crypto')
    const hash = createHash('sha256').update(manifest).digest('hex')
    const root = await fixture({
      '.crux/generated/runtime/manifest.json': manifest,
      '.crux/generated/runtime/program.ts': [
        `export const runtimeArtifactManifestHash = '${hash}'`,
        "export const runtimeProgramFormat = 'crux-runtime-program:v1'",
        "export const runtimeProgram = { manifestHash: 'program', targets: [{ name: 'review', kind: 'flow' }], targetDefinitions: [{ targetId: 'review', definitionId: 'flow:review', fingerprint: 'definition-review-v2' }], effectTargets: [], providers: [], transports: [] }",
      ].join('\n'),
    })

    await expect(loadGeneratedRuntimeProgram(root)).rejects.toMatchObject({
      code: 'ARTIFACTS_STALE',
      whatFailed: expect.stringContaining('targets'),
    })
  })

  it('rejects a generated program target without an explicit kind', async () => {
    const manifest = `${JSON.stringify({
      version: 3,
      evalPrivacyFingerprint: 'safe',
      targets: [
        {
          name: 'review',
          kind: 'flow',
          module: './review.ts',
          export: 'review',
          definitionId: 'flow:review',
          fingerprint: 'definition-review-v1',
        },
      ],
      effectTargets: [],
      providers: [],
      transports: [],
      evals: [],
    })}\n`
    const { createHash } = await import('node:crypto')
    const hash = createHash('sha256').update(manifest).digest('hex')
    const root = await fixture({
      '.crux/generated/runtime/manifest.json': manifest,
      '.crux/generated/runtime/program.ts': [
        `export const runtimeArtifactManifestHash = '${hash}'`,
        "export const runtimeProgramFormat = 'crux-runtime-program:v1'",
        "export const runtimeProgram = { manifestHash: 'program', targets: [{ name: 'review' }], targetDefinitions: [{ targetId: 'review', definitionId: 'flow:review', fingerprint: 'definition-review-v1' }], effectTargets: [], providers: [], transports: [] }",
      ].join('\n'),
    })

    await expect(loadGeneratedRuntimeProgram(root)).rejects.toMatchObject({
      code: 'ARTIFACTS_STALE',
    })
  })

  it('rejects Effect recovery targets that disagree with the manifest', async () => {
    const manifest = `${JSON.stringify({
      version: 3,
      evalPrivacyFingerprint: 'safe',
      targets: [],
      effectTargets: [{
        id: 'customer.update',
        version: 1,
        module: './effects.ts',
        export: 'updateCustomer',
      }],
      providers: [],
      transports: [],
      evals: [],
    })}\n`
    const { createHash } = await import('node:crypto')
    const hash = createHash('sha256').update(manifest).digest('hex')
    const root = await fixture({
      '.crux/generated/runtime/manifest.json': manifest,
      '.crux/generated/runtime/program.ts': [
        `export const runtimeArtifactManifestHash = '${hash}'`,
        "export const runtimeProgramFormat = 'crux-runtime-program:v1'",
        "export const runtimeProgram = { manifestHash: 'program', targets: [], targetDefinitions: [], effectTargets: [{ id: 'customer.update', version: 2 }], providers: [], transports: [] }",
      ].join('\n'),
    })

    await expect(loadGeneratedRuntimeProgram(root)).rejects.toMatchObject({
      code: 'ARTIFACTS_STALE',
      whatFailed: expect.stringContaining('targets'),
    })
  })

})
