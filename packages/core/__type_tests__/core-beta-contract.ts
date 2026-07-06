/**
 * Stable-beta type-surface contracts for prompt composition.
 *
 * These tests compile through `tsc --noEmit`; they assert public type
 * behavior rather than runtime implementation details.
 */

import { expectTypeOf } from "vitest";
import { z } from "zod";
import { contributor } from "../prompt/contributor";
import { context, match, when } from "../prompt/context";
import { prompt } from "../prompt/prompt";
import { hasToolCall, maxSteps } from "../generation";
import type { Contribution } from "../prompt";
import type {
  ContextTextSegment,
  InspectPart,
  ProviderAdaptations,
  StopCondition,
  ToolChoice,
} from "../index";
import type {
  ProviderAdaptations as GenerationProviderAdaptations,
  StopCondition as GenerationStopCondition,
  ToolChoice as GenerationToolChoice,
} from "../generation";

// @ts-expect-error The `injectable` factory is no longer part of the public prompt surface.
import { injectable as deletedPromptInjectable } from "../prompt";
// @ts-expect-error The `injectable` factory is no longer part of the public root surface.
import { injectable as deletedRootInjectable } from "../index";
// @ts-expect-error `InjectableConfig` is no longer public.
import type { InjectableConfig as DeletedInjectableConfig } from "../prompt";
// @ts-expect-error `isInjectableEntry` is no longer public.
import { isInjectableEntry as deletedIsInjectableEntry } from "../prompt";
// @ts-expect-error `InjectableEntry` is now a private lowering detail.
import type { InjectableEntry as DeletedInjectableEntry } from "../prompt";
// @ts-expect-error `PromptInjection` is now a private lowering detail.
import type { PromptInjection as DeletedPromptInjection } from "../prompt";
// @ts-expect-error Use `Contribution`.
import type { ContributorContribution as DeletedContributorContribution } from "../prompt";
// @ts-expect-error Use `ProviderAdaptations`.
import type { AdapterMap as DeletedAdapterMap } from "../generation";

type Phase8ContributionSurface = Contribution;
type Phase8AdaptationSurface = ProviderAdaptations & GenerationProviderAdaptations;
type Phase9ToolChoiceSurface = ToolChoice & GenerationToolChoice;
type Phase9StopConditionSurface = StopCondition & GenerationStopCondition;
void (0 as unknown as [
  Phase8ContributionSurface,
  Phase8AdaptationSurface,
  Phase9ToolChoiceSurface,
  Phase9StopConditionSurface,
  typeof deletedPromptInjectable,
  typeof deletedRootInjectable,
  DeletedInjectableConfig,
  typeof deletedIsInjectableEntry,
  DeletedInjectableEntry,
  DeletedPromptInjection,
  DeletedContributorContribution,
  DeletedAdapterMap,
]);

expectTypeOf<ToolChoice>().toEqualTypeOf<
  "auto" | "none" | "required" | { tool: string }
>();
expectTypeOf(maxSteps(3)).toEqualTypeOf<StopCondition>();
expectTypeOf(hasToolCall("search")).toEqualTypeOf<StopCondition>();

expectTypeOf<ContextTextSegment>().toMatchTypeOf<{
  text: string;
  dynamic: boolean;
  observedAt?: number;
  sourceVersion?: string;
}>();
expectTypeOf<InspectPart>().toMatchTypeOf<{
  servedFrom?: "live" | "memo";
  resolvedAt?: number;
  age?: number;
  observedAt?: number;
  sourceVersion?: string;
}>();

prompt({
  id: "neutral-tool-control-settings",
  settings: {
    toolChoice: { tool: "search" },
    stopWhen: [maxSteps(2), hasToolCall("search")],
  },
  prompt: "Search once.",
});

prompt({
  id: "tool-choice-no-top-level-escape",
  // @ts-expect-error `toolChoice` belongs in typed `settings`, not as a top-level prompt escape hatch.
  toolChoice: "none",
  prompt: "No tools.",
});

prompt({
  id: "stop-when-no-top-level-escape",
  // @ts-expect-error `stopWhen` belongs in typed `settings`, not as a top-level prompt escape hatch.
  stopWhen: maxSteps(1),
  prompt: "Stop quickly.",
});

// `messages` mode is exclusive with `system`/`prompt` mode.
// @ts-expect-error `messages` cannot be combined with a system prompt.
prompt({
  id: "messages-exclusive",
  system: "You are concise.",
  messages: () => [{ role: "user", content: "Hello" }],
});

const localeContext = context({
  id: "beta-locale",
  input: z.object({ locale: z.enum(["en", "nl"]) }),
  system: ({ input }) => `Reply in ${input.locale}.`,
});

