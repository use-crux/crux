import type { CruxConfig } from "../src";

const perCallPricing = {
  experimental: {
    eval: {
      pricing: {
        "openai/gpt-5": { maxUsdPerCall: 0.25 },
        default: { maxUsdPerCall: 1 },
      },
    },
  },
} satisfies CruxConfig;

const tokenPricingIsNotAnEvalCeiling = {
  experimental: {
    eval: {
      pricing: {
        "openai/gpt-5": {
          // @ts-expect-error Eval hard caps require a per-call USD ceiling.
          input: 2.5,
          output: 10,
        },
      },
    },
  },
} satisfies CruxConfig;

void perCallPricing;
void tokenPricingIsNotAnEvalCeiling;
