import { createHash } from "node:crypto";
import ts from "typescript";
import type {
  StaticImportRecord,
  StaticSourceMatch,
  StaticSyntaxFileInput,
  StaticSyntaxFileRecord,
  StaticSyntaxFrontend,
  StaticSyntaxFrontendOptions,
} from "./types";
import { collectImportBindings } from "../../../ast/imports";
import { createSourceFile } from "../../../ast/parse";
import { sourceForNode, sourceSnippetForNode } from "../../../ast/snippets";
import { sourceInterfaceHashFromSourceFile } from "../../../source-interface-hash";
import {
  createStaticSyntaxCalleeMatcher,
  type StaticSyntaxCalleeMatcher,
} from "./interests";
import {
  collectLocalInitializers,
  scopedInitializerRecordsForNode,
} from "./typescript-local-initializers";
import {
  callMatch,
  matchFromInitializer,
  newMatch,
  type TypeScriptStaticSyntaxMatchInput,
} from "./typescript-matches";
import { staticCalleeRecordFromExpression } from "./typescript-callee";
import { typeScriptDeferNativeFacts } from "./defer-native-facts";
import { typeScriptEffectNativeFacts } from "./effect-native-facts";

const DEFAULT_CONSTRUCTOR_NAMES = ["Agent"] as const;

type ParsedSourceFile = ts.SourceFile & {
  readonly parseDiagnostics?: readonly ts.Diagnostic[];
};

/**
 * Creates the TypeScript-backed syntax-record frontend.
 *
 * This frontend is a compatibility producer for Phase 10A. It proves the record ABI using the
 * existing TypeScript parser before Rust/Oxc is introduced behind the same `StaticSyntaxFrontend`
 * interface.
 */
export function createTypeScriptStaticSyntaxFrontend(
  options: StaticSyntaxFrontendOptions = {},
): StaticSyntaxFrontend {
  const callMatcher = createStaticSyntaxCalleeMatcher({
    names: options.callNames,
    interests: options.callInterests,
  });
  const constructorMatcher = createStaticSyntaxCalleeMatcher({
    names: options.constructorNames,
    interests: options.constructorInterests,
    defaultNames: DEFAULT_CONSTRUCTOR_NAMES,
  });
  return Object.freeze({
    name: "typescript" as const,
    identity: { name: "typescript" as const, version: ts.version },
    parseFile: (input: StaticSyntaxFileInput) =>
      parseTypeScriptSyntaxFile(input, callMatcher, constructorMatcher),
  });
}

function parseTypeScriptSyntaxFile(
  input: StaticSyntaxFileInput,
  callMatcher: StaticSyntaxCalleeMatcher,
  constructorMatcher: StaticSyntaxCalleeMatcher,
): StaticSyntaxFileRecord {
  const sourceFile = createSourceFile(
    input.file,
    input.source,
  ) as ParsedSourceFile;
  const imports = collectImportRecords(input.root, input.file, sourceFile);
  const importsByLocalName = new Map(
    imports.map((item) => [item.localName, item]),
  );
  const localInitializers = collectLocalInitializers(
    sourceFile,
    importsByLocalName,
  );
  const matches = collectMatches({
    root: input.root,
    file: input.file,
    sourceFile,
    importsByLocalName,
    callMatcher,
    constructorMatcher,
  });
  const relativePath = relativeSourcePath(input.root, input.file);
  return {
    schemaVersion: 1,
    frontend: { name: "typescript", version: ts.version },
    file: input.file,
    relativePath,
    sourceHash: sha256(input.source),
    interfaceHash: sourceInterfaceHashFromSourceFile(sourceFile),
    imports,
    matches,
    nativeFacts: [
      ...typeScriptDeferNativeFacts(
        input.file,
        relativePath,
        input.source,
        matches,
      ),
      ...typeScriptEffectNativeFacts(relativePath, matches),
    ],
    localInitializers,
    diagnostics: (sourceFile.parseDiagnostics ?? []).map(
      (diagnostic, index) => ({
        id: `syntax:${input.file}:${index}`,
        severity: "error",
        code: "index.syntax_parse",
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
        source:
          diagnostic.start === undefined
            ? { file: input.file, line: 1, column: 1 }
            : sourceForPosition(sourceFile, diagnostic.start),
      }),
    ),
  };
}

function relativeSourcePath(root: string, file: string): string {
  const normalizedRoot = root.replaceAll("\\", "/").replace(/\/$/, "");
  const normalizedFile = file.replaceAll("\\", "/");
  return normalizedFile.startsWith(`${normalizedRoot}/`)
    ? normalizedFile.slice(normalizedRoot.length + 1)
    : normalizedFile;
}

