import { source } from '@/lib/source'
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from 'fumadocs-ui/layouts/docs/page'
import { notFound } from 'next/navigation'
import { getMDXComponents } from '@/mdx-components'
import { createRelativeLink } from 'fumadocs-ui/mdx'
import { buttonVariants } from 'fumadocs-ui/components/ui/button'
import { TrackedLink } from '@/components/tracked-link'
import { GitHubIcon } from '@/components/brand-icons'
import type { Metadata } from 'next'

const REPO_BASE = 'https://github.com/use-crux/crux/blob/main/apps/docs/content/docs'

export default async function Page(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params
  const page = source.getPage(params.slug)
  if (!page) notFound()

  const data = await page.data.load()

  const MDX = data.body
  const slugPath = (params.slug ?? []).join('/')
  const markdownUrl = `/llms.mdx/${slugPath}`
  const githubUrl = `${REPO_BASE}/${slugPath || 'index'}.mdx`

  return (
    <DocsPage
      toc={data.toc}
      full={page.data.full}
      tableOfContent={{
        header: (
          <div className="not-prose flex flex-row items-center gap-2 mb-2">
            <MarkdownCopyButton markdownUrl={markdownUrl} />
            <ViewOptionsPopover markdownUrl={markdownUrl} />
            <TrackedLink
              href={githubUrl}
              event="github_link_clicked"
              properties={{ location: 'docs_page', slug: slugPath || 'index' }}
              aria-label="View source on GitHub"
              target="_blank"
              rel="noreferrer noopener"
              className={buttonVariants({ size: 'icon-sm', color: 'ghost' })}
            >
              <GitHubIcon />
            </TrackedLink>
          </div>
        ),
      }}
    >
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX
          components={getMDXComponents({
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
    </DocsPage>
  )
}

export async function generateStaticParams() {
  return source.generateParams()
}

export async function generateMetadata(props: { params: Promise<{ slug?: string[] }> }): Promise<Metadata> {
  const params = await props.params
  const page = source.getPage(params.slug)
  if (!page) notFound()

  return {
    title: page.data.title,
    description: page.data.description,
    alternates: { canonical: page.url },
    openGraph: {
      title: page.data.title,
      description: page.data.description,
      url: page.url,
      siteName: 'Crux',
      type: 'article',
      images: [{ url: '/og', width: 1200, height: 630, alt: 'Crux — the TypeScript toolkit for harness engineering' }],
    },
    twitter: {
      card: 'summary_large_image',
      title: page.data.title,
      description: page.data.description,
      images: ['/og'],
    },
  }
}
