import './global.css'
import { RootProvider } from 'fumadocs-ui/provider/next'
import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import { Analytics } from "@vercel/analytics/next"

export const metadata: Metadata = {
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

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider>{children}</RootProvider>
        <Analytics />
      </body>
    </html>
  )
}
