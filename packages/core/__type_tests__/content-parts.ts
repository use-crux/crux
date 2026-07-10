import type {
  Asset,
  AssetRef,
  ContentPart,
  GenerationSettings,
  MediaSource,
  Message,
  MessageContent,
  ProviderOptions,
  ToolModelOutput,
} from "../src/index";

type AssertEqual<T, U> =
  (<G>() => G extends T ? 1 : 2) extends <G>() => G extends U ? 1 : 2
    ? (<G>() => G extends U ? 1 : 2) extends <G>() => G extends T ? 1 : 2
      ? true
      : false
    : false;

type Expect<T extends true> = T;

type OptionalKeys<T> = {
  [K in keyof T]-?: Record<string, never> extends Pick<T, K> ? K : never;
}[keyof T];

type ContentPartKind = ContentPart["type"];
type CoreExports = typeof import("../src/index");
type RemovedImageFactoryKey = `image${"Part"}`;
type RemovedFileFactoryKey = `file${"Part"}`;
type RemovedUnsupportedContentErrorKey = `Unsupported${"Content"}Error`;
type OldImageDataKind = `image-${"data"}`;
type OldImageUrlKind = `image-${"url"}`;
type OldFileDataKind = `file-${"data"}`;
type OldFileUrlKind = `file-${"url"}`;
type RemovedUnsupportedContentSettingKey = `unsupported${"Content"}`;

type _ContentPartKinds = Expect<
  AssertEqual<ContentPartKind, "text" | "image" | "file">
>;

type _NoMediaPart = Expect<AssertEqual<Extract<ContentPart, { type: "media" }>, never>>;
type _NoOldImageDataPart = Expect<AssertEqual<Extract<ContentPart, { type: OldImageDataKind }>, never>>;
type _NoOldImageUrlPart = Expect<AssertEqual<Extract<ContentPart, { type: OldImageUrlKind }>, never>>;
type _NoOldFileDataPart = Expect<AssertEqual<Extract<ContentPart, { type: OldFileDataKind }>, never>>;
type _NoOldFileUrlPart = Expect<AssertEqual<Extract<ContentPart, { type: OldFileUrlKind }>, never>>;
type _NoCustomPart = Expect<AssertEqual<Extract<ContentPart, { type: "custom" }>, never>>;
type _NoRemovedImageFactoryExport = Expect<
  AssertEqual<Extract<keyof CoreExports, RemovedImageFactoryKey>, never>
>;
type _NoRemovedFileFactoryExport = Expect<
  AssertEqual<Extract<keyof CoreExports, RemovedFileFactoryKey>, never>
>;
type _NoRemovedUnsupportedContentErrorExport = Expect<
  AssertEqual<Extract<keyof CoreExports, RemovedUnsupportedContentErrorKey>, never>
>;

declare const asset: Asset;
declare const ref: AssetRef;
declare const providerOptions: ProviderOptions;

const urlSource: MediaSource = new URL("https://example.com/image.png");
const byteSource: MediaSource = new Uint8Array([1, 2, 3]);
const blobSource: MediaSource = new Blob(["image bytes"], { type: "image/png" });
const assetSource: MediaSource = asset;

void urlSource;
void byteSource;
void blobSource;
void assetSource;

// @ts-expect-error AssetRef is a persistence reference, not model input.
const refSource: MediaSource = ref;
void refSource;

const imageMessage: Message = {
  role: "user",
  content: [
    { type: "text", text: "describe this", providerOptions },
    { type: "image", source: asset, mediaType: "image/png" },
  ] as const,
};

const fileMessage: Message = {
  role: "user",
  content: [
    {
      type: "file",
      source: new Uint8Array([1]),
      mediaType: "application/pdf",
      filename: "report.pdf",
      providerOptions,
    },
  ] as const,
};

void imageMessage;
void fileMessage;

// @ts-expect-error ProviderOptions values must be JSON records.
const blobProviderOptions: ProviderOptions = { openai: { payload: new Blob() } };
void blobProviderOptions;

// @ts-expect-error ProviderOptions records are readonly.
providerOptions.openai = {};

const textMessage: Message = { role: "user", content: "hello" };
const partMessage: Message = {
  role: "user",
  content: [{ type: "text", text: "hello" }] as const,
};

const textContent: MessageContent = textMessage.content;
const partContent: MessageContent = partMessage.content;

void textContent;
void partContent;

// @ts-expect-error SDK-shaped tool calls are control metadata, not content.
const toolCallPart: ContentPart = { type: "tool-call", toolCallId: "call_1" };

// @ts-expect-error SDK-shaped approval requests are control metadata, not content.
const approvalRequestPart: ContentPart = { type: "tool-approval-request", toolCallId: "call_1" };

// @ts-expect-error SDK-shaped approval responses are control metadata, not content.
const approvalResponsePart: ContentPart = { type: "tool-approval-response", toolCallId: "call_1" };

void toolCallPart;
void approvalRequestPart;
void approvalResponsePart;

type ToolContentOutput = Extract<ToolModelOutput, { type: "content" }>;

type _ToolModelOutputContent = Expect<
  AssertEqual<ToolContentOutput["value"], readonly ContentPart[]>
>;

type ImageUrlPart = Extract<ContentPart, { type: OldImageUrlKind }>;
type FileUrlPart = Extract<ContentPart, { type: OldFileUrlKind }>;

type _ImageUrlOptionalKeys = Expect<
  AssertEqual<OptionalKeys<ImageUrlPart>, never>
>;
type _FileUrlOptionalKeys = Expect<
  AssertEqual<OptionalKeys<FileUrlPart>, never>
>;
type ImagePart = Extract<ContentPart, { type: "image" }>;
type FilePart = Extract<ContentPart, { type: "file" }>;

declare const readonlyImagePart: ImagePart;
// @ts-expect-error content parts are immutable invocation values.
readonlyImagePart.source = new Uint8Array([4]);

type _ImageOptionalKeys = Expect<
  AssertEqual<OptionalKeys<ImagePart>, "mediaType" | "providerOptions">
>;
type _FileOptionalKeys = Expect<
  AssertEqual<OptionalKeys<FilePart>, "mediaType" | "filename" | "providerOptions">
>;
type _ImageSource = Expect<AssertEqual<ImagePart["source"], MediaSource>>;
type _FileSource = Expect<AssertEqual<FilePart["source"], MediaSource>>;
type _NoRemovedUnsupportedContentSetting = Expect<
  AssertEqual<Extract<keyof GenerationSettings, RemovedUnsupportedContentSettingKey>, never>
>;
