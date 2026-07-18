import { source, blogSource } from '@/lib/source'
import { llms } from 'fumadocs-core/source'

export const revalidate = false

export function GET() {
  return new Response([llms(source).index(), llms(blogSource).index()].join('\n\n'))
}
