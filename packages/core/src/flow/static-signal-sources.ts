/** Runtime inspection of static Signal declarations in a Flow map. */

import type { FlowSignalMap } from "./signals";
import { signalSourceId, type StaticSignalSource } from "../signal/source";

/** Return static Signal ids declared in a mixed Flow signal map. */
export function staticSignalSourceIds(
  signals: FlowSignalMap | undefined,
): readonly string[] {
  if (!signals) return [];
  return (Object.values(signals) as readonly unknown[]).flatMap((source) => {
    if (
      typeof source === "object" &&
      source !== null &&
      "_tag" in source &&
      (source._tag === "Signal" || source._tag === "FilteredSignal")
    ) {
      return [signalSourceId(source as StaticSignalSource)];
    }
    return [];
  });
}
