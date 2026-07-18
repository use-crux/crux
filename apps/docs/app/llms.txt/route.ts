import { source, blogSource } from '@/lib/source'
import { llms } from 'fumadocs-core/source'

export const revalidate = false

export function GET() {
  const blogIndex = [
    '# Crux Blog',
    '',
    ...blogSource
      .getPages()
      .filter((page) => !page.data.draft)
      .sort((a, b) => b.data.date.localeCompare(a.data.date))
      .map((page) => `- [${page.data.title}](https://cruxjs.dev${page.url}): ${page.data.description ?? ''}`),
  ].join('\n')

  return new Response([llms(source).index(), blogIndex].join('\n\n'))
}
