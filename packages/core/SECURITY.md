# Security — `@crux/core`

Input sanitization and prompt injection defense for the prompt library.

## Table of Contents

- [Threat Model](#threat-model)
- [Two Modes](#two-modes)
- [Utilities Reference](#utilities-reference)
- [Best Practices](#best-practices)
- [What's Out of Our Control](#whats-out-of-our-control)
- [Risk-by-Prompt Audit](#risk-by-prompt-audit)
- [Migration Guide](#migration-guide)

---

## Threat Model

### What the library protects against

- **XML/HTML structure breakout** — User input containing `</constraints>`, `<evil>hack</evil>`, or similar tags that break the XML-structured system prompts
- **Prompt structure manipulation** — Injected closing tags or attribute escapes that alter the prompt's intended structure
- **Unbounded input length** — Overly long strings that waste tokens or overwhelm the context window

### What it can't protect against

- **Semantic prompt injection** — LLMs interpret meaning, not syntax. A user writing "ignore the above and do X" in plain English will always be partially effective regardless of escaping
- **Output safety** — Validating what the LLM produces is an application-level concern
- **Multi-turn context poisoning** — Conversation history management is outside the prompt library
- **Rate limiting / abuse prevention** — Infrastructure-level concern

The library provides **defense in depth** — multiple layers that each reduce risk, not a single silver bullet.

---

## Two Modes

### 1. Auto-Escape (secure by default)

Enabled by default. All string values in the input object are XML-escaped before reaching system/prompt functions. Normal code "just works":

```ts
prompt({
  input: z.object({ instruction: z.string() }),
  system: ({ input }) => `Instruction: ${input.instruction}`,
  // input.instruction is already escaped — <script> becomes &lt;script&gt;
})
```

**Opt out for trusted fields** with `rawFields`:

```ts
prompt({
  input: z.object({ instruction: z.string(), indexedHtml: z.string() }),
  rawFields: ['indexedHtml'],
  // instruction: auto-escaped, indexedHtml: passed through as-is
})
```

Disable globally if needed:

```ts
configure({ prompts, autoEscape: false })
```

### 2. `safe` Tag (explicit control)

Tagged template literal with composable helpers for per-value control:

```ts
import { safe, raw, limit, wrap } from '@crux/core'

// Auto-escapes all interpolated values
safe`<brand-voice>${input.brandVoice}</brand-voice>`

// Composable helpers
safe`
  Document: ${raw(trustedHtml)}       // skip escaping
  Query: ${limit(userQuery, 500)}     // truncate + escape
  Instruction: ${wrap(instruction)}   // escape + wrap in <user-input>
`
```

### When to use which

| Scenario                               | Recommendation                                                          |
| -------------------------------------- | ----------------------------------------------------------------------- |
| Most prompts                           | Auto-escape (default) — use regular templates                           |
| Trusted HTML/Markdown fields           | Auto-escape + `rawFields`                                               |
| Per-value control in templates         | `safe` tag with helpers                                                 |
| Builder functions (e.g., `builder.ts`) | `safe` tag (useful even with auto-escape for code outside the pipeline) |
| Full manual control                    | `configure({ autoEscape: false })` + `safe` tag everywhere              |

**Do not combine auto-escape and `safe` on the same field** — this double-escapes.

---

## Utilities Reference

### `escapeXml(str)`

Escapes `<`, `>`, `&`, `"`, `'` — the five XML special characters.

```ts
escapeXml('</role><evil>') // '&lt;/role&gt;&lt;evil&gt;'
```

### `truncate(str, maxLength?, suffix?)`

Caps string length. Default: 10,000 chars, suffix: `'…'`.

```ts
truncate('long string...', 100) // first 99 chars + '…'
```

### `safe` (tagged template)

Auto-escapes all interpolated values. Recognizes branded wrappers from `raw()`, `limit()`, `wrap()`.

```ts
safe`Voice: ${userInput}` // escapes userInput
```

### `raw(value)`

Marks a value to skip escaping inside `safe`. For trusted content only.

```ts
safe`${raw(trustedHtml)}` // no escaping
```

### `limit(value, maxLength, suffix?)`

Truncates + escapes inside `safe`.

```ts
safe`Query: ${limit(userQuery, 500)}` // truncate then escape
```

### `wrap(value, tag?)`

Escapes + wraps in delimiters inside `safe`. Default tag: `user-input`.

```ts
safe`${wrap(instruction)}` // <user-input>escaped</user-input>
```

### `userContent(content, tag?)`

Standalone version of `wrap()` for regular template literals.

```ts
;`Instruction: ${userContent(instruction)}`
```

### `detectSuspiciousPatterns(value, fieldName)`

Heuristic check for injection patterns. Returns warnings, never throws.

Enable automatically via `configure({ securityWarnings: true })`.

---

## Object Coercion Prevention

The resolve pipeline prevents `[object Object]` from corrupting prompts — a common bug when objects are interpolated into template literals instead of being serialized.

### Input Guard (Proxy)

Before any system/prompt function runs, object input values are wrapped in a Proxy. Normal property access passes through, but string coercion (template literal interpolation) throws immediately:

```ts
// This works — structural access:
system: ({ input }) => `Tone: ${input.config.tone}`

// This throws — object interpolation caught at the source:
system: ({ input }) => `Config: ${input.config}`
// → Error: Input field "config" is an object and cannot be interpolated
//   into a string. Use JSON.stringify(input.config) or access a specific
//   property (e.g., input.config.tone). Prompt: "draft-edit".
```

### safe() Object Rejection

The `safe` tagged template throws when a non-string value would produce `[object Object]`:

```ts
safe`Config: ${{ key: 'value' }}`
// → Error: safe() received a object that would stringify to "[object Object]".
//   Convert to string first (e.g. JSON.stringify()), or wrap with raw().
```

### Return Type Validation

System and prompt functions that return non-strings are caught:

```ts
system: ({ input }) => ({ not: 'a string' }) // returns object
// → Error: Prompt system/prompt function must return a string, got object.
```

Context `systemFn` has the same check with the context ID in the error.

### Safety Net

After the system message and prompt text are assembled, a final scan detects any `[object Object]` that slipped through, with surrounding context in the error message.

### SafeWrapper in Regular Templates

`wrap()`, `raw()`, and `limit()` work in both `safe` tagged templates and regular template literals:

```ts
// Both work — no [object Object]:
safe`Instruction: ${wrap(userInput)}``Instruction: ${wrap(userInput)}`
```

---

## Best Practices

### 1. Choose a sanitization mode and use it consistently

Auto-escape for most code, `safe` tag for builder functions. Don't mix on the same fields.

### 2. Add `z.string().max(N)` to all user-facing input schemas

Type-level length limits are defense in depth on top of runtime escaping.

```ts
input: z.object({
  instruction: z.string().max(2000),
  title: z.string().max(200),
})
```

### 3. Keep `system` for trusted instructions, `prompt` for user content

System messages define the LLM's role and constraints. User content belongs in the prompt (user message), where the LLM naturally treats it as input rather than instructions.

### 4. Use structured output schemas to constrain LLM responses

Zod output schemas limit what the model can return, reducing the impact of successful injection.

### 5. Wrap user instructions in delimiters

`wrap()` or `userContent()` adds `<user-input>` tags that signal to the LLM where user content starts and ends.

### 6. Enable `securityWarnings` in development

```ts
configure({
  prompts,
  securityWarnings: process.env.NODE_ENV !== 'production',
})
```

---

## What's Out of Our Control

These are real threats that require application-level solutions:

| Threat               | Why we can't solve it                     | Mitigation                                             |
| -------------------- | ----------------------------------------- | ------------------------------------------------------ |
| Semantic injection   | LLMs understand meaning, not just syntax  | Structured outputs, output validation, human review    |
| Output safety        | Library handles input, not output         | Application-level validation of LLM responses          |
| Multi-turn poisoning | Conversation history is outside our scope | Conversation management, summarization, context limits |
| Rate limiting        | Infrastructure concern                    | API rate limits, abuse detection                       |

---

## Risk-by-Prompt Audit

| Prompt                 | Risk Level | User-Controlled Fields                        | Mitigation                                                         |
| ---------------------- | ---------- | --------------------------------------------- | ------------------------------------------------------------------ |
| `draft-edit`           | High       | `instruction`, `indexedHtml`                  | `indexedHtml` in `rawFields`, `instruction` auto-escaped + wrapped |
| `inline-content`       | High       | `instruction`, `docContext`                   | Auto-escaped + wrapped                                             |
| `writer-planner`       | High       | `instruction`, `draftTitle`, `draftStructure` | Auto-escaped, `instruction` wrapped                                |
| `research-planner`     | Medium     | `query`, `previousResults`, `gaps`            | Auto-escaped, `query` wrapped                                      |
| `research-validator`   | Medium     | `query`, `resultsSummary`                     | Auto-escaped                                                       |
| `research-synthesizer` | Medium     | `query`, `results`                            | Auto-escaped                                                       |
| `seo-edit`             | Medium     | `instruction`, `bodyExcerpt`, `currentSeo`    | Auto-escaped, `instruction` wrapped                                |
| `seo-analysis`         | Low        | `title`, `bodyExcerpt`, `currentSeo`          | Auto-escaped                                                       |
| `conversation-title`   | Low        | `message`                                     | Auto-escaped + wrapped, limited                                    |
| `block-transform`      | Medium     | `blockJson`, `blockText`                      | Auto-escaped                                                       |
| `brand-profile`        | Low        | `contentSamples`                              | Auto-escaped                                                       |
| `preference-extractor` | Low        | `feedbackHistory`                             | Auto-escaped                                                       |
| Agent contexts         | Medium     | `lines[]`, `text`, `bodyPreview`              | `safe` tag in builder, auto-escaped in contexts                    |

---

## Migration Guide

### Step 1: Update to the latest `@crux/core`

Auto-escape is **enabled by default**. Existing prompts with pure string interpolation are automatically protected.

### Step 2: Declare `rawFields` for trusted content

If a prompt interpolates pre-formatted HTML or Markdown that should not be escaped:

```ts
prompt({
  rawFields: ['indexedHtml'], // skip auto-escape for this field
  ...
})
```

### Step 3: Add `wrap()` for user instructions (optional but recommended)

For extra clarity to the LLM about user-controlled content:

```ts
import { wrap } from '@crux/core'

prompt: ({ input }) => safe`
  ## User's Instruction
  ${wrap(input.instruction)}
`
```

### Step 4: Add `.max()` to input schemas

```ts
input: z.object({
  instruction: z.string().max(2000),
})
```

### Step 5: Enable dev warnings

```ts
configure({
  prompts,
  securityWarnings: true,
})
```

### Step 6: Use `safe` tag in builder code

For code that constructs strings outside the prompt pipeline (e.g., `builder.ts`):

```ts
import { safe, limit } from '@crux/core'

parts.push(safe`User: ${name}`)
parts.push(safe`Audience: ${limit(audience, 100)}`)
```
