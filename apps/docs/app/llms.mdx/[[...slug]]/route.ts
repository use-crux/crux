import { source } from '@/lib/source'
import { notFound } from 'next/navigation'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export const revalidate = false

export async function GET(_req: Request, { params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params
  const page = source.getPage(slug)
  if (!page) notFound()

  // Resolve the source file path. fumadocs-mdx exposes the absolute file path on
  // page.data via the generated source loader; fall back to constructing from slug.
  const candidates: string[] = []
  const fromData = (page as { absolutePath?: string }).absolutePath
  if (fromData) candidates.push(fromData)

  const slugPath = (slug ?? []).join('/')
  const baseDir = path.resolve(process.cwd(), 'content/docs')
  candidates.push(path.join(baseDir, slugPath, 'index.mdx'))
  candidates.push(path.join(baseDir, `${slugPath}.mdx`))
  if (slugPath === '') candidates.push(path.join(baseDir, 'index.mdx'))

  for (const file of candidates) {
    try {
      const content = await fs.readFile(file, 'utf-8')
      return new Response(content, {
        headers: { 'content-type': 'text/markdown; charset=utf-8' },
      })
    } catch {
      // try next
    }
  }

  notFound()
}

export function generateStaticParams() {
  return source.generateParams()
}
