import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  genericQueue,
  inMemoryRuntimeStore,
  serverless,
} from '@use-crux/core/runtime'
import { preflightRuntime } from '../src/indexer/runtime-ops'

const EMPTY_MANIFEST_V3 = {
  version: 3,
  evalPrivacyFingerprint:
    'd2b7a3a9e0d3857b24b871ee585d118490dabd9edf81bcf10de9f5328e85cc29',
  targets: [],
  providers: [],
  transports: [],
  evals: [],
} as const

describe('runtime namespace preflight', () => {
  it('rejects an obsolete local Runtime artifact manifest with a regeneration remedy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crux-runtime-ops-'))
    try {
      await mkdir(join(root, '.crux/generated/runtime'), { recursive: true })
      await writeFile(
        join(root, '.crux/generated/runtime/manifest.json'),
        `${JSON.stringify({ version: 1, targets: [] })}\n`,
      )
      const runtime = serverless({
        store: {
          ...inMemoryRuntimeStore(),
          setup: {
            check: async () => ({ ok: true, findings: [] }),
            apply: async () => ({ ok: true, findings: [] }),
          },
        },
        publicUrl: 'https://app.example.com',
        env: {},
        wake: genericQueue({ enqueue: async () => undefined }),
      })

      await expect(preflightRuntime(root, runtime)).rejects.toMatchObject({
        code: 'RUNTIME_ARTIFACT_MANIFEST_INCOMPATIBLE',
        message: expect.stringMatching(
          /schema version 1[\s\S]*crux runtime generate/i,
        ),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each([
    [
      'malformed Eval arm',
      {
        ...EMPTY_MANIFEST_V3,
        evals: [
          {
            id: 'support',
            module: './evals/support.eval.ts',
            export: 'default',
            evalFingerprint: 'eval',
            cases: [],
            variants: [{ name: 'current', fingerprint: 'arm' }],
            requiredHostCapabilities: [],
          },
        ],
      },
    ],
    ['unknown key', { ...EMPTY_MANIFEST_V3, unexpected: true }],
  ])('rejects a v3 manifest with %s', async (_name, manifest) => {
    const root = await mkdtemp(join(tmpdir(), 'crux-runtime-ops-'))
    try {
      await mkdir(join(root, '.crux/generated/runtime'), { recursive: true })
      await writeFile(
        join(root, '.crux/generated/runtime/manifest.json'),
        `${JSON.stringify(manifest)}\n`,
      )
      const runtime = serverless({
        store: {
          ...inMemoryRuntimeStore(),
          setup: {
            check: async () => ({ ok: true, findings: [] }),
            apply: async () => ({ ok: true, findings: [] }),
          },
        },
        publicUrl: 'https://app.example.com',
        env: {},
        wake: genericQueue({ enqueue: async () => undefined }),
      })

      await expect(preflightRuntime(root, runtime)).rejects.toMatchObject({
        code: 'RUNTIME_ARTIFACT_MANIFEST_INVALID',
        message: expect.stringMatching(/manifest v3[\s\S]*runtime generate/i),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('includes a fallback namespace warning without failing preflight', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crux-runtime-ops-'))
    try {
      await mkdir(join(root, '.crux/generated/runtime'), { recursive: true })
      await writeFile(
        join(root, '.crux/generated/runtime/manifest.json'),
        `${JSON.stringify(EMPTY_MANIFEST_V3)}\n`,
      )
      const runtime = serverless({
        store: {
          ...inMemoryRuntimeStore(),
          setup: {
            check: async () => ({ ok: true, findings: [] }),
            apply: async () => ({ ok: true, findings: [] }),
          },
        },
        publicUrl: 'https://app.example.com',
        env: {},
        wake: genericQueue({ enqueue: async () => undefined }),
      })

      await expect(preflightRuntime(root, runtime)).resolves.toMatchObject({
        ok: true,
        setup: {
          ok: true,
          findings: [
            expect.objectContaining({
              code: 'NAMESPACE_AMBIGUOUS',
              severity: 'warning',
            }),
          ],
        },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
