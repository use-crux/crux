import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { indexProjectAst, indexProjectSemantic } from '@crux/indexer'

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
  const astStarted = performance.now()
  const astPatch = await indexProjectAst({ root, projectName: 'perf-smoke' })
  const astMs = Math.round(performance.now() - astStarted)
  const semanticStarted = performance.now()
  const semanticPatch = await indexProjectSemantic({ root, projectName: 'perf-smoke' })
  const semanticMs = Math.round(performance.now() - semanticStarted)
  const elapsedMs = Math.round(performance.now() - started)

  const result = {
    elapsedMs,
    phases: {
      cache: {
        status: 'not-measured',
        elapsedMs: 0,
      },
      ast: {
        status: astPatch.status,
        elapsedMs: astMs,
      },
      semantic: {
        status: semanticPatch.status,
        elapsedMs: semanticMs,
      },
    },
    files: fileCount,
    promptsPerFile,
    definitions: astPatch.facts.definitions?.length ?? 0,
    relations: astPatch.facts.relations?.length ?? 0,
    diagnostics: (astPatch.facts.diagnostics?.length ?? 0) + (semanticPatch.facts.diagnostics?.length ?? 0),
  }

  console.log(JSON.stringify(result, null, 2))

  if (maxMs !== undefined && elapsedMs > maxMs) {
    throw new Error(`Index indexer perf smoke exceeded ${maxMs}ms: ${elapsedMs}ms`)
  }
} finally {
  await rm(root, { recursive: true, force: true })
}
