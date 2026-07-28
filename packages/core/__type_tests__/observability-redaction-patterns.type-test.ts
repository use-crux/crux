import { config, type CruxConfig } from '../src'
import type { CruxObservabilityRedactionPattern } from '../src/observability'

const barePattern = /\bACME-\d{6}\b/ satisfies CruxObservabilityRedactionPattern

const patternTuple = [
  barePattern,
  { pattern: /\bCUSTOMER-\d+\b/ },
  {
    pattern: /\bORDER-\d+\b/,
    replacement: '[order-id]',
  },
] as const satisfies readonly CruxObservabilityRedactionPattern[]

const configWithPatterns = {
  observability: {
    redactPatterns: patternTuple,
  },
} satisfies CruxConfig

config(configWithPatterns)

const stringEntry = {
  observability: {
    redactPatterns: [
      // @ts-expect-error Redaction entries must be regular expressions or pattern objects.
      'ACME',
    ],
  },
} satisfies CruxConfig

const missingPattern = {
  observability: {
    redactPatterns: [
      // @ts-expect-error Object entries require a pattern.
      { replacement: '[identifier]' },
    ],
  },
} satisfies CruxConfig

const stringPattern = {
  observability: {
    redactPatterns: [
      {
        // @ts-expect-error Pattern must be a regular expression.
        pattern: 'ACME',
      },
    ],
  },
} satisfies CruxConfig

const numericReplacement = {
  observability: {
    redactPatterns: [
      {
        pattern: /ACME/,
        // @ts-expect-error Replacement must be a string.
        replacement: 42,
      },
    ],
  },
} satisfies CruxConfig

void [stringEntry, missingPattern, stringPattern, numericReplacement]
