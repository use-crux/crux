import type { PromptTextDecorationFixture } from '../src/prompt-text/contracts.js'

/** TypeScript source shared by both semantic-highlighting smoke fixtures. */
export const promptTextFixtureSource = [
  "const name = 'Ada'",
  'function md(strings: TemplateStringsArray, ...values: readonly unknown[]): string {',
  '  return String.raw({ raw: strings }, ...values)',
  '}',
  'const prompt = md`# Héllo **team**',
  '> 👋 *Welcome* ${name}',
  '- Read [guide](https://example.com) and `code`',
  '`',
  'void prompt',
  'export {}',
].join('\r\n')

const decorations = {
  kind: 'prompt-text-decoration-fixture',
  protocolVersion: 1,
  units: 'utf-16',
  document: {
    uri: 'untitled:prompt-text-decoration-fixture.ts',
    version: 1,
    text: promptTextFixtureSource,
  },
  decorations: [
    decoration('heading', 4, 20, 25),
    decoration('strong', 4, 28, 32),
    decoration('blockquote', 5, 0, 1),
    decoration('emphasis', 5, 6, 13),
    decoration('list', 6, 0, 1),
    decoration('link', 6, 8, 13),
    decoration('code', 6, 41, 45),
  ],
} satisfies PromptTextDecorationFixture

/** Deterministic editor modes exercised by the real extension-host smoke. */
export const semanticHighlightingFixtures = [
  {
    kind: 'semantic-highlighting-fixture',
    enabled: true,
    decorations,
  },
  {
    kind: 'semantic-highlighting-fixture',
    enabled: false,
    decorations,
  },
] as const

function decoration(
  role: PromptTextDecorationFixture['decorations'][number]['role'],
  line: number,
  start: number,
  end: number,
): PromptTextDecorationFixture['decorations'][number] {
  return {
    role,
    range: {
      start: { line, character: start },
      end: { line, character: end },
    },
  }
}
