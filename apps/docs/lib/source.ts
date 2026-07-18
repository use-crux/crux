import { docs, blog } from 'fumadocs-mdx:collections/server'
import { toFumadocsSource } from 'fumadocs-mdx/runtime/server'
import { loader } from 'fumadocs-core/source'

export const source = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
})

export const blogSource = loader({
  baseUrl: '/blog',
  source: toFumadocsSource(blog, []),
})
