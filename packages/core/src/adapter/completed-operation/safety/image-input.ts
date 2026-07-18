import type { Asset } from '../../../asset/types'
import type { ImagePromptContent } from '../../../generation/image-contracts'
import type { MediaPartSubject } from '../../../safety/boundary'
import type { MediaGroupDependency } from '../../../safety/media/groups'
import type { MediaVisitGroup, MediaVisitItem } from '../../../safety/media/visit'
import { guardSafetySessionInputOperationMedia, type Safety } from '../../../safety/session'

type DirectImageInput = Readonly<{ readonly prompt: ImagePromptContent }>

/** Guard direct image references and mask before provider normalization. */
export async function guardGeneratedImageInput<TInput>(input: TInput, safety: Safety): Promise<TInput> {
  if (!isDirectImageInput(input)) return input

  const prompt = input.prompt
  const references = (prompt.images ?? []).map((asset, partIndex) => ({
    asset,
    subject: imageSubject(asset, 'images', partIndex),
  }))
  const mask =
    prompt.mask === undefined ? undefined : { asset: prompt.mask, subject: imageSubject(prompt.mask, 'mask', 0) }
  const projected = [...references, ...(mask ? [mask] : [])]
  if (projected.length === 0) return input

  const guarded = await guardSafetySessionInputOperationMedia(
    safety,
    projected.map(
      ({ subject }): MediaVisitItem => ({
        subject,
        groupId: subject.origin.kind === 'operation' && subject.origin.field === 'mask' ? 'mask' : 'references',
      }),
    ),
    inputGroups(references.length, mask !== undefined),
    mask === undefined ? undefined : [maskDependency],
  )
  const retained = new Set(guarded.subjects)
  if (retained.size === projected.length) return input

  const images = references.filter(({ subject }) => retained.has(subject)).map(({ asset }) => asset)
  const retainedMask = mask && retained.has(mask.subject) ? mask.asset : undefined
  const { images: _images, mask: _mask, ...rest } = prompt
  const guardedPrompt = Object.freeze({
    ...rest,
    ...(images.length > 0 ? { images: Object.freeze(images) } : {}),
    ...(retainedMask === undefined ? {} : { mask: retainedMask }),
  })
  return Object.freeze({ ...input, prompt: guardedPrompt }) as TInput
}

const maskDependency: MediaGroupDependency = Object.freeze({
  retainedGroupId: 'mask',
  requiredGroupId: 'references',
  minimumRequired: 1,
})

function inputGroups(referenceCount: number, hasMask: boolean): readonly MediaVisitGroup[] {
  return [
    ...(referenceCount > 0 ? [{ id: 'references', size: referenceCount, minimumRetained: 0 }] : []),
    ...(hasMask ? [{ id: 'mask', size: 1, minimumRetained: 0 }] : []),
  ]
}

function imageSubject(image: Asset, field: 'images' | 'mask', partIndex: number): MediaPartSubject {
  const origin =
    field === 'images'
      ? {
          kind: 'operation' as const,
          operation: 'generateImage' as const,
          phase: 'input' as const,
          field,
          partIndex,
        }
      : {
          kind: 'operation' as const,
          operation: 'generateImage' as const,
          phase: 'input' as const,
          field,
          partIndex: 0 as const,
        }
  return Object.freeze({
    part: Object.freeze({
      type: 'image' as const,
      source: image,
      ...(image.mediaType === undefined ? {} : { mediaType: image.mediaType }),
    }),
    origin: Object.freeze(origin),
  })
}

function isDirectImageInput(value: unknown): value is DirectImageInput {
  if (typeof value !== 'object' || value === null || !('prompt' in value)) return false
  const prompt = value.prompt
  return (
    typeof prompt === 'object' &&
    prompt !== null &&
    'text' in prompt &&
    typeof prompt.text === 'string' &&
    ('images' in prompt || 'mask' in prompt)
  )
}