function collectImportRecords(
  root: string,
  file: string,
  sourceFile: ts.SourceFile,
): readonly StaticImportRecord[] {
  const resolvedByLocalName = collectImportBindings(sourceFile, root, file);
  const records: StaticImportRecord[] = [];
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier)
    )
      continue;
    const moduleSpecifier = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (!clause) continue;
    const declarationKind = clause.isTypeOnly ? "type" : "value";
    if (clause.name) {
      records.push(
        importRecord(
          clause.name.text,
          "default",
          moduleSpecifier,
          declarationKind,
          statement,
          resolvedByLocalName,
        ),
      );
    }
    const namedBindings = clause.namedBindings;
    if (!namedBindings) continue;
    if (ts.isNamespaceImport(namedBindings)) {
      records.push(
        importRecord(
          namedBindings.name.text,
          "*",
          moduleSpecifier,
          declarationKind,
          statement,
          resolvedByLocalName,
        ),
      );
      continue;
    }
    for (const element of namedBindings.elements) {
      const importKind =
        declarationKind === "type" || element.isTypeOnly ? "type" : "value";
      records.push(
        importRecord(
          element.name.text,
          element.propertyName?.text ?? element.name.text,
          moduleSpecifier,
          importKind,
          statement,
          resolvedByLocalName,
        ),
      );
    }
  }
  return records;
}

function importRecord(
  localName: string,
  importedName: string,
  moduleSpecifier: string,
  importKind: "value" | "type",
  statement: ts.ImportDeclaration,
  resolvedByLocalName: ReadonlyMap<string, { readonly file: string }>,
): StaticImportRecord {
  const resolved = resolvedByLocalName.get(localName);
  return {
    localName,
    importedName,
    moduleSpecifier,
    importKind,
    ...(resolved ? { resolvedFile: resolved.file } : {}),
    source: sourceForNode(statement.getSourceFile(), statement),
  };
}

function collectMatches(
  input: TypeScriptStaticSyntaxMatchInput,
): readonly StaticSourceMatch[] {
  const matches: StaticSourceMatch[] = [];

  const visit = (node: ts.Node, ownerVariableName?: string): void => {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node)
    ) {
      ts.forEachChild(node, visit);
      return;
    }
    if (ts.isVariableStatement(node)) {
      const exported = hasExportModifier(node);
      for (const declaration of node.declarationList.declarations) {
        let matchedInitializer = false;
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          const variableName = declaration.name.text;
          const match = matchFromInitializer(
            input,
            variableName,
            declaration.initializer,
            exported,
            scopedInitializerRecordsForNode(
              input.sourceFile,
              declaration,
              input.importsByLocalName,
            ),
          );
          if (match) {
            matches.push(match);
            matchedInitializer = true;
            ts.forEachChild(declaration.initializer, (child) =>
              visit(child, variableName),
            );
          }
        }
        if (!matchedInitializer) {
          if (ts.isIdentifier(declaration.name) && declaration.initializer) {
            visit(declaration.initializer, declaration.name.text);
          } else {
            ts.forEachChild(declaration, (child) =>
              visit(child, ownerVariableName),
            );
          }
        }
      }
      return;
    }
    if (ts.isCallExpression(node)) {
      const callee = staticCalleeRecordFromExpression(
        node.expression,
        input.importsByLocalName,
      );
      if (input.callMatcher.allows(callee)) {
        matches.push(
          callMatch(
            input,
            `${callee.name}-${sourceForNode(input.sourceFile, node).line}`,
            node,
            false,
            scopedInitializerRecordsForNode(
              input.sourceFile,
              node,
              input.importsByLocalName,
            ),
            ownerVariableName,
          ),
        );
      }
    }
    if (ts.isNewExpression(node)) {
      const match = newMatch(
        input,
        `new-${sourceForNode(input.sourceFile, node).line}`,
        node,
        false,
        scopedInitializerRecordsForNode(
          input.sourceFile,
          node,
          input.importsByLocalName,
        ),
      );
      if (match) matches.push(match);
    }
    ts.forEachChild(node, (child) => visit(child, ownerVariableName));
  };

  visit(input.sourceFile);
  return matches;
}

function hasExportModifier(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
    ts
      .getModifiers(node)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  );
}

function sourceForPosition(sourceFile: ts.SourceFile, position: number) {
  const line = sourceFile.getLineAndCharacterOfPosition(position);
  return {
    file: sourceFile.fileName,
    line: line.line + 1,
    column: line.character + 1,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
