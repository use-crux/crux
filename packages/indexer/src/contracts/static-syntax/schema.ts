/**
 * Canonical TypeScript contract for static syntax records.
 *
 * Static syntax records are parser evidence, not parser ASTs. This spine path
 * keeps the ABI discoverable for TypeScript callers and cross-language fixture
 * work while the extraction implementation remains under `static-index/syntax/record`.
 *
 * @module
 */

export type {
  StaticArrayValue,
  StaticCallSourceMatch,
  StaticCallValue,
  StaticCalleeRecord,
  StaticFunctionCallValue,
  StaticFunctionValue,
  StaticIdentifierValue,
  StaticImportRecord,
  StaticInitializerRecord,
  StaticLiteralValue,
  StaticNativeFactProjection,
  StaticNewSourceMatch,
  StaticObjectProperty,
  StaticObjectSourceMatch,
  StaticObjectValue,
  StaticPropertyAccessValue,
  StaticSourceMatch,
  StaticSourceMatchBase,
  StaticSyntaxCallInterest,
  StaticSyntaxConstructorInterest,
  StaticSyntaxFileInput,
  StaticSyntaxFileRecord,
  StaticSyntaxFrontend,
  StaticSyntaxFrontendFactory,
  StaticSyntaxFrontendIdentity,
  StaticSyntaxFrontendName,
  StaticSyntaxFrontendOptions,
  StaticSyntaxValue,
  StaticTaggedTemplateExpression,
  StaticTaggedTemplateValue,
  StaticTemplateValue,
  StaticUnsupportedValue,
} from "../../indexer/static-index/syntax";
export { OXC_STATIC_SYNTAX_FRONTEND_IDENTITY } from "../../indexer/static-index/syntax";
export {
  staticRecordSchemaProperty,
  staticSyntaxValueToJsonSchema,
} from "../../indexer/static-index/syntax/record/schema";
