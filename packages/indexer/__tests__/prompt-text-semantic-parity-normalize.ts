import { definitionFingerprintFile } from "../src/indexer/definitions";
import type { IndexPatchFacts } from "../src/indexer/patches";

/** Normalizes machine-local PromptText paths before backend parity assertions. */
export function normalizedPromptTextSourceRefs(
  facts: IndexPatchFacts,
  root: string,
) {
  return (facts.sourceRefs ?? [])
    .filter((sourceRef) => sourceRef.ref.metadata?.promptText)
    .map((sourceRef) => ({
      ...sourceRef,
      ref: {
        ...sourceRef.ref,
        ...(sourceRef.ref.metadata?.promptText?.fragmentJoins
          ? {
              metadata: {
                ...sourceRef.ref.metadata,
                promptText: {
                  ...sourceRef.ref.metadata.promptText,
                  fragmentJoins:
                    sourceRef.ref.metadata.promptText.fragmentJoins.map(
                      (join) => ({
                        ...join,
                        ownerTemplateRange: normalizedRange(
                          root,
                          join.ownerTemplateRange,
                        ),
                        expressionRange: normalizedRange(
                          root,
                          join.expressionRange,
                        ),
                        targetTemplateRange: normalizedRange(
                          root,
                          join.targetTemplateRange,
                        ),
                      }),
                    ),
                },
              },
            }
          : {}),
        source: {
          ...sourceRef.ref.source,
          file: definitionFingerprintFile(root, sourceRef.ref.source.file),
        },
        ...(sourceRef.ref.snippet
          ? {
              snippet: {
                ...sourceRef.ref.snippet,
                range: normalizedRange(root, sourceRef.ref.snippet.range),
              },
            }
          : {}),
      },
    }));
}

function normalizedRange<
  const Range extends {
    readonly file: string;
  },
>(root: string, range: Range): Range {
  return {
    ...range,
    file: definitionFingerprintFile(root, range.file),
  };
}
