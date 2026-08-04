import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadGeneratedRuntimeProgram } from './program-loader'

const roots: string[] = []

async function fixture(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'crux-runtime-worker-loader-'))
  roots.push(root)
  for (const [file, contents] of Object.entries(files)) {
    const destination = join(root, file)
    await mkdir(join(destination, '..'), { recursive: true })
    await writeFile(destination, contents)
  }
  return root
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('loadGeneratedRuntimeProgram', () => {
  it('reports a missing generated program actionably', async () => {
    const root = await fixture({})

    await expect(loadGeneratedRuntimeProgram(root)).rejects.toMatchObject({
      code: 'SETUP_REQUIRED',
      nextStep: 'Run `crux runtime generate`, then retry `crux runtime worker`.',
    })
  })

  it('loads the generated program when its artifact identity is fresh', async () => {
    const manifest = '{"version":2,"targets":[],"providers":[],"transports":[],"evals":[],"evalPrivacyFingerprint":"safe"}\n'
    const { createHash } = await import('node:crypto')
    const hash = createHash('sha256').update(manifest).digest('hex')
    const root = await fixture({
      '.crux/generated/runtime/manifest.json': manifest,
      '.crux/generated/runtime/program.ts': [
        `export const runtimeArtifactManifestHash = '${hash}'`,
        "export const runtimeProgramFormat = 'crux-runtime-program:v1'",
        "export const runtimeProgram = { manifestHash: 'program', targets: [], targetDefinitions: [], providers: [], transports: [] }",
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
      program: "export const runtimeArtifactManifestHash = 'old'\nexport const runtimeProgramFormat = 'crux-runtime-program:v1'\nexport const runtimeProgram = { manifestHash: 'program', targets: [], targetDefinitions: [], providers: [], transports: [] }",
      code: 'ARTIFACTS_STALE',
    },
    {
      name: 'incompatible format',
      program: "export const runtimeArtifactManifestHash = 'HASH'\nexport const runtimeProgramFormat = 'crux-runtime-program:v0'\nexport const runtimeProgram = { manifestHash: 'program', targets: [], targetDefinitions: [], providers: [], transports: [] }",
      code: 'RUNTIME_ARTIFACT_MANIFEST_INCOMPATIBLE',
    },
    {
      name: 'invalid program',
      program: "export const runtimeArtifactManifestHash = 'HASH'\nexport const runtimeProgramFormat = 'crux-runtime-program:v1'\nexport const runtimeProgram = { targets: [] }",
      code: 'RUNTIME_ARTIFACT_MANIFEST_INVALID',
    },
  ])('reports a $name artifact actionably', async ({ program, code }) => {
    const manifest = '{"version":2,"evalPrivacyFingerprint":"safe","targets":[],"providers":[],"transports":[],"evals":[]}\n'
    const { createHash } = await import('node:crypto')
    const hash = createHash('sha256').update(manifest).digest('hex')
    const root = await fixture({
      '.crux/generated/runtime/manifest.json': manifest,
      '.crux/generated/runtime/program.ts': program.replace('HASH', hash),
    })

    await expect(loadGeneratedRuntimeProgram(root)).rejects.toMatchObject({ code })
  })

  it('reports authored import failures without hiding their cause', async () => {
    const root = await fixture({
      '.crux/generated/runtime/manifest.json': '{"version":2,"evalPrivacyFingerprint":"safe","targets":[],"providers":[],"transports":[],"evals":[]}\n',
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
      code: manifest === '{'
        ? 'RUNTIME_ARTIFACT_MANIFEST_INVALID'
        : 'RUNTIME_ARTIFACT_MANIFEST_INCOMPATIBLE',
    })
  })

  it('rejects a structurally incomplete v2 manifest', async () => {
    const root = await fixture({
      '.crux/generated/runtime/manifest.json': '{"version":2}\n',
      '.crux/generated/runtime/program.ts': 'export const runtimeProgram = {}',
    })

    await expect(loadGeneratedRuntimeProgram(root)).rejects.toMatchObject({
      code: 'RUNTIME_ARTIFACT_MANIFEST_INVALID',
    })
  })

  it('rejects generated target definitions that disagree with the manifest', async () => {
    const manifest = `${JSON.stringify({
      version: 2,
      evalPrivacyFingerprint: 'safe',
      targets: [{
        name: 'review',
        kind: 'flow',
        module: './review.ts',
        export: 'review',
        definitionId: 'flow:review',
        fingerprint: 'definition-review-v1',
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
        "export const runtimeProgram = { manifestHash: 'program', targets: [{ name: 'review', kind: 'flow' }], targetDefinitions: [{ targetId: 'review', definitionId: 'flow:review', fingerprint: 'definition-review-v2' }], providers: [], transports: [] }",
      ].join('\n'),
    })

    await expect(loadGeneratedRuntimeProgram(root)).rejects.toMatchObject({
      code: 'ARTIFACTS_STALE',
      whatFailed: expect.stringContaining('targets'),
    })
  })

  it('rejects a generated program target without an explicit kind', async () => {
    const manifest = `${JSON.stringify({
      version: 2,
      evalPrivacyFingerprint: 'safe',
      targets: [{
        name: 'review',
        kind: 'flow',
        module: './review.ts',
        export: 'review',
        definitionId: 'flow:review',
        fingerprint: 'definition-review-v1',
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
        "export const runtimeProgram = { manifestHash: 'program', targets: [{ name: 'review' }], targetDefinitions: [{ targetId: 'review', definitionId: 'flow:review', fingerprint: 'definition-review-v1' }], providers: [], transports: [] }",
      ].join('\n'),
    })

    await expect(loadGeneratedRuntimeProgram(root)).rejects.toMatchObject({
      code: 'ARTIFACTS_STALE',
    })
  })

  it('rejects non-empty transports without generated provider authority', async () => {
    const manifest = `${JSON.stringify({
      version: 2,
      evalPrivacyFingerprint: 'safe',
      targets: [],
      providers: [{
        id: 'orders.webhook',
        module: './providers.ts',
        export: 'orders',
        definitionId: 'signal.provider:orders.webhook',
        fingerprint: 'provider-v1',
      }],
      transports: [{
        id: 'binding.orders',
        module: './providers.ts',
        export: 'ordersBinding',
        definitionId: 'signal.transportBinding:binding.orders',
        fingerprint: 'binding-v1',
        providerId: 'orders.webhook',
        signalId: 'order.submitted',
      }],
      evals: [],
    })}\n`
    const { createHash } = await import('node:crypto')
    const hash = createHash('sha256').update(manifest).digest('hex')
    const root = await fixture({
      '.crux/generated/runtime/manifest.json': manifest,
      '.crux/generated/runtime/program.ts': [
        `export const runtimeArtifactManifestHash = '${hash}'`,
        "export const runtimeProgramFormat = 'crux-runtime-program:v1'",
        "export const runtimeProgram = { manifestHash: 'program', targets: [], targetDefinitions: [], providers: [], transports: [{ id: 'binding.orders' }] }",
      ].join('\n'),
    })

    await expect(loadGeneratedRuntimeProgram(root)).rejects.toMatchObject({
      code: 'ARTIFACTS_STALE',
      whatFailed: expect.stringContaining('providers or transports'),
    })
  })

  it('rejects mismatched provider authority against the manifest', async () => {
    const manifest = `${JSON.stringify({
      version: 2,
      evalPrivacyFingerprint: 'safe',
      targets: [],
      providers: [{
        id: 'orders.webhook',
        module: './providers.ts',
        export: 'orders',
        definitionId: 'signal.provider:orders.webhook',
        fingerprint: 'provider-v1',
      }],
      transports: [{
        id: 'binding.orders',
        module: './providers.ts',
        export: 'ordersBinding',
        definitionId: 'signal.transportBinding:binding.orders',
        fingerprint: 'binding-v1',
        providerId: 'orders.webhook',
        signalId: 'order.submitted',
      }],
      evals: [],
    })}\n`
    const { createHash } = await import('node:crypto')
    const hash = createHash('sha256').update(manifest).digest('hex')
    const root = await fixture({
      '.crux/generated/runtime/manifest.json': manifest,
      '.crux/generated/runtime/program.ts': [
        `export const runtimeArtifactManifestHash = '${hash}'`,
        "export const runtimeProgramFormat = 'crux-runtime-program:v1'",
        "export const runtimeProgram = { manifestHash: 'program', targets: [], targetDefinitions: [], providers: [{ id: 'other.provider' }], transports: [{ id: 'binding.orders' }] }",
      ].join('\n'),
    })

    await expect(loadGeneratedRuntimeProgram(root)).rejects.toMatchObject({
      code: 'ARTIFACTS_STALE',
      whatFailed: expect.stringContaining('providers or transports'),
    })
  })
})
