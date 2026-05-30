import { createMDX } from 'fumadocs-mdx/next'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const monorepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  serverExternalPackages: ['typescript', 'twoslash'],
  experimental: {
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
    ]
  },
}

const withMDX = createMDX()

export default withMDX(config)
