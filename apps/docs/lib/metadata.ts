import type { Metadata } from 'next'

// Shared SEO metadata: canonical + OpenGraph + Twitter for any page.
// metadataBase (root layout) resolves relative URLs to https://cruxjs.dev.
export function pageMetadata({
  title,
  description,
  path,
}: {
  title: string
  description: string
  path: string
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      url: path,
      siteName: 'Crux',
      type: 'website',
      images: [{ url: '/og', width: 1200, height: 630, alt: 'Crux — the TypeScript toolkit for harness engineering' }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ['/og'],
    },
  }
}
