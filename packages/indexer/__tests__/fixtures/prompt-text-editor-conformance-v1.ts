import { md, md as markdown, prompt, type PromptText } from "@use-crux/core";
import * as crux from "@use-crux/core";

const user = "Ada" as const;
const values = ["first", "second"] as string[];
const invalid = true as const;

const namedFragment = md`
  ## Fragment

  Fragment _emphasis_ with [local guide](./guide.md#start).
`;

export const conformancePrompt = prompt({
  id: "editor-conformance",
  prompt: md`
    # Héllo **team** 😀

    > 👋 *Welcome*, ${user}.
    >
    > 1. Read [guide](https://example.com/docs "Guide")
    > 2. Use \`inline code\`

    \`\`\`ts
    run()
    \`\`\`

    ---

    Inline sequence: ${values}

    Block sequence:
    ${values}

    Invalid scalar: ${
      // @ts-expect-error The fixture intentionally proves this diagnostic.
      invalid
    }
    Missing JSON: ${md.json(undefined)}

    ${namedFragment}

    ## Combining é
  `,
});

export const aliasedPrompt = prompt({
  id: "editor-conformance-alias",
  prompt: markdown`
Alias owner
  `,
});

export const namespacePrompt = crux.prompt({
  id: "editor-conformance-namespace",
  prompt: crux.md`Namespace owner`,
});

export const malformedPromptText = md`
\*\*open [label](<bad
`;
export const invalidCookedPromptText = md`
\u{110000}
`;
export const crlfPromptText = md`
first\r\nsecond
`;

const localMd = (strings: TemplateStringsArray): PromptText =>
  md`${strings.join("")}`;
export const shadowedImpostor = localMd`# Not canonical`;
