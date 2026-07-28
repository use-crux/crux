import {
  ProjectDefinitionKindSchema,
  ProjectDefinitionMetadataSchema,
} from '@use-crux/core/project-index'
import { describe, expect, it } from 'vitest'
import {
  createStaticExtraction,
  type SourceReader,
} from '../src/indexer/static/extraction/engine'
import {
  authoredMediaPrimitiveManifest,
  mediaAuthoredOptionFields,
  mediaOperationNames,
  mediaPrimitiveManifest,
} from '../src/indexer/media/primitive-manifest'
import { createTypeScriptStaticSyntaxFrontend } from '../src/indexer/static-index/syntax'

describe('authored media static indexing', () => {
  it('accepts media definitions and the operation presentation role', () => {
    expect(ProjectDefinitionKindSchema.parse('media.operation')).toBe(
      'media.operation',
    )
    expect(ProjectDefinitionKindSchema.parse('ingest.source')).toBe(
      'ingest.source',
    )
    expect(
      ProjectDefinitionMetadataSchema.parse({
        indexPresentation: { standalone: false, role: 'operation' },
        facts: { kind: 'media.operation', operation: 'generateImage' },
      }),
    ).toEqual({
      indexPresentation: { standalone: false, role: 'operation' },
      facts: { kind: 'media.operation', operation: 'generateImage' },
    })
  })

  it('indexes specialized operations and ingest sources without retaining private authored values', async () => {
    const source = [
      `export const cover = generateImage({ model: 'image-1', prompt: 'private prompt', n: 2, size: '1024x1024', seed: 7, extra: { providerFileId: 'secret' } })`,
      `export const transcript = transcribe({ model: 'whisper-1', audio: 'https://secret.example/audio.mp3', task: { type: 'translate', targetLanguage: 'SECRET_LANGUAGE' }, timestamps: 'segment', diarization: true })`,
      `export const speech = generateSpeech({ model: 'tts-1', text: 'private speech', voice: 'alloy' })`,
      `export const source = fileSource('/private/report.pdf', { namespace: 'manuals', mediaKinds: ['document'], attribution: ['page'], derivation: cover })`,
    ].join('\n')
    const extracted = await extract(source)

    expect(
      extracted.definitions.map((definition) => definition.metadata?.facts),
    ).toEqual([
      {
        kind: 'media.operation',
        operation: 'generateImage',
        outputModalities: ['image'],
        model: 'image-1',
        execution: 'unknown',
        authoredOptions: { n: 2, size: '1024x1024', seed: 7 },
      },
      {
        kind: 'media.operation',
        operation: 'transcribe',
        inputModalities: ['audio'],
        outputModalities: ['text'],
        model: 'whisper-1',
        execution: 'unknown',
        authoredOptions: {
          timestamps: 'segment',
          diarization: true,
          task: 'translate',
        },
      },
      {
        kind: 'media.operation',
        operation: 'generateSpeech',
        inputModalities: ['text'],
        outputModalities: ['audio'],
        model: 'tts-1',
        execution: 'unknown',
        authoredOptions: { voice: 'alloy' },
      },
      {
        kind: 'ingest.source',
        sourceKind: 'file',
        mediaKinds: ['document'],
        namespace: 'manuals',
        attribution: ['page'],
      },
    ])
    expect(JSON.stringify(extracted)).not.toContain('private prompt')
    expect(JSON.stringify(extracted)).not.toContain('secret.example')
    expect(JSON.stringify(extracted)).not.toContain('providerFileId')
    expect(JSON.stringify(extracted)).not.toContain('/private/report.pdf')
    expect(JSON.stringify(extracted)).not.toContain('SECRET_LANGUAGE')
    expect(extracted.relations).toEqual([
      expect.objectContaining({
        type: 'media.derives_with',
        from: 'ingest.source:source',
        to: 'media.operation:cover',
      }),
    ])
  })

  it('indexes proven media generate calls and leaves dynamic calls unresolved', async () => {
    const extracted = await extract(
      [
        `import { generate, stream } from '@use-crux/ai'`,
        `import { prompt } from '@use-crux/core'`,
        `const visionPrompt = prompt({ id: 'vision' })`,
        `export const vision = generate(visionPrompt, { model: 'vision-model', messages: [{ role: 'user', content: [{ type: 'image', source: 'https://private.example/image.png' }] }] })`,
        `export const dynamic = generate(visionPrompt, { model: 'vision-model', messages })`,
        `export const plain = stream(visionPrompt, { model: 'vision-model' })`,
      ].join('\n'),
    )

    expect(extracted.definitions).toHaveLength(1)
    expect(extracted.definitions[0]).toMatchObject({
      id: 'media.operation:vision',
      kind: 'media.operation',
      metadata: {
        facts: {
          kind: 'media.operation',
          operation: 'generate',
          inputModalities: ['image'],
          outputModalities: ['text'],
          adapter: 'ai-sdk',
          model: 'vision-model',
        },
      },
    })
    expect(JSON.stringify(extracted)).not.toContain('private.example')
  })

  it('keeps named operations standalone, presents nested operations as operations, and ignores unsupported forms', async () => {
    const extracted = await extract(
      [
        `const reusable = generateSpeech({ model: 'tts-1', text: 'private' })`,
        `export const pipeline = fileSource('/private/input.png', { mediaKinds: ['image'], derivation: generateImage({ prompt: dynamicPrompt, extra: privateOptions }) })`,
        `export const unsupported = uploadMedia({ url: 'https://private.example/file' })`,
        `export const dynamicSource = fileSource(runtimeSource, runtimeOptions)`,
      ].join('\n'),
    )

    expect(extracted.definitions).toHaveLength(4)
    expect(
      extracted.definitions.find((item) => item.name === 'reusable')?.metadata
        ?.indexPresentation,
    ).toEqual({
      standalone: true,
    })
    expect(
      extracted.definitions.find(
        (item) => item.kind === 'media.operation' && item.name !== 'reusable',
      )?.metadata?.indexPresentation,
    ).toEqual({ standalone: false, role: 'operation' })
    expect(
      extracted.definitions.find((item) => item.name === 'dynamicSource')
        ?.metadata?.facts,
    ).toMatchObject({
      kind: 'ingest.source',
      sourceKind: 'custom',
    })
    expect(extracted.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'media.owner',
          from: expect.stringMatching(/^media\.operation:generateImage-/),
          to: 'ingest.source:pipeline',
        }),
      ]),
    )
    expect(JSON.stringify(extracted)).not.toContain('private.example')
  })

  it('freezes the manifest operation and privacy allowlists', () => {
    expect(mediaOperationNames).toEqual([
      'generate',
      'stream',
      'generateImage',
      'streamImage',
      'transcribe',
      'generateSpeech',
      'streamSpeech',
      'describe',
    ])
    expect(mediaAuthoredOptionFields).toEqual([
      'n',
      'size',
      'aspectRatio',
      'seed',
      'timestamps',
      'diarization',
      'task',
      'voice',
    ])
    expect(mediaPrimitiveManifest.relations?.map((item) => item.type)).toEqual([
      'media.owner',
      'media.uses_prompt',
      'media.uses_routing',
      'media.derives_with',
      'media.targets_index',
      'media.targets_corpus',
      'media.eval_target',
      'media.uses_storage',
    ])
    expect(
      mediaPrimitiveManifest.extractors?.[0]?.patterns.map((pattern) =>
        pattern.kind === 'call'
          ? [pattern.name, pattern.configArg]
          : [pattern.kind, undefined],
      ),
    ).toEqual([
      ['generate', 1],
      ['stream', 1],
      ['generateImage', 0],
      ['streamImage', 0],
      ['transcribe', 0],
      ['generateSpeech', 0],
      ['streamSpeech', 0],
      ['describe', 0],
    ])
    expect(authoredMediaPrimitiveManifest.nativeProjection).toEqual({
      static: { frontend: 'oxc', mode: 'manifest' },
      semantic: { backend: 'tsgo', mode: 'shared-analyzer' },
    })
    expect(authoredMediaPrimitiveManifest.definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'media.operation',
          sourceRefRoles: {
            model: 'config',
            options: 'config',
            safety: 'config',
          },
        }),
      ]),
    )
    expect(JSON.stringify(mediaPrimitiveManifest)).not.toMatch(
      /promptText|mediaExpression|locator|filename|providerId|"extra"/,
    )
  })
})

async function extract(source: string) {
  const file = '/fixture/media.ts'
  const reader: SourceReader = {
    read: async (requested) => {
      if (requested !== file) throw new Error(`Unexpected source: ${requested}`)
      return source
    },
  }
  return createStaticExtraction({
    root: '/fixture',
    cache: 'none',
    sources: reader,
    syntaxFrontend: createTypeScriptStaticSyntaxFrontend,
  }).extractFile(file)
}
