import type { ModelInputOrigin } from "./input-origin";
import type {
  ToolDefinitionOrigin,
  ToolDescriptionOrigin,
} from "./input-tool-boundary";

/** Project semantic ingress provenance into flat, privacy-safe trace attributes. @internal */
export function inputOriginAttributes(
  origin: ModelInputOrigin | ToolDefinitionOrigin | undefined,
): Readonly<Record<string, string | number>> {
  if (!origin) return {};

  const common = {
    inputSource: origin.source,
    inputOriginKind: origin.kind,
  };
  switch (origin.source) {
    case "user":
      return {
        ...common,
        ...(origin.messageIndex === undefined
          ? {}
          : { messageIndex: origin.messageIndex }),
        ...(origin.partIndex === undefined
          ? {}
          : { partIndex: origin.partIndex }),
      };
    case "tool":
      return {
        ...common,
        toolName: origin.toolName,
        ...(origin.toolCallId === undefined
          ? {}
          : { toolCallId: origin.toolCallId }),
        ...(origin.partIndex === undefined
          ? {}
          : { partIndex: origin.partIndex }),
      };
    case "retrieval":
      return {
        ...common,
        retrieverId: origin.retrieverId,
        ...(origin.blockIndex === undefined
          ? {}
          : { blockIndex: origin.blockIndex }),
        ...(origin.segmentIndex === undefined
          ? {}
          : { segmentIndex: origin.segmentIndex }),
      };
    case "memory":
      return origin.kind === "memory-context"
        ? {
            ...common,
            memoryId: origin.memoryId,
            ...(origin.blockIndex === undefined
              ? {}
              : { blockIndex: origin.blockIndex }),
          }
        : {
            ...common,
            boardId: origin.boardId,
            ...(origin.blockIndex === undefined
              ? {}
              : { blockIndex: origin.blockIndex }),
          };
    case "handoff":
      return {
        ...common,
        handoffId: origin.handoffId,
        ...(origin.blockIndex === undefined
          ? {}
          : { blockIndex: origin.blockIndex }),
      };
    case "feedback":
      return {
        ...common,
        attempt: origin.attempt,
      };
    case "instructions":
      return {
        ...common,
        ...(origin.contextId === undefined
          ? {}
          : { contextId: origin.contextId }),
        ...(origin.blockIndex === undefined
          ? {}
          : { blockIndex: origin.blockIndex }),
      };
    case "tool-definition":
      return {
        ...common,
        toolName: origin.toolName,
        ...(origin.kind === "discovered"
          ? {
              toolSourceId: origin.sourceId,
              toolSourceKind: origin.sourceKind,
            }
          : {}),
        ...toolDescriptionAttributes(origin),
      };
  }
}

function toolDescriptionAttributes(
  origin: ToolDefinitionOrigin,
): Readonly<Record<string, string | number>> {
  if (!isToolDescriptionOrigin(origin)) return {};
  return {
    descriptionKind: origin.descriptionKind,
    ...(origin.schemaDepth === undefined
      ? {}
      : { schemaDepth: origin.schemaDepth }),
  };
}

function isToolDescriptionOrigin(
  origin: ToolDefinitionOrigin,
): origin is ToolDescriptionOrigin {
  if (!("descriptionKind" in origin)) return false;
  return (
    origin.descriptionKind === "tool" || origin.descriptionKind === "schema"
  );
}
