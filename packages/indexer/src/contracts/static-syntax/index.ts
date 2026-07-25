/**
 * Static Syntax record contract.
 *
 * Static Syntax records are parser evidence before Project Index projection.
 * This entry point keeps that JSON-safe ABI visible without exposing raw
 * TypeScript, Oxc, or parser-native AST objects.
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
} from "./schema";
export {
  OXC_STATIC_SYNTAX_FRONTEND_IDENTITY,
  staticRecordSchemaProperty,
  staticSyntaxValueToJsonSchema,
} from "./schema";
