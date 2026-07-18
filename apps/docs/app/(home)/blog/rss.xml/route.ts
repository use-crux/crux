import { blogSource } from '@/lib/source'

const SITE = 'https://cruxjs.dev'

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function GET() {
  const posts = blogSource
    .getPages()
    .filter((page) => !page.data.draft)
    .sort((a, b) => b.data.date.localeCompare(a.data.date))

  const items = posts
    .map(
      (page) => `    <item>
      <title>${escapeXml(page.data.title)}</title>
      <link>${SITE}${page.url}</link>
      <guid>${SITE}${page.url}</guid>
      <pubDate>${new Date(page.data.date).toUTCString()}</pubDate>
      <description>${escapeXml(page.data.description ?? '')}</description>
    </item>`,
    )
    .join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Crux Blog</title>
    <link>${SITE}/blog</link>
    <description>Notes from the harness — engineering deep-dives, release notes, and the occasional opinion.</description>
${items}
  </channel>
</rss>`

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  })
}
