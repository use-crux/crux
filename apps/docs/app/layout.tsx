import './global.css'
import { RootProvider } from 'fumadocs-ui/provider/next'
import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import { Analytics } from "@vercel/analytics/next"

export const metadata: Metadata = {
  metadataBase: new URL('https://cruxjs.dev'),
  title: {
    default: 'Crux',
    template: '%s – Crux',
  },
  description:
    'Typed TypeScript building blocks for memory, retrieval, tools, guardrails, routing, evaluation, and observability — everything around your LLM call. Bring your own SDK. Use one block or ten. Nothing to lock into.',
  icons: {
    icon: '/favicon.svg',
  },
}

const siteJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': 'https://cruxjs.dev/#org',
      name: 'Crux',
      url: 'https://cruxjs.dev',
      logo: 'https://cruxjs.dev/favicon.svg',
      sameAs: ['https://github.com/use-crux/crux'],
    },
    {
      '@type': 'WebSite',
      name: 'Crux',
      url: 'https://cruxjs.dev',
      publisher: { '@id': 'https://cruxjs.dev/#org' },
    },
  ],
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd) }} />
        <RootProvider>{children}</RootProvider>
        <Analytics />
      </body>
    </html>
  )
}
