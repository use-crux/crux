import type {
  EmbeddingCallFacts,
  ProjectIndexMediaModality,
} from "@use-crux/core/project-index";
import { facts, none, type ExtractContext } from "../extensions";
import { safeId } from "../definitions";
import { internalStaticRecordContext } from "../static-index/compatibility/syntax-record-bridge/native-context";
import type {
  StaticCalleeRecord,
  StaticSyntaxFileRecord,
  StaticSyntaxValue,
} from "../static-index/syntax/record/types";
import {
  resolveStaticSyntaxValue,
  staticObjectValue,
  staticStringValue,
} from "../static-index/syntax/record/value";
import { embeddingFactoryDeclarations } from "./manifest";
import { mediaTypeModality } from "./semantic-values";
import { byteSafeEmbeddingDefinition } from "./safe-definition";

/** Projects a callsite only when normalized syntax proves its receiver is an authored embedding. */
export function extractEmbeddingCall(ctx: ExtractContext) {
  if (ctx.match.name !== "embed" && ctx.match.name !== "embedMany")
    return none();
  const native = internalStaticRecordContext(ctx);
  if (!native || native.match.kind !== "call") return none();
  const receiverName = native.match.callee.receiverName;
  if (!receiverName) return none();
  const receiver = embeddingReceiver(
    receiverName,
    native.record,
    native.recordsByFile,
  );
  if (!receiver) return none();

  const id = `embedding.call:${ctx.source.safeId(
    `${native.record.relativePath}:${native.match.source.line}:${native.match.source.column}`,
  )}`;
  const modalities = inputModalities(native.match.args[0], native.initializers);
  const options = staticObjectValue(native.match.args[1], native.initializers);
  const role = options
    ? staticStringValue(
        options.properties.find((property) => property.name === "role")?.value,
        native.initializers,
      )
    : undefined;
  const callFacts: EmbeddingCallFacts = {
    kind: "embedding.call",
    operation: ctx.match.name,
    ...(modalities ? { modalities } : {}),
    ...(role === "query" || role === "document" ? { role } : {}),
  };
  return facts({
    definitions: [
      byteSafeEmbeddingDefinition(
        ctx.define.definition({
          variableName: ctx.source.variableName,
          id,
          kind: "embedding.call",
          name: ctx.match.name,
          metadata: { facts: callFacts },
        }),
      ),
    ],
    references: [
      ctx.ref.id("embedding.call.uses_embedding", receiver.definitionId),
    ],
  });
}

function embeddingReceiver(
  localName: string,
  record: StaticSyntaxFileRecord,
  recordsByFile: ReadonlyMap<string, StaticSyntaxFileRecord> | undefined,
): { readonly definitionId: string } | undefined {
  const local = record.localInitializers.find(
    (item) => item.name === localName,
  );
  if (local) {
    const value = resolveStaticSyntaxValue(
      local.value,
      new Map(record.localInitializers.map((item) => [item.name, item.value])),
    );
    return isEmbeddingFactoryCall(value)
      ? { definitionId: embeddingId(record.relativePath, local.name) }
      : undefined;
  }
  const imported = record.imports.find(
    (item) => item.localName === localName && item.resolvedFile,
  );
  const importedRecord = imported?.resolvedFile
    ? recordsByFile?.get(imported.resolvedFile)
    : undefined;
  const initializer = importedRecord?.localInitializers.find(
    (item) => item.name === imported?.importedName,
  );
  return initializer && isEmbeddingFactoryCall(initializer.value)
    ? {
        definitionId: embeddingId(
          importedRecord!.relativePath,
          initializer.name,
        ),
      }
    : undefined;
}

function isEmbeddingFactoryCall(value: StaticSyntaxValue | undefined): boolean {
  if (value?.kind !== "call") return false;
  return embeddingFactoryDeclarations.some(
    (factory) =>
      value.callee.name === factory.call &&
      value.callee.moduleSpecifier === factory.module,
  );
}

function embeddingId(relativePath: string, binding: string): string {
  return `embedding:${safeId(`${relativePath}:${binding}`)}`;
}

function inputModalities(
  value: StaticSyntaxValue | undefined,
  initializers: Parameters<typeof resolveStaticSyntaxValue>[1],
): readonly ProjectIndexMediaModality[] | undefined {
  const resolved = resolveStaticSyntaxValue(value, initializers);
  if (!resolved) return undefined;
  if (resolved.kind === "literal" && typeof resolved.value === "string")
    return ["text"];
  if (resolved.kind === "object") {
    const type = staticStringValue(
      resolved.properties.find((property) => property.name === "type")?.value,
      initializers,
    );
    if (type === "file") return ["document"];
    if (isModality(type)) return [type];
    const inferred = mediaTypeModality(
      staticStringValue(
        resolved.properties.find((property) => property.name === "mediaType")
          ?.value,
        initializers,
      ),
    );
    return inferred ? [inferred] : undefined;
  }
  if (resolved.kind !== "array") return undefined;
  const nested = resolved.elements.map((item) =>
    inputModalities(item, initializers),
  );
  if (nested.some((item) => item === undefined)) return undefined;
  return [...new Set(nested.flatMap((item) => item ?? []))];
}

function isModality(
  value: string | undefined,
): value is ProjectIndexMediaModality {
  return ["text", "image", "audio", "video", "document"].includes(value ?? "");
}
