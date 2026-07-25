import { canonicalPromptTextIdentity } from "../../../model/prompt-text-identity";
import type { Node as TsgoNode } from "@typescript/native-preview/unstable/ast";
import { semanticPromptTextCandidateEdges } from "../../../model/prompt-text-reachability";
import { semanticPromptTextSourceRefs } from "../../../model/prompt-text-source-refs";
import type { TsgoSemanticCompilerView } from "../compiler-view";
import type { TsgoNativeSourceLookup } from "../source-lookup";
import type { NativeDefinition, SourceRefFact } from "./types";

/** Projects manifest-declared prompt-text refs through shared semantic reachability. */
export function nativeDirectPromptTextSourceRefs(
  root: string,
  definition: NativeDefinition,
  view: TsgoSemanticCompilerView,
  sourceLookup: TsgoNativeSourceLookup,
): readonly SourceRefFact[] | undefined {
  const properties = definition.primitive.promptText;
  if (
    !properties ||
    properties.length === 0 ||
    (definition.kind !== "prompt" && definition.kind !== "context")
  ) {
    return [];
  }

  const candidate = {
    definitionId: definition.id,
    kind: definition.kind,
    name: definition.name,
    object: definition.object,
  } as const;
  for (const edge of semanticPromptTextCandidateEdges(
    candidate,
    view,
    properties,
  )) {
    const taggedTemplate = edge.tag as TsgoNode;
    const tag = view.syntax.taggedTemplateTag(taggedTemplate);
    if (!tag) return undefined;
    const status = sourceLookup.canonicalExportStatus(
      tag,
      canonicalPromptTextIdentity.module,
      canonicalPromptTextIdentity.export,
    );
    if (status === "unresolved") return undefined;
    if (
      status === "canonical" &&
      (view.syntax.sourceFile(taggedTemplate).fileName !==
        definition.variable.file.fileName ||
        !sourceLookup.isDirectCanonicalImport(
          tag,
          canonicalPromptTextIdentity.module,
          canonicalPromptTextIdentity.export,
        ))
    ) {
      return undefined;
    }
  }

  return semanticPromptTextSourceRefs(root, candidate, view, properties).map(
    (ref) => ({ definitionId: definition.id, ref }),
  );
}
