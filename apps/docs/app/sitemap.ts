import type { MetadataRoute } from 'next'
import { source, blogSource } from '@/lib/source'

const SITE = 'https://cruxjs.dev'

export default function sitemap(): MetadataRoute.Sitemap {
  const staticPages: MetadataRoute.Sitemap = [
    { url: SITE, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE}/why`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE}/observability`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE}/compare`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE}/blog`, changeFrequency: 'weekly', priority: 0.8 },
  ]

  const blogPages: MetadataRoute.Sitemap = blogSource
    .getPages()
    .filter((page) => !page.data.draft)
    .map((page) => ({
      url: `${SITE}${page.url}`,
      lastModified: new Date(page.data.date),
      changeFrequency: 'monthly',
      priority: 0.7,
    }))

  const docsPages: MetadataRoute.Sitemap = source.getPages().map((page) => ({
    url: `${SITE}${page.url}`,
    changeFrequency: 'weekly',
    priority: 0.6,
  }))

  return [...staticPages, ...blogPages, ...docsPages]
}
