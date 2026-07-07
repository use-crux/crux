import type {
  IndexProjectAstFromSyntaxRecordProviderOptions,
  IndexProjectAstFromSyntaxRecordsOptions,
} from "../index";
import type {
  ArgumentReader,
  ConfigReader,
  DefinitionBuilder,
  ExtensionIdentity,
  ExtractContext,
  ExtractMatch,
  IndexerExtension,
  ReferenceBuilder,
  SourceRefBuilder,
  SourceView,
} from "../extensions";
import type {
  IndexProjectAstFromSyntaxRecordProviderHostOptions,
  IndexProjectAstFromSyntaxRecordsHostOptions,
  NativeFactProjectionMode,
} from "../host/static-index";
import {
  createStaticExtraction,
  createTypeScriptStaticSyntaxFrontend,
} from "../host/static-index";

type Expect<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

type RootAstHostOnlyKeys =
  | "nativeFactProjection"
  | "providedRecordCacheSize"
  | "staticCacheHits"
  | "staticSyntaxFrontend";

type PublicRecordsDoNotExposeHostOnlyKeys = Expect<
  Equal<
    Extract<keyof IndexProjectAstFromSyntaxRecordsOptions, RootAstHostOnlyKeys>,
    never
  >
>;

type PublicProviderDoNotExposeHostOnlyKeys = Expect<
  Equal<
    Extract<
      keyof IndexProjectAstFromSyntaxRecordProviderOptions,
      RootAstHostOnlyKeys
    >,
    never
  >
>;

type HostRecordsExposeHostOnlyKeys = Expect<
  Equal<
    Extract<
      keyof IndexProjectAstFromSyntaxRecordsHostOptions,
      RootAstHostOnlyKeys
    >,
    "nativeFactProjection" | "providedRecordCacheSize" | "staticCacheHits"
  >
>;

type HostProviderExposeHostOnlyKeys = Expect<
  Equal<
    Extract<
      keyof IndexProjectAstFromSyntaxRecordProviderHostOptions,
      RootAstHostOnlyKeys
    >,
    "nativeFactProjection" | "providedRecordCacheSize" | "staticCacheHits"
  >
>;

type HostNativeFactProjectionModeIsExplicit = Expect<
  Equal<NativeFactProjectionMode, "inline" | "external" | "native-only">
>;

function staticExtractionFrontendTypeSamples(): void {
  createStaticExtraction({
    root: "/repo",
    syntaxFrontend: createTypeScriptStaticSyntaxFrontend,
    cache: "none",
  });

  // @ts-expect-error root/host static extraction must select a syntax frontend explicitly.
  createStaticExtraction({ root: "/repo", cache: "none" });
}

type FrozenExtractContext = {
  readonly extension: ExtensionIdentity;
  readonly extractor: string;
  readonly match: ExtractMatch;
  readonly source: SourceView;
  readonly args: ArgumentReader;
  readonly config: ConfigReader | undefined;
  readonly define: DefinitionBuilder;
  readonly ref: ReferenceBuilder;
  readonly sourceRef: SourceRefBuilder;
};

type ExtractContextKeysAreFrozen = Expect<
  Equal<keyof ExtractContext, keyof FrozenExtractContext>
>;
type ExtractContextShapeIsFrozen = Expect<
  Equal<
    ExtractContext extends FrozenExtractContext
      ? FrozenExtractContext extends ExtractContext
        ? true
        : false
      : false,
    true
  >
>;

type PublicIndexerExtensionKeysAreFrozen = Expect<
  Equal<
    keyof IndexerExtension,
    "name" | "version" | "crux" | "relations" | "rules" | "extractors"
  >
>;
