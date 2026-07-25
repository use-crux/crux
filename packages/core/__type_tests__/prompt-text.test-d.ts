/** Compile-time contracts for public PromptText authoring and integration. */

import { expectTypeOf } from "vitest";
import { z } from "zod";
import type { Message } from "../src/generation/messages";
import {
  md as publicMd,
  type PromptText as PublicPromptText,
} from "../src/index";
import type { ProjectSourceRef } from "../src/project-index";
import { context, prompt } from "../src/prompt";
import { md, type PromptText } from "../src/prompt-text";
import type { AnyMessage } from "../src/types";
import type { MessageContent } from "../src/types/content";
// @ts-expect-error — private renderer nodes are not part of the root API.
import type { PromptTextNode, SnapshotValue } from "../src/index";

void (undefined as unknown as PromptTextNode);
void (undefined as unknown as SnapshotValue);

const fragment = md`
Reusable
`;
expectTypeOf(fragment).toEqualTypeOf<PromptText>();
expectTypeOf(publicMd).toEqualTypeOf(md);
expectTypeOf<PublicPromptText>().toEqualTypeOf<PromptText>();

// Mirrors the leading documentation example so public authoring drift fails CI.
const documentedVoice = context({
  id: "documented-voice",
  system: publicMd`
    ## Voice

    Be concise and helpful.
  `,
});

prompt({
  id: "documented-answer",
  use: [documentedVoice],
  input: z.object({ question: z.string() }),
  system: publicMd`
    # Role

    You are a product support assistant.
  `,
  prompt: ({ input }) => publicMd`
    ## Question

    ${input.question}
  `,
});

const promptTextSourceRef = {
  id: "prompt:writer:source:prompt:prompt:prompt-text:src-writer.ts-acde:1:1",
  role: "prompt",
  property: "prompt",
  source: { file: "src/writer.ts", line: 1, column: 1 },
  fidelity: "resolved",
  metadata: {
    promptText: {
      tag: "md",
      language: "markdown",
      lifecycle: "static",
    },
  },
} satisfies ProjectSourceRef;

expectTypeOf(promptTextSourceRef.metadata.promptText.tag).toEqualTypeOf<"md">();

// @ts-expect-error — PromptText is opaque, not a string.
const promptTextAsString: string = fragment;
// @ts-expect-error — strings do not forge the nominal PromptText brand.
const stringAsPromptText: PromptText = "text";
void promptTextAsString;
void stringAsPromptText;

md`${"text"}${42}${fragment}${false}${null}${undefined}`;

const mutableValues: Array<
  | string
  | number
  | PromptText
  | false
  | null
  | undefined
  | readonly PromptText[]
> = ["text", 42, fragment, false, null, undefined, [fragment]];
md`
  ${mutableValues}
`;

const readonlyValues = [
  "text",
  42,
  fragment,
  false,
  null,
  undefined,
  [
    md`
Nested
    `,
    [
      md`
Deep
      `,
    ],
  ] as const,
] as const;
md`
  ${readonlyValues}
`;

// @ts-expect-error — objects require explicit md.json().
md`${{ secret: "value" }}`;
// @ts-expect-error — Promise interpolation is asynchronous and unsupported.
md`${Promise.resolve("value")}`;
// @ts-expect-error — true is not the omission sentinel.
md`${true}`;
declare const widenedBoolean: boolean;
// @ts-expect-error — general booleans are rejected; use a conditional fragment.
md`${widenedBoolean}`;
// @ts-expect-error — bigint interpolation is unsupported.
md`${1n}`;
// @ts-expect-error — symbol interpolation is unsupported.
md`${Symbol("value")}`;
// @ts-expect-error — function interpolation is unsupported.
md`${() => "value"}`;
// @ts-expect-error — async PromptText belongs in an outer callback, not an interpolation.
md`${Promise.resolve(fragment)}`;

prompt({
  id: "direct-prompt-system",
  system: md`
Direct
  `,
});

prompt({
  id: "dynamic-prompt-system",
  input: z.object({ value: z.string() }),
  system: ({ input }) => md`Value: ${input.value}`,
});

prompt({
  id: "async-prompt-system",
  input: z.object({ value: z.string() }),
  system: async ({ input }) => md`Value: ${input.value}`,
});

prompt({
  id: "direct-user-prompt",
  prompt: md`
Direct
  `,
});

prompt({
  id: "dynamic-user-prompt",
  input: z.object({ value: z.string() }),
  prompt: ({ input }) => md`Value: ${input.value}`,
});

prompt({
  id: "invalid-async-user-prompt",
  // @ts-expect-error — user-prompt callbacks remain synchronous.
  prompt: async () => md`
Async
  `,
});

context({
  id: "direct-context-system",
  system: md`
Direct
  `,
});

context({
  id: "dynamic-context-system",
  input: z.object({ value: z.string() }),
  system: ({ input }) => md`Value: ${input.value}`,
});

context({
  id: "async-context-system",
  input: z.object({ value: z.string() }),
  system: async ({ input }) => md`Value: ${input.value}`,
});

// @ts-expect-error — canonical message content does not include PromptText.
const canonicalContent: MessageContent = fragment;
// @ts-expect-error — canonical messages do not lower PromptText.
const canonicalMessage: Message = { role: "user", content: fragment };
void canonicalContent;
void canonicalMessage;

const providerOpenMessages: AnyMessage[] = [
  { role: "provider", content: fragment },
];
prompt({ messages: () => providerOpenMessages });

prompt({
  // @ts-expect-error — system callbacks must return supported system content.
  system: () => ({ unsupported: true }),
});

context({
  id: "invalid-context-result",
  // @ts-expect-error — context callbacks must return supported system content.
  system: () => ({ unsupported: true }),
});
