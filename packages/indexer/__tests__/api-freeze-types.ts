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
type Expect<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

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
