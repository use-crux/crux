import type { EvidenceRecordFacts } from "@use-crux/core/project-index";
import { facts, none, type ExtractContext } from "../extensions";
import { internalStaticRecordContext } from "../static-index/compatibility/syntax-record-bridge/native-context";
import {
  resolveStaticSyntaxValue,
  staticObjectValue,
  staticStringValue,
} from "../static-index/syntax/record/value";
import {
  evidenceConclusionFact,
  evidenceKindFact,
  evidenceRoleFact,
} from "./fact-values";

const coreModules = new Set(["@use-crux/core", "@use-crux/core/evidence"]);
const sourceProperties = [
  "role",
  "kind",
  "conclusion",
  "data",
  "ref",
  "subject",
  "idempotencyKey",
  "supersedes",
] as const;

/** Projects a canonical member call from normalized static syntax evidence. */
export function extractEvidenceRecord(ctx: ExtractContext) {
  const native = internalStaticRecordContext(ctx);
  if (
    !native ||
    native.match.kind !== "call" ||
    !isCanonicalEvidenceMember(native.match.callee, native.record.imports)
  ) {
    return none();
  }

  const inputValue = resolveStaticSyntaxValue(
    native.match.args[0],
    native.initializers,
  );
  const input = staticObjectValue(inputValue, native.initializers);
  const definitionId = `evidence.record:${ctx.source.safeId(
    `${native.record.relativePath}:${native.match.source.line}:${native.match.source.column}`,
  )}`;
  const role = evidenceRoleFact(
    staticStringValue(property(input, "role"), native.initializers),
  );
  const conclusion = evidenceConclusionFact(
    role,
    staticStringValue(property(input, "conclusion"), native.initializers),
  );
  const definitionFacts: EvidenceRecordFacts = {
    kind: "evidence.record",
    role,
    evidenceKind: evidenceKindFact(
      staticStringValue(property(input, "kind"), native.initializers),
    ),
    sourceForm: sourceForm(input),
    subjectMode: hasProperty(input, "subject") ? "explicit" : "ambient",
    idempotent: hasProperty(input, "idempotencyKey"),
    supersedes: hasProperty(input, "supersedes"),
    ...(conclusion ? { conclusion } : {}),
  };
  const sourceRefs = sourceProperties.flatMap((propertyName) => {
    const authoredProperty = input?.properties.find(
      (candidate) =>
        !candidate.spread && candidate.name === propertyName,
    );
    if (!authoredProperty) return [];
    return [
      {
        definitionId,
        ref: {
          id: `${definitionId}:source:config:${propertyName}:${authoredProperty.source.line}:${authoredProperty.source.column}`,
          role: "config" as const,
          property: propertyName,
          source: authoredProperty.source,
          fidelity: "resolved" as const,
          description: `Authored evidence ${propertyName} expression.`,
        },
      },
    ];
  });
  const extractedDefinition = ctx.define.definition({
    variableName: ctx.source.variableName,
    id: definitionId,
    kind: "evidence.record",
    name: "record",
    metadata: { facts: definitionFacts },
  });
  const { sourceSnippet: _sourceSnippet, ...definition } =
    extractedDefinition.definition;

  return facts({
    definitions: [
      { ...extractedDefinition, definition },
    ],
    ...(ctx.source.ownerVariableName
      ? {
          references: [
            ctx.ref.variable(
              "evidence.record.declared_in",
              ctx.source.ownerVariableName,
            ),
          ],
        }
      : {}),
    ...(sourceRefs.length ? { sourceRefs } : {}),
  });
}

function isCanonicalEvidenceMember(
  callee: {
    readonly name: string;
    readonly receiverName?: string;
    readonly moduleSpecifier?: string;
  },
  imports: readonly {
    readonly localName: string;
    readonly importedName: string;
    readonly moduleSpecifier: string;
  }[],
): boolean {
  if (
    callee.name !== "record" ||
    !callee.receiverName ||
    !callee.moduleSpecifier ||
    !coreModules.has(callee.moduleSpecifier)
  ) {
    return false;
  }
  return imports.some(
    (item) =>
      item.localName === callee.receiverName &&
      item.importedName === "evidence" &&
      coreModules.has(item.moduleSpecifier),
  );
}

function property(
  input: ReturnType<typeof staticObjectValue>,
  name: string,
) {
  return input?.properties.find(
    (candidate) => !candidate.spread && candidate.name === name,
  )?.value;
}

function hasProperty(
  input: ReturnType<typeof staticObjectValue>,
  name: string,
): boolean {
  return property(input, name) !== undefined;
}

function sourceForm(
  input: ReturnType<typeof staticObjectValue>,
): EvidenceRecordFacts["sourceForm"] {
  if (!input) return "unresolved";
  const inline = hasProperty(input, "data");
  const reference = hasProperty(input, "ref");
  if (inline === reference) return "invalid";
  return inline ? "inline" : "reference";
}
