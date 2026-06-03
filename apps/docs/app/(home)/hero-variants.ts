export const HERO_VARIANTS = [
  //'It was never the prompt.',
  'Stop shipping coin flips.',
  'You shouldn’t ship a coin flip.',
  'Same prompt. Same result. Every time.',
  'Make Agents boring.',
] as const

export type HeroVariant = (typeof HERO_VARIANTS)[number]

export function pickHeroVariant(): HeroVariant {
  return HERO_VARIANTS[Math.floor(Math.random() * HERO_VARIANTS.length)]!
}