when((input) => {
  // @ts-expect-error `when()` wrapper predicates receive Partial<context input>.
  input.locale.toUpperCase();
  return input.locale === "en";
}, localeContext);

const searchContext = context({
  id: "beta-search",
  input: z.object({ searchTerm: z.string() }),
  system: ({ input }) => `Search for ${input.searchTerm}.`,
});

const draftContext = context({
  id: "beta-draft",
  input: z.object({ draftId: z.string() }),
  system: ({ input }) => `Draft ${input.draftId}.`,
});

context({
  id: "static-when-input",
  system: "Static context.",
  when: ({ input }) => {
    // @ts-expect-error static context predicates receive `{ input: {} }`.
    return input.enabled === true;
  },
});

context({
  id: "family-public-context",
  // @ts-expect-error `family` is internal observability plumbing, not public context config.
  family: "memory",
  system: "No public family field.",
});

contributor({
  id: "family-public-contributor",
  // @ts-expect-error `family` is internal observability plumbing, not public contributor config.
  family: "retriever",
  contribute: () => ({}),
});

const matchedPrompt = prompt({
  id: "matched-branch-inputs",
  input: z.object({ mode: z.enum(["search", "draft"]) }),
  use: [
    match({
      on: (input: { mode: "search" | "draft" }) => input.mode,
      cases: { search: searchContext, draft: draftContext },
    }),
  ],
  system: ({ input }) => {
    expectTypeOf(input.searchTerm).toEqualTypeOf<string | undefined>();
    expectTypeOf(input.draftId).toEqualTypeOf<string | undefined>();
    // @ts-expect-error match branch inputs are optional because only one branch is active.
    const requiredSearchTerm: string = input.searchTerm;
    void requiredSearchTerm;
    return input.mode;
  },
});

void matchedPrompt.resolve({ input: { mode: "search" } });
void matchedPrompt.resolve({ input: { mode: "draft", draftId: "draft-1" } });

prompt({
  id: "default-output-input",
  input: z.object({ tone: z.string().default("friendly") }),
  system: ({ input }) => {
    expectTypeOf(input.tone).toEqualTypeOf<string>();
    return input.tone;
  },
});

const textPrompt = prompt({
  id: "text-has-output",
  prompt: "Say hi.",
});
expectTypeOf(textPrompt.hasOutput).toEqualTypeOf<false>();

const structuredPrompt = prompt({
  id: "structured-has-output",
  output: z.object({ ok: z.boolean() }),
  prompt: "Say hi.",
});
expectTypeOf(structuredPrompt.hasOutput).toEqualTypeOf<true>();

void textPrompt.resolve({});

const requiredInputPrompt = prompt({
  id: "required-input",
  input: z.object({ question: z.string() }),
  prompt: ({ input }) => input.question,
});
void requiredInputPrompt.resolve({ input: { question: "What is Crux?" } });
// @ts-expect-error prompts with an input schema require call-site input.
void requiredInputPrompt.resolve({});

const wide1 = context({
  input: z.object({ wide1: z.string() }),
  system: ({ input }) => input.wide1,
});
const wide2 = context({
  input: z.object({ wide2: z.string() }),
  system: ({ input }) => input.wide2,
});
const wide3 = context({
  input: z.object({ wide3: z.string() }),
  system: ({ input }) => input.wide3,
});
const wide4 = context({
  input: z.object({ wide4: z.string() }),
  system: ({ input }) => input.wide4,
});
const wide5 = context({
  input: z.object({ wide5: z.string() }),
  system: ({ input }) => input.wide5,
});
const wide6 = context({
  input: z.object({ wide6: z.string() }),
  system: ({ input }) => input.wide6,
});
const wide7 = context({
  input: z.object({ wide7: z.string() }),
  system: ({ input }) => input.wide7,
});
const wide8 = context({
  input: z.object({ wide8: z.string() }),
  system: ({ input }) => input.wide8,
});
const wide9 = context({
  input: z.object({ wide9: z.string() }),
  system: ({ input }) => input.wide9,
});
const wide10 = context({
  input: z.object({ wide10: z.string() }),
  system: ({ input }) => input.wide10,
});
const wide11 = context({
  input: z.object({ wide11: z.string() }),
  system: ({ input }) => input.wide11,
});
const wide12 = context({
  input: z.object({ wide12: z.string() }),
  system: ({ input }) => input.wide12,
});

prompt({
  id: "wide-use-fixture",
  use: [
    wide1,
    wide2,
    wide3,
    wide4,
    wide5,
    wide6,
    wide7,
    wide8,
    wide9,
    wide10,
    wide11,
    wide12,
  ],
  prompt: ({ input }) => {
    expectTypeOf(input.wide1).toEqualTypeOf<string>();
    expectTypeOf(input.wide12).toEqualTypeOf<string>();
    return input.wide6;
  },
});
