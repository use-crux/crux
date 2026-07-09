import type {
  ContentPart,
  GenerationSettings,
  Message,
  MessageContent,
  ToolModelOutput,
} from "../index";

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

type _ContentPartKinds = Expect<
  AssertEqual<
    ContentPartKind,
    | "text"
    | "image-data"
    | "image-url"
    | "image-file-id"
    | "file-data"
    | "file-url"
    | "file-id"
    | "custom"
  >
>;

type _NoMediaPart = Expect<AssertEqual<Extract<ContentPart, { type: "media" }>, never>>;

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

type ImageUrlPart = Extract<ContentPart, { type: "image-url" }>;
type FileUrlPart = Extract<ContentPart, { type: "file-url" }>;

type _ImageUrlOptionalKeys = Expect<
  AssertEqual<OptionalKeys<ImageUrlPart>, "mediaType" | "providerOptions">
>;
type _FileUrlOptionalKeys = Expect<
  AssertEqual<OptionalKeys<FileUrlPart>, "mediaType" | "filename" | "providerOptions">
>;
type _FileUrlMediaType = Expect<AssertEqual<FileUrlPart["mediaType"], string | undefined>>;
type _FileUrlFilename = Expect<AssertEqual<FileUrlPart["filename"], string | undefined>>;

type _UnsupportedContentSetting = Expect<
  AssertEqual<GenerationSettings["unsupportedContent"], "degrade" | "error" | undefined>
>;
