import { contentText } from '../../content'
import type { ModelIngressDocument, ModelIngressPatch } from '../../safety/input/model-ingress-document'
import type { ContentPart } from '../../types/content'
import type { ToolModelInputOrigin } from '../../safety/input/model-ingress'

/** @internal Project Core tool content without replacing its native parts. */
export function coreToolContentDocument(
  value: readonly ContentPart[],
  origin: ToolModelInputOrigin,
): ModelIngressDocument<readonly ContentPart[]> {
  return {
    kind: 'document',
    value,
    origin,
    slots: value.map((part, partIndex) => {
      const key = partKey(partIndex)
      if (part.type === 'text') return { kind: 'text', key, value: part.text }
      return {
        kind: 'media',
        key,
        descriptor: contentText([part]),
        subjects: [
          {
            part,
            origin: {
              kind: 'tool-result',
              toolName: origin.toolName,
              ...(origin.toolCallId !== undefined ? { toolCallId: origin.toolCallId } : {}),
              partIndex,
            },
          },
        ],
      }
    }),
  }
}

/** @internal Apply a semantic patch directly to the original Core part list. */
export function applyCoreToolContentPatch(
  value: readonly ContentPart[],
  patch: ModelIngressPatch,
): readonly ContentPart[] {
  if (patch.removed.size === 0 && patch.text.size === 0) return value
  const output: ContentPart[] = []
  for (let partIndex = 0; partIndex < value.length; partIndex++) {
    const part = value[partIndex]
    if (!part) continue
    const key = partKey(partIndex)
    if (patch.removed.has(key)) continue
    const replacement = patch.text.get(key)
    output.push(
      part.type === 'text' && replacement !== undefined && replacement !== part.text
        ? { ...part, text: replacement }
        : part,
    )
  }
  return output
}

function partKey(partIndex: number): string {
  return `part:${partIndex}`
}
