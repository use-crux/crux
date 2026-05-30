import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { indexProject } from '@crux/source-indexer'

const fileCount = Number(process.env.CRUX_INDEXER_PERF_FILES ?? 80)
const promptsPerFile = Number(process.env.CRUX_INDEXER_PERF_PROMPTS_PER_FILE ?? 4)
const maxMs = process.env.CRUX_INDEXER_PERF_MAX_MS ? Number(process.env.CRUX_INDEXER_PERF_MAX_MS) : undefined

const root = await mkdtemp(join(tmpdir(), 'crux-indexer-perf-'))

try {
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(
    join(root, 'crux.config.ts'),
    `
      import { config } from '@crux/core'
      export default config({})
    `,
  )

  for (let fileIndex = 0; fileIndex < fileCount; fileIndex++) {
    const definitions = Array.from({ length: promptsPerFile }, (_, promptIndex) => {
      const id = `prompt-${fileIndex}-${promptIndex}`
      return `export const prompt_${fileIndex}_${promptIndex} = prompt({
        id: '${id}',
        input: z.object({
          topic: z.string().max(200),
          tone: z.enum(['brief', 'detailed']).optional(),
          tags: z.array(z.string()).max(4),
        }),
        prompt: 'Write ${id}',
      })`
    }).join('\n\n')

    await writeFile(
      join(root, `src/prompts-${fileIndex}.ts`),
      `
        import { prompt } from '@crux/core'
        import { z } from 'zod'

        ${definitions}
      `,
    )
  }

  const started = performance.now()
  const snapshot = await indexProject({ root, staticOnly: true, projectName: 'perf-smoke' })
  const elapsedMs = Math.round(performance.now() - started)

  const result = {
    elapsedMs,
    files: fileCount,
    promptsPerFile,
    definitions: snapshot.definitions.length,
    relations: snapshot.relations.length,
    diagnostics: snapshot.diagnostics.length,
  }

  console.log(JSON.stringify(result, null, 2))

  if (maxMs !== undefined && elapsedMs > maxMs) {
    throw new Error(`Catalog indexer perf smoke exceeded ${maxMs}ms: ${elapsedMs}ms`)
  }
} finally {
  await rm(root, { recursive: true, force: true })
}
