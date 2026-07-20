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

  it('includes a fallback namespace warning without failing preflight', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crux-runtime-ops-'))
    try {
      await mkdir(join(root, '.crux/generated/runtime'), { recursive: true })
      await writeFile(
        join(root, '.crux/generated/runtime/manifest.json'),
        `${JSON.stringify({ version: 2, targets: [] })}\n`,
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
