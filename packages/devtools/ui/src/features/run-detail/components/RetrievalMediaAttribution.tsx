/** Dedicated, non-hydrating presentation for retrieval media attribution. */

import { Chip } from "@/devtools/shell/primitives";
import {
  formatRetrievalMediaLocation,
  type RetrievalMediaAttributionView,
} from "../lib/retrieval-media-attribution";

/** Render allowlisted attribution facts without dereferencing the asset. */
export function RetrievalMediaAttribution({
  attribution,
}: {
  readonly attribution: RetrievalMediaAttributionView | undefined;
}) {
  if (!attribution) return null;

  return (
    <div
      className="mt-1.5 flex flex-wrap items-center gap-1.5"
      aria-label="Media attribution"
    >
      {attribution.assetRef ? (
        <Chip tone="muted" mono>
          {attribution.assetRef}
        </Chip>
      ) : null}
      {attribution.mediaType ? (
        <Chip tone="crux" mono>
          {attribution.mediaType}
        </Chip>
      ) : null}
      {attribution.location ? (
        <Chip tone="muted" mono>
          {formatRetrievalMediaLocation(attribution.location)}
        </Chip>
      ) : null}
    </div>
  );
}
