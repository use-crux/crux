import { defineDocs, defineConfig } from 'fumadocs-mdx/config'
import { transformerTwoslash } from 'fumadocs-twoslash'
import { rehypeCodeDefaultOptions } from 'fumadocs-core/mdx-plugins'

const enableTwoslash = process.env.CRUX_DOCS_TWOSLASH !== '0'
const codeTransformers = rehypeCodeDefaultOptions.transformers ?? []
const twoslashOnly = process.env.CRUX_DOCS_TWOSLASH_ONLY?.split(',')
  .map((value) => value.trim())
  .filter(Boolean)

function shouldRunTwoslash(lang: string, meta: string | undefined) {
  if (!['ts', 'tsx', 'typescript'].includes(lang)) return false
  if (!meta || !/\btwoslash\b/.test(meta)) return false
  if (!twoslashOnly?.length) return true

  const title = meta.match(/\btitle=(?:"([^"]+)"|'([^']+)'|([^\s]+))/)?.slice(1).find(Boolean)

  return twoslashOnly.some((allowed) => meta.includes(allowed) || title === allowed)
}

export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    async: true,
  },
})

export default defineConfig({
  mdxOptions: {
    rehypeCodeOptions: {
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
      transformers: enableTwoslash
        ? [
            ...codeTransformers,
            transformerTwoslash({
              filter: (lang, _code, options) => shouldRunTwoslash(lang, options.meta?.__raw),
            }),
          ]
        : codeTransformers,
    },
    // Exclude MDX JSX (Card, Cards, Callout, etc.) from search index so search snippets
    // surface page prose instead of component prop strings like "card title: ..."
    remarkStructureOptions: {
      types: ['heading', 'paragraph', 'blockquote', 'tableCell'],
    },
  },
})
