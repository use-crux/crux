import type { MediaPartLocation } from "./types";

/** Flatten a privacy-safe media location into observability attributes. */
export function mediaLocationAttributes(
  location: MediaPartLocation,
): Readonly<Record<string, string | number>> {
  const common = {
    mediaPartType: location.partType,
    originKind: location.origin.kind,
  };

  switch (location.origin.kind) {
    case "message":
      return {
        ...common,
        messageIndex: location.origin.messageIndex,
        partIndex: location.origin.partIndex,
      };
    case "step":
      return {
        ...common,
        stepIndex: location.origin.stepIndex,
        partIndex: location.origin.partIndex,
      };
    case "tool-result":
      return {
        ...common,
        toolName: location.origin.toolName,
        ...(location.origin.toolCallId
          ? { toolCallId: location.origin.toolCallId }
          : {}),
        partIndex: location.origin.partIndex,
      };
    case "operation":
      return {
        ...common,
        operation: location.origin.operation,
        operationPhase: location.origin.phase,
        field: location.origin.field,
        ...("partIndex" in location.origin
          ? { partIndex: location.origin.partIndex }
          : {
              outputIndex: location.origin.outputIndex,
              ...("sequence" in location.origin
                ? { sequence: location.origin.sequence }
                : {}),
            }),
      };
  }
}
