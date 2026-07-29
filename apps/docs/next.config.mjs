import { createMDX } from 'fumadocs-mdx/next'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const monorepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  serverExternalPackages: ['typescript', 'twoslash'],
  experimental: {
    // Keep the full reference build within the preview host's 8 GB limit.
    cpus: 1,
    turbopackFileSystemCacheForDev: false,
  },
  turbopack: {
    root: monorepoRoot,
  },
  async redirects() {
    return [
      {
        source: '/docs',
        destination: '/docs/foundations',
        permanent: false,
      },
      {
        source: '/docs/guides/advanced/llms-txt',
        destination: '/docs/developer-tools/ai-assistants',
        permanent: true,
      },
    ]
  },
  async rewrites() {
    return [
      {
        source: '/ingest/static/:path*',
        destination: 'https://eu-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/array/:path*',
        destination: 'https://eu-assets.i.posthog.com/array/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://eu.i.posthog.com/:path*',
      },
    ]
  },
  skipTrailingSlashRedirect: true,
}

const withMDX = createMDX()

export default withMDX(config)
