import type { ModelInputOrigin } from './input-origin'

/** Project semantic ingress provenance into flat, privacy-safe trace attributes. @internal */
export function inputOriginAttributes(
  origin: ModelInputOrigin | undefined,
): Readonly<Record<string, string | number>> {
  if (!origin) return {}

  const common = {
    inputSource: origin.source,
    inputOriginKind: origin.kind,
  }
  switch (origin.source) {
    case 'user':
      return {
        ...common,
        ...(origin.messageIndex === undefined ? {} : { messageIndex: origin.messageIndex }),
        ...(origin.partIndex === undefined ? {} : { partIndex: origin.partIndex }),
      }
    case 'tool':
      return {
        ...common,
        toolName: origin.toolName,
        ...(origin.toolCallId === undefined ? {} : { toolCallId: origin.toolCallId }),
        ...(origin.partIndex === undefined ? {} : { partIndex: origin.partIndex }),
      }
    case 'retrieval':
      return {
        ...common,
        retrieverId: origin.retrieverId,
        ...(origin.blockIndex === undefined ? {} : { blockIndex: origin.blockIndex }),
        ...(origin.segmentIndex === undefined ? {} : { segmentIndex: origin.segmentIndex }),
      }
  }
}
