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
import type { Metadata } from 'next'

const REPO_BASE = 'https://github.com/anthropics/crux/blob/main/apps/crux-docs/content/docs'

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
            <ViewOptionsPopover markdownUrl={markdownUrl} githubUrl={githubUrl} />
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
  }
}
