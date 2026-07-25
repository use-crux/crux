import { md, type PromptText } from "../../src/prompt-text";
import type { ContextTextSegment } from "../../src/prompt/context-types";

const promptText = md;

export interface PromptTextGoldenFixture {
  readonly name: string;
  readonly create: () => PromptText;
  readonly text: string;
  readonly segments?: readonly ContextTextSegment[];
}

const staticSegment = (text: string): ContextTextSegment => ({
  text,
  dynamic: false,
});

const dynamicSegment = (text: string): ContextTextSegment => ({
  text,
  dynamic: true,
});

export const promptTextGoldenFixtures: readonly PromptTextGoldenFixture[] = [
  {
    name: "renders an empty one-line template",
    create: () => promptText``,
    text: "",
    segments: [],
  },
  {
    name: "removes outer blank lines and common spaces",
    create: () => promptText`
      one
        two
    `,
    text: "one\n  two",
  },
  {
    name: "removes a common tab prefix",
    create: () => promptText`\n\t\tone\n\t\ttwo\n`,
    text: "one\ntwo",
  },
  {
    name: "uses the longest exact mixed-whitespace prefix",
    create: () => promptText`\n \tone\n \t  two\n`,
    text: "one\n  two",
  },
  {
    name: "preserves indentation when candidates have no exact prefix",
    create: () => promptText`\n one\n\ttwo\n`,
    text: " one\n\ttwo",
  },
  {
    name: "renders one-line literal text without a newline",
    create: () => promptText`hello`,
    text: "hello",
    segments: [staticSegment("hello")],
  },
  {
    name: "removes an outer-blank-only body",
    create: () => promptText`\n \t\n\t\n`,
    text: "",
    segments: [],
  },
  {
    name: "renders an interpolation-only template without a newline",
    create: () => promptText`${"hello"}`,
    text: "hello",
    segments: [dynamicSegment("hello")],
  },
  {
    name: "coalesces adjacent inline interpolations",
    create: () => promptText`${"a"}${"b"}`,
    text: "ab",
    segments: [dynamicSegment("ab")],
  },
  {
    name: "keeps inline multiline scalar text verbatim",
    create: () => promptText`before ${"a\nb"} after`,
    text: "before a\nb after",
    segments: [
      staticSegment("before "),
      dynamicSegment("a\nb"),
      staticSegment(" after"),
    ],
  },
  {
    name: "keeps inline multiline fragment text verbatim",
    create: () => promptText`before ${promptText`a\n${"b"}`} after`,
    text: "before a\nb after",
    segments: [
      staticSegment("before a\n"),
      dynamicSegment("b"),
      staticSegment(" after"),
    ],
  },
  {
    name: "indents every later line of a block scalar",
    create: () => promptText`
      value:
        ${"a\nb"}
    `,
    text: "value:\n  a\n  b",
    segments: [
      staticSegment("value:\n  "),
      dynamicSegment("a\n"),
      staticSegment("  "),
      dynamicSegment("b"),
    ],
  },
  {
    name: "indents multiline JSON at block position",
    create: () => promptText`
      payload:
        ${promptText.json({ count: 1 })}
    `,
    text: 'payload:\n  {\n    "count": 1\n  }',
    segments: [
      staticSegment("payload:\n  "),
      dynamicSegment("{\n"),
      staticSegment("  "),
      dynamicSegment('  "count": 1\n'),
      staticSegment("  "),
      dynamicSegment("}"),
    ],
  },
  {
    name: "normalizes a nested fragment before parent indentation",
    create: () => promptText`
      - Evidence:
        ${promptText`
          1. First
          2. Second
        `}
    `,
    text: "- Evidence:\n  1. First\n  2. Second",
    segments: [staticSegment("- Evidence:\n  1. First\n  2. Second")],
  },
  {
    name: "renders recursive sequences in source order",
    create: () => {
      const one = promptText`- One`;
      const two = promptText`- Two`;
      const events = [one, false, [two, undefined]];
      return promptText`
        ## Events

        ${events}
      `;
    },
    text: "## Events\n\n- One\n- Two",
  },
  {
    name: "drops empty sequence leaves before inserting separators",
    create: () =>
      promptText`\n${["", promptText``, [false, "one"], undefined, "two"]}\n`,
    text: "one\ntwo",
    segments: [dynamicSegment("one\ntwo")],
  },
  {
    name: "removes an empty carrier at the beginning",
    create: () => promptText`\n${undefined}\nafter\n`,
    text: "after",
  },
  {
    name: "removes an empty carrier in the middle without adding a blank",
    create: () => promptText`\nbefore\n${undefined}\nafter\n`,
    text: "before\nafter",
  },
  {
    name: "removes an empty carrier at the end",
    create: () => promptText`\nbefore\n${undefined}\n`,
    text: "before",
  },
  {
    name: "keeps the larger blank run around an empty carrier",
    create: () => promptText`\nbefore\n\n\n${undefined}\n\nafter\n`,
    text: "before\n\n\nafter",
  },
  {
    name: "keeps preceding whitespace bytes when seam runs tie",
    create: () =>
      promptText`\n    before\n    \n    ${undefined}\n\t\n    after\n`,
    text: "before\n\nafter",
  },
  {
    name: "keeps the earliest longest run across adjacent omissions",
    create: () =>
      promptText`\n    before\n \n    ${undefined}\n\t\n\t\n    ${undefined}\n  \n  \n    after\n`,
    text: "before\n\t\n\t\nafter",
  },
  {
    name: "does not collapse unrelated intentional blank runs",
    create: () => promptText`\nfirst\n\n\nsecond\n${undefined}\nthird\n`,
    text: "first\n\n\nsecond\nthird",
  },
  {
    name: "preserves fenced Markdown bytes",
    create: () => promptText`
      \`\`\`ts
      if (ready) {
        run()
      }
      \`\`\`
    `,
    text: "```ts\nif (ready) {\n  run()\n}\n```",
  },
  {
    name: "keeps literal and scalar ownership distinct",
    create: () => promptText`literal ${42}`,
    text: "literal 42",
    segments: [staticSegment("literal "), dynamicSegment("42")],
  },
  {
    name: "keeps JSON as one dynamic rendering",
    create: () => promptText.json({ count: 1 }),
    text: '{\n  "count": 1\n}',
    segments: [dynamicSegment('{\n  "count": 1\n}')],
  },
  {
    name: "preserves nested fragment ownership",
    create: () => promptText`outer ${promptText`inner ${1}`}`,
    text: "outer inner 1",
    segments: [staticSegment("outer inner "), dynamicSegment("1")],
  },
  {
    name: "assigns sequence separators to dynamic ownership",
    create: () =>
      promptText`\nitems:\n  ${[promptText`- ${1}`, promptText`- ${2}`]}\n`,
    text: "items:\n  - 1\n  - 2",
    segments: [
      staticSegment("items:\n  - "),
      dynamicSegment("1\n"),
      staticSegment("  - "),
      dynamicSegment("2"),
    ],
  },
  {
    name: "keeps inline omission local",
    create: () => promptText`before ${undefined} after`,
    text: "before  after",
    segments: [staticSegment("before  after")],
  },
  {
    name: "renders formatter-readable conditional fragments",
    create: () => {
      const warning =
        false &&
        md`
> Warning
        `;
      return md`
        # Result

        ${warning}
      `;
    },
    text: "# Result\n",
  },
  {
    name: "renders formatter-readable mapped fragments",
    create: () => {
      const events = ["One", "Two"];
      return md`
        ## Events

        ${events.map((event) => md`- ${event}`)}
      `;
    },
    text: "## Events\n\n- One\n- Two",
  },
  {
    name: "preserves XML-significant bytes in every node category",
    create: () =>
      promptText`<literal>&</literal> ${"<scalar>&"} ${promptText`<nested>${"&"}</nested>`} ${promptText.json({ value: "<&>" })}`,
    text:
      "<literal>&</literal> <scalar>& <nested>&</nested> {\n" +
      '  "value": "<&>"\n' +
      "}",
  },
];

export interface PromptTextConstructionErrorFixture {
  readonly name: string;
  readonly create: () => PromptText;
  readonly code: string;
}

export const promptTextConstructionErrorFixtures: readonly PromptTextConstructionErrorFixture[] =
  [
    {
      name: "rejects an empty inline sequence",
      create: () => promptText`before ${[]} after`,
      code: "CRUX_PROMPT_TEXT_INLINE_SEQUENCE",
    },
    {
      name: "rejects a single-item inline sequence",
      create: () => promptText`before ${["one"]} after`,
      code: "CRUX_PROMPT_TEXT_INLINE_SEQUENCE",
    },
    {
      name: "rejects a multi-item inline sequence",
      create: () => promptText`before ${["one", "two"]} after`,
      code: "CRUX_PROMPT_TEXT_INLINE_SEQUENCE",
    },
  ];
